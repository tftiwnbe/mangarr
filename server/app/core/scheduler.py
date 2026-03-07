import asyncio
import inspect
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Callable

from loguru import logger

from app.core.cache import PersistentCache
from app.core.database import sessionmanager


@dataclass(slots=False)
class _Job:
    func: Callable[..., Any]
    interval: float
    name: str
    last_run_cache_key: str
    state_cache_key: str
    label: str = ""
    run_immediately_on_start: bool = False
    paused: bool = False
    running: bool = False
    last_run_at: str | None = None
    next_run_at: str | None = None
    last_status: str | None = None
    last_duration_ms: int | None = None
    last_error: str | None = None


class TaskScheduler:
    """Minimal interval scheduler with decorator-based registration."""

    def __init__(self) -> None:
        self._jobs: list[_Job] = []
        self._tasks: set[asyncio.Task[None]] = set()
        self._stop_event = asyncio.Event()
        self._trigger_events: dict[str, asyncio.Event] = {}
        self._started = False
        self._logger = logger.bind(module="scheduler")
        self._cache = PersistentCache(sessionmanager.session)

    def interval(
        self,
        seconds: float,
        label: str = "",
        run_immediately_on_start: bool = False,
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        if seconds <= 0:
            raise ValueError("Interval must be positive.")

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            module = getattr(func, "__module__", "scheduler")
            qualname = getattr(func, "__qualname__", getattr(func, "__name__", "task"))
            cache_base = f"{module}.{qualname}"
            job_name = getattr(func, "__name__", "task")
            job = _Job(
                func=func,
                interval=float(seconds),
                name=job_name,
                last_run_cache_key=f"scheduler:last_run:{cache_base}",
                state_cache_key=f"scheduler:state:{cache_base}",
                label=label or job_name.replace("_job", "").replace("_", " ").title(),
                run_immediately_on_start=run_immediately_on_start,
            )
            self._jobs.append(job)
            return func

        return decorator

    async def start(self) -> None:
        if self._started:
            return

        loop = asyncio.get_running_loop()
        self._stop_event.clear()
        self._trigger_events = {job.name: asyncio.Event() for job in self._jobs}

        for job in self._jobs:
            await self._restore_job_state(job)
            next_run = await self._initial_next_run(job)
            job.next_run_at = None if job.paused else self._next_run_at(loop, next_run)
            trigger_event = self._trigger_events[job.name]
            task = asyncio.create_task(
                self._run_job(job, next_run, trigger_event), name=f"scheduler:{job.name}"
            )
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

        self._started = True

    async def stop(self) -> None:
        if not self._started:
            return

        self._stop_event.set()
        tasks = list(self._tasks)
        for task in tasks:
            task.cancel()

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        self._tasks.clear()
        self._started = False

    async def pause_job(self, name: str) -> bool:
        """Pause a job by name. Returns True if found."""
        job = self.find_job(name)
        if job is None:
            return False
        job.paused = True
        job.next_run_at = None
        await self._persist_job_state(job)
        return True

    async def resume_job(self, name: str) -> bool:
        """Resume a paused job by name. Returns True if found."""
        job = self.find_job(name)
        if job is None:
            return False
        job.paused = False
        await self._persist_job_state(job)
        return True

    def trigger_job(self, name: str) -> bool:
        """Trigger a job to run immediately. Returns True if found and started."""
        if not self._started:
            return False
        event = self._trigger_events.get(name)
        if event is None:
            return False
        event.set()
        return True

    def get_status(self) -> list[dict[str, Any]]:
        """Return current status of all registered jobs."""
        return [
            {
                "name": job.name,
                "label": job.label,
                "interval_seconds": job.interval,
                "paused": job.paused,
                "running": job.running,
                "last_run_at": job.last_run_at,
                "next_run_at": job.next_run_at,
                "last_status": job.last_status,
                "last_duration_ms": job.last_duration_ms,
                "last_error": job.last_error,
            }
            for job in self._jobs
        ]

    def find_job(self, name: str) -> _Job | None:
        for job in self._jobs:
            if job.name == name:
                return job
        return None

    async def _run_job(self, job: _Job, next_run: float, trigger_event: asyncio.Event) -> None:
        loop = asyncio.get_running_loop()

        while not self._stop_event.is_set():
            # While paused: idle in 1-second ticks waiting for resume or stop
            while job.paused and not self._stop_event.is_set():
                job.next_run_at = None
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=1.0)
                except asyncio.TimeoutError:
                    pass

            if self._stop_event.is_set():
                break

            # Wait until scheduled time, stop event, or manual trigger
            remaining = next_run - loop.time()
            job.next_run_at = self._next_run_at(loop, next_run)
            if remaining > 0 and not trigger_event.is_set():
                await self._interruptible_wait(remaining, trigger_event)
                if self._stop_event.is_set():
                    break

            trigger_event.clear()

            # Re-check: could have been paused while we were waiting
            if job.paused:
                continue

            # Execute the job function
            timestamp = datetime.now(tz=UTC)
            job.running = True
            job.next_run_at = None
            executed = False
            _t0 = loop.time()
            try:
                executed = True
                result = job.func()
                if inspect.isawaitable(result):
                    await result
                duration_ms = round((loop.time() - _t0) * 1000)
                job.last_status = "ok"
                job.last_duration_ms = duration_ms
                job.last_error = None
                self._logger.bind(
                    job=job.name,
                    duration_ms=duration_ms,
                    status="ok",
                ).info("job.run")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                duration_ms = round((loop.time() - _t0) * 1000)
                job.last_status = "error"
                job.last_duration_ms = duration_ms
                message = str(exc).strip() or exc.__class__.__name__
                job.last_error = message[:500]
                self._logger.bind(
                    job=job.name,
                    duration_ms=duration_ms,
                    status="error",
                ).exception("job.run")
            finally:
                job.running = False
                if executed:
                    await asyncio.shield(self._record_run(job, timestamp))

            next_run = loop.time() + job.interval
            job.next_run_at = self._next_run_at(loop, next_run)

    async def _interruptible_wait(self, timeout: float, trigger_event: asyncio.Event) -> None:
        """Wait for timeout, stop event, or trigger — whichever fires first."""
        stop_task = asyncio.create_task(self._stop_event.wait())
        trigger_task = asyncio.create_task(trigger_event.wait())
        try:
            await asyncio.wait(
                {stop_task, trigger_task},
                timeout=timeout,
                return_when=asyncio.FIRST_COMPLETED,
            )
        finally:
            stop_task.cancel()
            trigger_task.cancel()
            for task in (stop_task, trigger_task):
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

    async def _initial_next_run(self, job: _Job) -> float:
        loop = asyncio.get_running_loop()
        now = loop.time()

        try:
            last_run = await self._cache.get(job.last_run_cache_key)
        except Exception:
            self._logger.exception("Failed to read last run for {}", job.name)
            return now + job.interval

        if not last_run:
            return now if job.run_immediately_on_start else now + job.interval

        try:
            last_run_dt = datetime.fromisoformat(last_run)
        except (TypeError, ValueError):
            return now if job.run_immediately_on_start else now + job.interval

        job.last_run_at = last_run
        elapsed = (datetime.now(tz=UTC) - last_run_dt).total_seconds()
        remaining = job.interval - elapsed
        if remaining <= 0:
            return now
        return now + remaining

    async def _record_run(self, job: _Job, timestamp: datetime) -> None:
        job.last_run_at = timestamp.isoformat()
        try:
            await self._cache.set(job.last_run_cache_key, timestamp.isoformat())
            await self._persist_job_state(job)
        except Exception:
            self._logger.exception("Failed to persist last run for {}", job.name)

    async def _restore_job_state(self, job: _Job) -> None:
        try:
            raw = await self._cache.get(job.state_cache_key)
        except Exception:
            self._logger.exception("Failed to restore job state for {}", job.name)
            return
        if not isinstance(raw, dict):
            return
        job.paused = bool(raw.get("paused", False))
        last_status = raw.get("last_status")
        job.last_status = str(last_status) if isinstance(last_status, str) else None
        last_duration_ms = raw.get("last_duration_ms")
        job.last_duration_ms = int(last_duration_ms) if isinstance(last_duration_ms, (int, float)) else None
        last_error = raw.get("last_error")
        job.last_error = str(last_error) if isinstance(last_error, str) else None

    async def _persist_job_state(self, job: _Job) -> None:
        payload = {
            "paused": job.paused,
            "last_status": job.last_status,
            "last_duration_ms": job.last_duration_ms,
            "last_error": job.last_error,
        }
        await self._cache.set(job.state_cache_key, payload)

    @staticmethod
    def _next_run_at(loop: asyncio.AbstractEventLoop, next_run: float) -> str:
        delay_seconds = max(0.0, next_run - loop.time())
        return (datetime.now(tz=UTC) + timedelta(seconds=delay_seconds)).isoformat()


scheduler = TaskScheduler()
