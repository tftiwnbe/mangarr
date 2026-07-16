package mangarr.tachibridge.webview

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class KcefProxyRelayTest {
    @Test
    fun `does not start when the upstream proxy has no username`() {
        assertNull(
            KcefProxyRelay.start(
                KcefProxyConfig("proxy.example", 8080, null, null, null),
            ),
        )
    }

    @Test
    fun `adds upstream basic authentication and tunnels the connection`() {
        ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { upstreamServer ->
            val receivedAuthorization = CompletableFuture<String?>()
            val upstreamThread =
                thread(isDaemon = true, name = "proxy-relay-test-upstream") {
                    upstreamServer.accept().use { socket ->
                        val header = readHeader(socket.getInputStream())
                        receivedAuthorization.complete(
                            header
                                .lineSequence()
                                .firstOrNull { it.startsWith("Proxy-Authorization:", ignoreCase = true) }
                                ?.substringAfter(':')
                                ?.trim(),
                        )
                        socket.getOutputStream().apply {
                            write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray())
                            flush()
                        }
                        assertEquals("ping", socket.getInputStream().readNBytes(4).toString(StandardCharsets.UTF_8))
                        socket.getOutputStream().apply {
                            write("pong".toByteArray())
                            flush()
                        }
                    }
                }

            val upstream =
                KcefProxyConfig(
                    hostname = InetAddress.getLoopbackAddress().hostAddress,
                    port = upstreamServer.localPort,
                    username = "relay-user",
                    password = "relay-pass",
                    bypassList = null,
                )
            KcefProxyRelay.start(upstream)!!.use { relay ->
                Socket(relay.localConfig.hostname, relay.localConfig.port).use { client ->
                    client.soTimeout = 5_000
                    client.getOutputStream().apply {
                        write("CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n".toByteArray())
                        flush()
                    }
                    assertEquals(
                        "HTTP/1.1 200 Connection Established\r\n\r\n",
                        readHeader(client.getInputStream()),
                    )
                    client.getOutputStream().apply {
                        write("ping".toByteArray())
                        flush()
                    }
                    assertEquals("pong", client.getInputStream().readNBytes(4).toString(StandardCharsets.UTF_8))
                }
            }

            val encoded = Base64.getEncoder().encodeToString("relay-user:relay-pass".toByteArray())
            assertEquals("Basic $encoded", receivedAuthorization.get(5, TimeUnit.SECONDS))
            upstreamThread.join(5_000)
        }
    }

    private fun readHeader(input: InputStream): String {
        val bytes = ByteArrayOutputStream()
        var matched = 0
        val delimiter = byteArrayOf(13, 10, 13, 10)
        while (matched < delimiter.size) {
            val value = input.read()
            check(value >= 0) { "Connection closed before the header completed" }
            bytes.write(value)
            matched = if (value.toByte() == delimiter[matched]) matched + 1 else if (value == 13) 1 else 0
        }
        return bytes.toString(StandardCharsets.ISO_8859_1)
    }
}
