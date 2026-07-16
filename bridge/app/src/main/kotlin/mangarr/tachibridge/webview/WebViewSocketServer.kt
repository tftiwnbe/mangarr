package mangarr.tachibridge.webview

import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class WebViewSocketServer(
    port: Int,
    private val sessionManager: WebViewSessionManager,
) : WebSocketServer(InetSocketAddress("127.0.0.1", port)) {
    private data class ConnectionState(
        @Volatile var sessionId: String? = null,
    )

    private val logger = KotlinLogging.logger {}
    private val json = Json { ignoreUnknownKeys = true }
    private val states = ConcurrentHashMap<WebSocket, ConnectionState>()
    private val authTimeouts =
        Executors.newSingleThreadScheduledExecutor { runnable ->
            Thread(runnable, "webview-socket-timeouts").apply { isDaemon = true }
        }

    init {
        authTimeouts.scheduleAtFixedRate(
            sessionManager::expireInactive,
            SESSION_SWEEP_SECONDS,
            SESSION_SWEEP_SECONDS,
            TimeUnit.SECONDS,
        )
    }

    override fun onOpen(
        connection: WebSocket,
        handshake: ClientHandshake,
    ) {
        if (handshake.resourceDescriptor.substringBefore('?') != SOCKET_PATH || states.size >= MAX_CONNECTIONS) {
            connection.close(1008, "WebView connection rejected")
            return
        }
        states[connection] = ConnectionState()
        authTimeouts.schedule(
            {
                val state = states[connection]
                if (state != null && state.sessionId == null) {
                    states.remove(connection)
                    connection.close(1008, "WebView authentication timed out")
                }
            },
            AUTH_TIMEOUT_SECONDS,
            TimeUnit.SECONDS,
        )
    }

    override fun onMessage(
        connection: WebSocket,
        message: String,
    ) {
        val state = states[connection] ?: return
        val sessionId = state.sessionId
        if (sessionId == null) {
            authenticate(connection, state, message)
            return
        }
        sessionManager.handleMessage(sessionId, message)
    }

    override fun onMessage(
        connection: WebSocket,
        message: ByteBuffer,
    ) {
        connection.close(1003, "Binary client messages are not supported")
    }

    override fun onClose(
        connection: WebSocket,
        code: Int,
        reason: String,
        remote: Boolean,
    ) {
        states.remove(connection)?.sessionId?.let(sessionManager::detach)
    }

    override fun onError(
        connection: WebSocket?,
        error: Exception,
    ) {
        if (connection?.isOpen == true) {
            logger.warn(error) { "Extension WebView socket error" }
        }
    }

    override fun onStart() {
        logger.info { "Extension WebView socket listening on ${address.hostString}:${address.port}" }
    }

    fun shutdown() {
        sessionManager.shutdown()
        states.keys.forEach { it.close(1001, "Bridge shutting down") }
        states.clear()
        authTimeouts.shutdownNow()
        runCatching { stop(2_000) }.onFailure { error ->
            logger.warn(error) { "Failed to stop extension WebView socket cleanly" }
        }
    }

    private fun authenticate(
        connection: WebSocket,
        state: ConnectionState,
        rawMessage: String,
    ) {
        if (rawMessage.length > MAX_AUTH_MESSAGE_BYTES) {
            connection.close(1009, "Authentication message is too large")
            return
        }
        val payload = runCatching { json.parseToJsonElement(rawMessage).jsonObject }.getOrNull()
        val type = payload?.get("type")?.jsonPrimitive?.contentOrNull
        val ticket = payload?.get("ticket")?.jsonPrimitive?.contentOrNull
        if (type != "authenticate" || ticket.isNullOrBlank()) {
            connection.close(1008, "Invalid WebView authentication")
            return
        }
        val sink = SocketSink(connection)
        val sessionId = sessionManager.attach(ticket, sink)
        if (sessionId == null) {
            connection.close(1008, "Invalid or expired WebView ticket")
            return
        }
        state.sessionId = sessionId
    }

    private class SocketSink(
        private val connection: WebSocket,
    ) : WebViewClientSink {
        override fun sendText(message: String) {
            if (connection.isOpen) connection.send(message)
        }

        override fun sendBinary(bytes: ByteArray) {
            if (connection.isOpen) connection.send(bytes)
        }

        override fun close(
            code: Int,
            reason: String,
        ) {
            if (connection.isOpen) connection.close(code, reason)
        }
    }

    companion object {
        const val SOCKET_PATH = "/webview"
        private const val MAX_CONNECTIONS = 4
        private const val AUTH_TIMEOUT_SECONDS = 5L
        private const val SESSION_SWEEP_SECONDS = 30L
        private const val MAX_AUTH_MESSAGE_BYTES = 4 * 1024
    }
}
