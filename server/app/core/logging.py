import json
import logging
from sys import stdout
from typing import Callable

from loguru import logger

from app.config import settings

# Extra keys used for log routing/filtering — excluded from output pairs
_INTERNAL_EXTRA_KEYS = frozenset(
    {"module", "access", "bridge_logger", "bridge_thread", "bridge_raw", "bridge_stream"}
)

_BASE_FORMAT = (
    "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
    "<level>{level: <8}</level> | "
    "<cyan>{extra[module]}</cyan> | <level>{message}</level>"
)
_BASE_FORMAT_DEBUG = (
    "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
    "<level>{level: <8}</level> | "
    "<cyan>{name}:{function}:{line}</cyan> | <level>{message}</level>"
)
_ACCESS_FORMAT = (
    "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
    "<level>{level: <8}</level> | "
    "<level>{message}</level>"
)


def _with_extra(base: str) -> Callable:
    """Returns a Loguru format callable that appends non-internal extra fields as key=value pairs."""

    def formatter(record: dict) -> str:
        extra = {k: v for k, v in record["extra"].items() if k not in _INTERNAL_EXTRA_KEYS}
        if extra:
            parts = [
                "{}={}".format(k, str(v).replace("{", "{{").replace("}", "}}"))
                for k, v in extra.items()
                if v is not None
            ]
            suffix = " | " + " ".join(parts) if parts else ""
        else:
            suffix = ""
        return base + suffix + "\n"

    return formatter


def _json_format(record: dict) -> str:
    """Loguru format callable that produces a NDJSON line with all extra fields at the top level."""
    data: dict = {
        "t": record["time"].strftime("%Y-%m-%dT%H:%M:%S.%f"),
        "lvl": record["level"].name,
        "mod": record["extra"].get("module", record["name"]),
        "msg": str(record["message"]),
    }
    for k, v in record["extra"].items():
        if k not in _INTERNAL_EXTRA_KEYS and v is not None:
            data[k] = v
    raw = json.dumps(data, default=str)
    # Escape braces so Loguru's str.format_map() pass doesn't corrupt the JSON
    return raw.replace("{", "{{").replace("}", "}}") + "\n"


def setup_logger():
    logger.remove()
    log_dir = settings.app.log_dir
    log_dir.mkdir(parents=True, exist_ok=True)
    log_level = settings.log.level
    log_rotation = settings.log.rotation
    log_retention = settings.log.retention
    log_encoding = "utf-8"
    log_access = settings.log.access

    _no_access = lambda record: "access" not in record["extra"]  # noqa: E731
    _only_access = lambda record: "access" in record["extra"]  # noqa: E731

    # Console — human-readable with key=value extra fields
    logger.add(
        stdout,
        colorize=True,
        format=_with_extra(_BASE_FORMAT),
        level=log_level,
        filter=_no_access,
    )

    # Main text log file
    logger.add(
        log_dir / "mangarr.log",
        rotation=log_rotation,
        retention=log_retention,
        encoding=log_encoding,
        level="INFO",
        format=_with_extra(_BASE_FORMAT),
        colorize=False,
        filter=_no_access,
    )

    # Structured NDJSON log — one JSON object per line, all extra fields at top level
    logger.add(
        log_dir / "mangarr.jsonl",
        rotation=log_rotation,
        retention=log_retention,
        encoding=log_encoding,
        level="INFO",
        format=_json_format,
        colorize=False,
        filter=_no_access,
    )

    if log_level == "DEBUG":
        logger.add(
            log_dir / "mangarr.debug.log",
            rotation=log_rotation,
            retention=log_retention,
            encoding=log_encoding,
            level="DEBUG",
            format=_with_extra(_BASE_FORMAT_DEBUG),
            colorize=False,
            filter=_no_access,
        )

    # HTTP access logs — file only, controlled by config (too noisy for console)
    if log_access:
        logger.add(
            log_dir / "mangarr.access.log",
            rotation=log_rotation,
            retention=log_retention,
            encoding=log_encoding,
            level="INFO",
            format=_with_extra(_ACCESS_FORMAT),
            colorize=False,
            filter=_only_access,
        )

    # Redirect built-in logging -> Loguru
    class InterceptHandler(logging.Handler):
        def emit(self, record):
            try:
                level = logger.level(record.levelname).name
            except Exception:
                level = record.levelno
            module_name = record.name.split(".", 1)[0] if record.name else "app"
            bound_logger = logger.bind(module=module_name)
            bound_logger.opt(depth=6, exception=record.exc_info).log(
                level, record.getMessage()
            )

    intercept_handler = InterceptHandler()

    logging.basicConfig(handlers=[intercept_handler], level=0, force=True)

    for logger_name in ("uvicorn", "fastapi"):
        logging_logger = logging.getLogger(logger_name)
        logging_logger.handlers = []
        logging_logger.propagate = True

    # Disable Uvicorn's native access logs to avoid duplication
    logging.getLogger("uvicorn.access").disabled = True

    return logger
