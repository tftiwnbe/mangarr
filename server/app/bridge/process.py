import asyncio
import os
import shutil
import signal
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
        self._kcef_restart_attempted = False

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

            self._cleanup_kcef_singleton(config_dir)

            command = ["java", "-jar", str(jar_path), "--data-dir", str(config_dir)]
            if shutil.which("xvfb-run"):
                command = ["xvfb-run", "--auto-servernum"] + command

            self._logger.info(
                "Starting bridge process: {}",
                " ".join(command),
            )

            try:
                env = self._build_env(config_dir)
                self._process = await asyncio.create_subprocess_exec(
                    *command,
                    stdout=PIPE,
                    stderr=PIPE,
                    env=env,
                    start_new_session=True,
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
            try:
                os.killpg(self._process.pid, signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
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
                    if "Could not load 'jcef' library" in message:
                        self._schedule_kcef_restart()
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

    def _build_env(self, config_dir: Path) -> dict[str, str] | None:
        libcef_path = self._kcef_libcef_path(config_dir)
        if libcef_path is None:
            self._logger.debug("LD_PRELOAD not set (libcef.so not found)")
            return None

        env = os.environ.copy()
        existing = env.get("LD_PRELOAD")
        env["LD_PRELOAD"] = f"{libcef_path}:{existing}" if existing else str(libcef_path)
        self._logger.info("Using LD_PRELOAD for KCEF: {}", env["LD_PRELOAD"])
        return env

    def _kcef_libcef_path(self, config_dir: Path) -> Path | None:
        install_dir = os.getenv("KCEF_INSTALL_DIR")
        base_dir = Path(install_dir) if install_dir else config_dir / "bin" / "kcef"
        libcef = base_dir / "libcef.so"
        if libcef.exists():
            return libcef
        return None

    def _cleanup_kcef_singleton(self, config_dir: Path) -> None:
        cache_dir = config_dir / "cache" / "kcef"
        if not cache_dir.exists():
            return

        for path in cache_dir.glob("Singleton*"):
            try:
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()
                self._logger.debug("Removed stale KCEF lock: {}", path)
            except Exception as exc:
                self._logger.warning("Failed to remove KCEF lock {}: {}", path, exc)

    def _schedule_kcef_restart(self) -> None:
        if self._kcef_restart_attempted:
            return
        self._kcef_restart_attempted = True
        self._logger.warning(
            "KCEF failed to load; restarting bridge to apply LD_PRELOAD"
        )
        asyncio.create_task(self._restart_bridge())

    async def _restart_bridge(self) -> None:
        try:
            await self.stop()
            await asyncio.sleep(1.0)
            await self.start()
        except Exception as exc:
            self._logger.error("Failed to restart bridge: {}", exc)
