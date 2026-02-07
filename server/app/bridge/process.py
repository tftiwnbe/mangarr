import asyncio
from asyncio.subprocess import PIPE, Process
from contextlib import suppress
from pathlib import Path

from loguru import logger
from app.config import settings
from .logging import parse_bridge_log_line


class TachibridgeProcess:
    """Manages the lifecycle of the bridge process (Kotlin JVM)."""

    def __init__(self, shutdown_timeout: float = 10.0):
        self._shutdown_timeout = shutdown_timeout

        self._process: Process | None = None
        self._stdout_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()

        self._logger = logger.bind(module="bridge")
        self._process_logger = logger.bind(module="bridge.process")

    async def start(self) -> None:
        """Launch the bridge process via `java -jar`."""
        async with self._lock:
            if self.is_running():
                self._logger.debug("Process already running")
                return

            jar_path = self._default_jar()
            config_dir = settings.app.config_dir

            self._logger.info(
                "Starting bridge process: java -jar {} --data-dir {}",
                jar_path,
                config_dir,
            )

            try:
                self._process = await asyncio.create_subprocess_exec(
                    "java",
                    "-jar",
                    jar_path,
                    "--data-dir",
                    config_dir,
                    stdout=PIPE,
                    stderr=PIPE,
                )
            except FileNotFoundError as exc:
                raise RuntimeError("Java executable not found in PATH") from exc

            self._stdout_task = asyncio.create_task(
                self._consume_stream(self._process.stdout, "stdout"),
                name="bridge-stdout",
            )
            self._stderr_task = asyncio.create_task(
                self._consume_stream(self._process.stderr, "stderr"),
                name="bridge-stderr",
            )

    async def stop(self) -> None:
        """Terminate the process gracefully."""
        async with self._lock:
            if self._process is None:
                await self._cancel_stream_tasks()
                return

            if self._process.returncode is not None:
                await self._cancel_stream_tasks()
                self._process = None
                return

            self._logger.info("Stopping bridge process")
            self._process.terminate()

            try:
                await asyncio.wait_for(
                    self._process.wait(), timeout=self._shutdown_timeout
                )
            except asyncio.TimeoutError:
                self._logger.warning(
                    "Process did not stop within {:.1f}s, forcing kill",
                    self._shutdown_timeout,
                )
                self._process.kill()
                await self._process.wait()
            finally:
                await self._cancel_stream_tasks()
                self._process = None

    def is_running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    def returncode(self) -> int | None:
        return self._process.returncode if self._process else None

    async def _consume_stream(
        self, stream: asyncio.StreamReader | None, stream_name: str
    ) -> None:
        if stream is None:
            return
        try:
            while line := await stream.readline():
                text = line.decode(errors="replace").rstrip()
                if stream_name == "stdout":
                    level, bridge_logger, thread, message = parse_bridge_log_line(text)
                    self._process_logger.bind(
                        bridge_logger=bridge_logger, bridge_thread=thread
                    ).log(level, message)
                else:
                    self._process_logger.bind(
                        bridge_raw=text, bridge_stream=stream_name
                    ).warning(text)
        except asyncio.CancelledError:
            pass

    async def _cancel_stream_tasks(self) -> None:
        tasks = tuple(
            t for t in (self._stdout_task, self._stderr_task) if t is not None
        )
        self._stdout_task = None
        self._stderr_task = None

        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task

    @staticmethod
    def _default_jar() -> Path:
        """Return the default path to the Tachibridge JAR file."""
        jar_path = (
            settings.app.config_dir / "bin" / f"tachibridge-{settings.app.version}.jar"
        )

        if not jar_path.exists():
            raise RuntimeError(
                f"Tachibridge JAR not found at {jar_path}. Run 'make bridge' to build it."
            )

        return jar_path
