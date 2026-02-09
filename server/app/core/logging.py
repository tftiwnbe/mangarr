import logging
from sys import stdout

from loguru import logger

from app.config import settings


def setup_logger():
    logger.remove()
    log_dir = settings.app.log_dir
    log_dir.mkdir(parents=True, exist_ok=True)
    log_level = settings.log.level
    log_rotation = settings.log.rotation
    log_retention = settings.log.retention
    log_encoding = "utf-8"
    log_access = settings.log.access

    log_format_info = (
        "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{extra[module]}</cyan> | <level>{message}</level>"
    )
    log_format_debug = (
        "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}:{function}:{line}</cyan> | <level>{message}</level>"
    )
    log_format_access = (
        "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
        "<level>{level: <8}</level> | "
        "<level>{message}</level>"
    )

    logger.add(
        stdout,
        colorize=True,
        format=log_format_info,
        level=log_level,
        filter=lambda record: "access" not in record["extra"],
    )

    logger.add(
        log_dir / "mangarr.log",
        rotation=log_rotation,
        retention=log_retention,
        encoding=log_encoding,
        level="INFO",
        format=log_format_info,
        filter=lambda record: "access" not in record["extra"],
    )

    if log_level == "DEBUG":
        logger.add(
            log_dir / "mangarr.debug.log",
            rotation=log_rotation,
            retention=log_retention,
            encoding=log_encoding,
            level="DEBUG",
            format=log_format_debug,
            filter=lambda record: "access" not in record["extra"],
        )

    if log_access:
        logger.add(
            log_dir / "mangarr.access.log",
            rotation=log_rotation,
            retention=log_retention,
            encoding=log_encoding,
            level="INFO",
            format=log_format_access,
            filter=lambda record: "access" in record["extra"],
        )
    if log_access and log_level == "DEBUG":
        logger.add(
            stdout,
            colorize=True,
            format=log_format_info,
            level=log_level,
            filter=lambda record: "access" in record["extra"],
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

    # Disable Uvicorn’s native access logs to avoid duplication
    logging.getLogger("uvicorn.access").disabled = True

    return logger
