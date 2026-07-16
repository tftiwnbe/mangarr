package mangarr.tachibridge.webview

import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Removes upstream proxy authentication from CEF's side of the connection.
 *
 * Chrome-runtime CEF does not reliably invoke getAuthCredentials for CORS preflight requests.
 * A loopback-only relay lets CEF use an unauthenticated proxy while adding the configured Basic
 * credentials to the request sent to the real upstream proxy.
 */
class KcefProxyRelay private constructor(
    private val upstream: KcefProxyConfig,
    private val server: ServerSocket,
) : Closeable {
    private val closed = AtomicBoolean(false)
    private val workers =
        Executors.newCachedThreadPool { runnable ->
            Thread(runnable, "kcef-proxy-relay-worker").apply { isDaemon = true }
        }
    private val acceptThread =
        Thread(::acceptConnections, "kcef-proxy-relay-accept").apply {
            isDaemon = true
            start()
        }

    val localConfig: KcefProxyConfig =
        upstream.copy(
            hostname = InetAddress.getLoopbackAddress().hostAddress,
            port = server.localPort,
            username = null,
            password = null,
        )

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        runCatching { server.close() }
        workers.shutdownNow()
        acceptThread.interrupt()
    }

    private fun acceptConnections() {
        while (!closed.get()) {
            val client =
                try {
                    server.accept()
                } catch (_: Exception) {
                    if (closed.get()) return
                    continue
                }
            workers.execute { relay(client) }
        }
    }

    private fun relay(client: Socket) {
        client.use { downstream ->
            downstream.soTimeout = SOCKET_TIMEOUT_MS
            val requestHeader = readHeader(downstream.getInputStream()) ?: return
            Socket().use { upstreamSocket ->
                upstreamSocket.connect(java.net.InetSocketAddress(upstream.hostname, upstream.port), CONNECT_TIMEOUT_MS)
                upstreamSocket.soTimeout = SOCKET_TIMEOUT_MS
                upstreamSocket.getOutputStream().apply {
                    write(withProxyAuthorization(requestHeader))
                    flush()
                }

                val responseHeader = readHeader(upstreamSocket.getInputStream()) ?: return
                downstream.getOutputStream().apply {
                    write(responseHeader)
                    flush()
                }

                val upstreamOutput = upstreamSocket.getOutputStream()
                val downstreamInput = downstream.getInputStream()
                workers.execute {
                    runCatching { downstreamInput.copyTo(upstreamOutput) }
                    runCatching { upstreamSocket.shutdownOutput() }
                }
                runCatching { upstreamSocket.getInputStream().copyTo(downstream.getOutputStream()) }
            }
        }
    }

    private fun withProxyAuthorization(header: ByteArray): ByteArray {
        val lines = header.toString(StandardCharsets.ISO_8859_1).split("\r\n")
        val credentials =
            Base64.getEncoder().encodeToString(
                "${upstream.username.orEmpty()}:${upstream.password.orEmpty()}".toByteArray(StandardCharsets.UTF_8),
            )
        return buildString {
            append(lines.first())
            append("\r\n")
            lines.drop(1).forEach { line ->
                if (line.isNotEmpty() && !line.startsWith("Proxy-Authorization:", ignoreCase = true)) {
                    append(line)
                    append("\r\n")
                }
            }
            append("Proxy-Authorization: Basic ")
            append(credentials)
            append("\r\n\r\n")
        }.toByteArray(StandardCharsets.ISO_8859_1)
    }

    companion object {
        private const val MAX_HEADER_BYTES = 64 * 1024
        private const val CONNECT_TIMEOUT_MS = 15_000
        private const val SOCKET_TIMEOUT_MS = 60_000

        fun start(upstream: KcefProxyConfig): KcefProxyRelay? {
            if (upstream.username == null) return null
            val server = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
            return KcefProxyRelay(upstream, server)
        }

        private fun readHeader(input: InputStream): ByteArray? {
            val bytes = ByteArrayOutputStream()
            var matched = 0
            val delimiter = byteArrayOf(13, 10, 13, 10)
            while (bytes.size() < MAX_HEADER_BYTES) {
                val value = input.read()
                if (value < 0) return null
                bytes.write(value)
                matched = if (value.toByte() == delimiter[matched]) matched + 1 else if (value == 13) 1 else 0
                if (matched == delimiter.size) return bytes.toByteArray()
            }
            return null
        }
    }
}
