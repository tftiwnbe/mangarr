from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from threading import Lock


@dataclass(slots=True)
class BridgePageMetricsSnapshot:
    page_fetch_attempts: int = 0
    page_fetch_not_found: int = 0
    page_fetch_recovery_attempts: int = 0
    page_fetch_recovered: int = 0
    page_fetch_recovery_failed: int = 0
    last_recovery_at: str | None = None


class BridgePageMetrics:
    def __init__(self) -> None:
        self._lock = Lock()
        self._snapshot = BridgePageMetricsSnapshot()

    def record_fetch_attempt(self) -> None:
        with self._lock:
            self._snapshot.page_fetch_attempts += 1

    def record_not_found(self) -> None:
        with self._lock:
            self._snapshot.page_fetch_not_found += 1

    def record_recovery_attempt(self) -> None:
        with self._lock:
            self._snapshot.page_fetch_recovery_attempts += 1

    def record_recovered(self) -> None:
        with self._lock:
            self._snapshot.page_fetch_recovered += 1
            self._snapshot.last_recovery_at = datetime.now(timezone.utc).isoformat()

    def record_recovery_failed(self) -> None:
        with self._lock:
            self._snapshot.page_fetch_recovery_failed += 1

    def snapshot(self) -> BridgePageMetricsSnapshot:
        with self._lock:
            return BridgePageMetricsSnapshot(**asdict(self._snapshot))


bridge_page_metrics = BridgePageMetrics()
