import json


def parse_bridge_log_line(
    line: str,
) -> tuple[str, str | None, str | None, str]:
    """Normalise a raw JSON bridge log line into logging metadata."""
    stripped = line.strip()
    if not stripped:
        return ("INFO", "bridge", "unknown", "")

    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError:
        # Bridge sometimes emits plain text during startup; surface the raw line.
        return ("INFO", "bridge", "unknown", stripped)

    level = payload.get("level")
    logger_name = payload.get("logger") or "bridge"
    thread = payload.get("thread") or "unknown"
    message = payload.get("message") or ""

    lines = [entry.strip() for entry in message.splitlines() if entry.strip()]
    if lines:
        message = lines[0]
        extra_lines = len(lines) - 1
        if extra_lines > 0:
            message = f"{message} … (+{extra_lines} lines)"
    else:
        message = ""

    return (map_bridge_level(level), logger_name, thread, message)


def map_bridge_level(level: str) -> str:
    """Translate bridge log levels into loguru-compatible levels."""
    level_normalised = level.upper()
    level_map = {
        "TRACE": "TRACE",
        "DEBUG": "DEBUG",
        "INFO": "INFO",
        "WARN": "WARNING",
        "WARNING": "WARNING",
        "ERROR": "ERROR",
        "SEVERE": "ERROR",
    }
    return level_map.get(level_normalised, "INFO")
