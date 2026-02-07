import asyncio
import inspect
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Callable

from loguru import logger

from app.core.cache import PersistentCache
from app.core.database import sessionmanager


@dataclass(slots=True)
class _Job:
    func: Callable[..., Any]
    interval: float
    name: str
    cache_key: str


class TaskScheduler:
    """Minimal interval scheduler with decorator-based registration."""

    def __init__(self) -> None:
        self._jobs: list[_Job] = []
        self._tasks: set[asyncio.Task[None]] = set()
        self._stop_event = asyncio.Event()
        self._started = False
        self._logger = logger.bind(module="scheduler")
        self._cache = PersistentCache(sessionmanager.session)

    def interval(
        self, seconds: float
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        if seconds <= 0:
            raise ValueError("Interval must be positive.")

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            module = getattr(func, "__module__", "scheduler")
            qualname = getattr(func, "__qualname__", getattr(func, "__name__", "task"))
            cache_key = f"scheduler:last_run:{module}.{qualname}"
            job = _Job(
                func=func,
                interval=float(seconds),
                name=getattr(func, "__name__", "task"),
                cache_key=cache_key,
            )
            self._jobs.append(job)
            return func

        return decorator

    async def start(self) -> None:
        if self._started:
            return

        self._stop_event.clear()
        for job in self._jobs:
            next_run = await self._initial_next_run(job)
            task = asyncio.create_task(
                self._run_job(job, next_run), name=f"scheduler:{job.name}"
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

    async def _run_job(self, job: _Job, next_run: float) -> None:
        loop = asyncio.get_running_loop()

        while not self._stop_event.is_set():
            if next_run > loop.time():
                delay = next_run - loop.time()
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=delay)
                    break
                except asyncio.TimeoutError:
                    pass

            timestamp = datetime.now(tz=UTC)
            executed = False
            try:
                executed = True
                result = job.func()
                if inspect.isawaitable(result):
                    await result
            except asyncio.CancelledError:
                executed = False
                raise
            except Exception:
                self._logger.exception("Scheduled job %s failed.", job.name)
            finally:
                if executed:
                    await asyncio.shield(self._record_run(job, timestamp))

            next_run += job.interval
            delay = max(0.0, next_run - loop.time())

            if delay == 0.0:
                continue

            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=delay)
            except asyncio.TimeoutError:
                continue

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

        elapsed = (datetime.now(tz=UTC) - last_run_dt).total_seconds()
        remaining = job.interval - elapsed
        if remaining <= 0:
            return now
        return now + remaining

    async def _record_run(self, job: _Job, timestamp: datetime) -> None:
        try:
            await self._cache.set(job.cache_key, timestamp.isoformat())
        except Exception:
            self._logger.exception("Failed to persist last run for %s.", job.name)


scheduler = TaskScheduler()
