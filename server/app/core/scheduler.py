import asyncio
import inspect
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Callable

from loguru import logger

from app.core.cache import PersistentCache
from app.core.database import sessionmanager


@dataclass(slots=False)
class _Job:
    func: Callable[..., Any]
    interval: float
    name: str
    cache_key: str
    label: str = ""
    paused: bool = False
    running: bool = False
    last_run_at: str | None = None


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
        self, seconds: float, label: str = ""
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        if seconds <= 0:
            raise ValueError("Interval must be positive.")

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            module = getattr(func, "__module__", "scheduler")
            qualname = getattr(func, "__qualname__", getattr(func, "__name__", "task"))
            cache_key = f"scheduler:last_run:{module}.{qualname}"
            job_name = getattr(func, "__name__", "task")
            job = _Job(
                func=func,
                interval=float(seconds),
                name=job_name,
                cache_key=cache_key,
                label=label or job_name.replace("_job", "").replace("_", " ").title(),
            )
            self._jobs.append(job)
            return func

        return decorator

    async def start(self) -> None:
        if self._started:
            return

        self._stop_event.clear()
        self._trigger_events = {job.name: asyncio.Event() for job in self._jobs}

        for job in self._jobs:
            next_run = await self._initial_next_run(job)
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

    def pause_job(self, name: str) -> bool:
        """Pause a job by name. Returns True if found."""
        for job in self._jobs:
            if job.name == name:
                job.paused = True
                return True
        return False

    def resume_job(self, name: str) -> bool:
        """Resume a paused job. Returns True if found."""
        for job in self._jobs:
            if job.name == name:
                job.paused = False
                return True
        return False

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
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=1.0)
                except asyncio.TimeoutError:
                    pass

            if self._stop_event.is_set():
                break

            # Wait until scheduled time, stop event, or manual trigger
            remaining = next_run - loop.time()
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
            executed = False
            try:
                executed = True
                result = job.func()
                if inspect.isawaitable(result):
                    await result
            except asyncio.CancelledError:
                raise
            except Exception:
                self._logger.exception("Scheduled job %s failed.", job.name)
            finally:
                job.running = False
                if executed:
                    await asyncio.shield(self._record_run(job, timestamp))

            next_run = loop.time() + job.interval

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
            last_run = await self._cache.get(job.cache_key)
        except Exception:
            self._logger.exception("Failed to read last run for %s.", job.name)
            return now

        if not last_run:
            return now

        try:
            last_run_dt = datetime.fromisoformat(last_run)
        except (TypeError, ValueError):
            return now

        job.last_run_at = last_run
        elapsed = (datetime.now(tz=UTC) - last_run_dt).total_seconds()
        remaining = job.interval - elapsed
        if remaining <= 0:
            return now
        return now + remaining

    async def _record_run(self, job: _Job, timestamp: datetime) -> None:
        job.last_run_at = timestamp.isoformat()
        try:
            await self._cache.set(job.cache_key, timestamp.isoformat())
        except Exception:
            self._logger.exception("Failed to persist last run for %s.", job.name)


scheduler = TaskScheduler()
