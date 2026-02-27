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
    throwable_class = payload.get("throwable_class") or ""
    throwable_message = payload.get("throwable_message") or ""
    stack_trace = payload.get("stack_trace") or ""

    lines = [entry.strip() for entry in message.splitlines() if entry.strip()]
    if lines:
        message = lines[0]
        extra_lines = len(lines) - 1
        if extra_lines > 0:
            message = f"{message} … (+{extra_lines} lines)"
    else:
        message = ""

    if throwable_class or throwable_message:
        throwable_summary = " ".join(
            part for part in (throwable_class, throwable_message) if part
        ).strip()
        if throwable_summary:
            message = f"{message} | {throwable_summary}" if message else throwable_summary
    elif stack_trace:
        first_trace_line = next(
            (entry.strip() for entry in stack_trace.splitlines() if entry.strip()),
            "",
        )
        if first_trace_line:
            message = f"{message} | {first_trace_line}" if message else first_trace_line

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
