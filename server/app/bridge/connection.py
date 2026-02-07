import asyncio

import grpc
from loguru import logger

from .proto.mangarr.tachibridge import tachibridge_pb2, tachibridge_pb2_grpc


class TachibridgeConnection:
    """Manages gRPC channel and stub lifecycle."""

    def __init__(self, port: int):
        self._port = port
        self._address = f"127.0.0.1:{port}"

        self._channel: grpc.aio.Channel | None = None
        self._stub: tachibridge_pb2_grpc.TachibridgeStub | None = None
        self._lock = asyncio.Lock()

        self._logger = logger.bind(module="bridge.connection")

    async def get_stub(self) -> tachibridge_pb2_grpc.TachibridgeStub:
        """Get or create the gRPC stub with automatic reconnection."""
        async with self._lock:
            if self._needs_reconnect():
                await self._reconnect()

            if self._stub is None:
                raise RuntimeError("Failed to create gRPC stub")

            return self._stub

    async def close(self) -> None:
        """Close the gRPC channel."""
        async with self._lock:
            if self._channel:
                try:
                    await self._channel.close()
                    self._logger.debug("Channel closed")
                except Exception as e:
                    self._logger.warning(f"Error closing channel: {e}")
                finally:
                    self._channel = None
                    self._stub = None

    async def check_health(self, timeout: float = 20.0) -> bool:
        """Perform a health check against the bridge."""
        try:
            stub = await self.get_stub()
            request = tachibridge_pb2.HealthCheckRequest()
            response = await stub.HealthCheck(request, timeout=timeout)
            return response.status == "OK"
        except Exception as e:
            self._logger.debug(f"Health check failed: {e}")
            return False

    async def wait_until_ready(
        self,
        timeout: float = 30.0,
        interval: float = 0.5,
    ) -> None:
        """Wait until the bridge responds to health checks."""
        deadline = asyncio.get_running_loop().time() + timeout

        while True:
            if await self.check_health():
                self._logger.info(f"Bridge ready at {self._address}")
                return

            now = asyncio.get_running_loop().time()
            if now >= deadline:
                raise RuntimeError(
                    f"Timed out waiting for bridge at {self._address} after {timeout}s"
                )

            await asyncio.sleep(interval)

    def _needs_reconnect(self) -> bool:
        """Check if the channel needs to be reconnected."""
        if self._channel is None or self._stub is None:
            return True

        state = self._channel.get_state()
        return state in (
            grpc.ChannelConnectivity.SHUTDOWN,
            grpc.ChannelConnectivity.TRANSIENT_FAILURE,
        )

    async def _reconnect(self) -> None:
        """Close existing channel and create a new one."""
        if self._channel:
            try:
                await self._channel.close()
            except Exception:
                pass

        self._logger.debug(f"Connecting to {self._address}")
        self._channel = self._create_channel()
        self._stub = tachibridge_pb2_grpc.TachibridgeStub(self._channel)

    def _create_channel(self) -> grpc.aio.Channel:
        """Create a new gRPC channel with optimal settings."""
        return grpc.aio.insecure_channel(
            self._address,
            # options=[
            #     # Keepalive settings
            #     ("grpc.keepalive_time_ms", 60000),
            #     ("grpc.keepalive_timeout_ms", 20000),
            #     ("grpc.keepalive_permit_without_calls", 1),
            #     ("grpc.http2.max_pings_without_data", 0),
            #     # Connection settings
            #     ("grpc.enable_retries", 1),
            #     ("grpc.max_reconnect_backoff_ms", 5000),
            #     # Performance tuning
            #     ("grpc.max_send_message_length", 50 * 1024 * 1024),  # 50MB
            #     ("grpc.max_receive_message_length", 50 * 1024 * 1024),
            # ],
        )
