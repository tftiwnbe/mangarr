"""
WebSocket connection manager.

Maintains the set of authenticated WebSocket clients and provides a single
`broadcast()` call that fan-outs JSON events to all of them.  Dead connections
are pruned on the next broadcast.
"""
import asyncio
import json
from typing import Any

from fastapi import WebSocket

from loguru import logger

_ws_logger = logger.bind(module="core.ws")


class ConnectionManager:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.append(ws)
        _ws_logger.debug("ws.connected clients={}", len(self._connections))

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            try:
                self._connections.remove(ws)
            except ValueError:
                pass
        _ws_logger.debug("ws.disconnected clients={}", len(self._connections))

    async def broadcast(self, event: dict[str, Any]) -> None:
        """Send *event* as JSON to every connected client; prune dead sockets."""
        if not self._connections:
            return
        message = json.dumps(event, default=str)
        dead: list[WebSocket] = []
        async with self._lock:
            connections = list(self._connections)
        for ws in connections:
            try:
                await ws.send_text(message)
            except Exception as exc:
                _ws_logger.debug("ws.pruned error={}", type(exc).__name__)
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    try:
                        self._connections.remove(ws)
                    except ValueError:
                        pass


# Singleton used by the WS endpoint and event producers.
ws_manager = ConnectionManager()
