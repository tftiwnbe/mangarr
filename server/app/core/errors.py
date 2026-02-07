from typing import Any


class BridgeAPIError(RuntimeError):
    """Raised when the bridge daemon returns an error response."""

    def __init__(self, status_code: int, detail: str | dict[str, Any]):
        super().__init__(f"Bridge request failed with HTTP {status_code}: {detail}")
        self.status_code = status_code
        self.detail = detail
