package eu.kanade.tachiyomi.network

import mangarr.tachibridge.config.BridgeConfig
import mangarr.tachibridge.config.ConfigManager
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.SocketAddress
import java.net.URI
import java.util.Locale

data class BridgeProxySettings(
    val hostname: String,
    val port: Int,
    val username: String? = null,
    val password: String? = null,
    val ignoredAddresses: String = "",
    val bypassLocalAddresses: Boolean = true,
) {
    fun isConfigured(): Boolean = hostname.isNotBlank() && port in 1..65535

    fun shouldBypass(host: String): Boolean {
        val normalizedHost = host.lowercase(Locale.ROOT).trim().trim('.')
        if (normalizedHost.isBlank()) return true

        if (bypassLocalAddresses && isLocalAddress(normalizedHost)) {
            return true
        }

        val ignoredPatterns =
            ignoredAddresses
                .split(';')
                .map { it.trim().lowercase(Locale.ROOT) }
                .filter { it.isNotBlank() }

        return ignoredPatterns.any { pattern -> hostMatchesPattern(normalizedHost, pattern) }
    }

    private fun isLocalAddress(host: String): Boolean {
        if (host == "localhost" || host.endsWith(".local")) return true
        if (host == "::1" || host == "0:0:0:0:0:0:0:1") return true
        if (host.startsWith("127.") || host == "0.0.0.0") return true
        if (host.startsWith("10.")) return true
        if (host.startsWith("192.168.")) return true
        if (host.startsWith("169.254.")) return true
        if (host.startsWith("fc") || host.startsWith("fd")) return true

        val parts = host.split('.')
        if (parts.size == 4) {
            val octets = parts.mapNotNull { it.toIntOrNull() }
            if (octets.size == 4 && octets.all { it in 0..255 }) {
                if (octets[0] == 172 && octets[1] in 16..31) return true
            }
        }

        return false
    }

    private fun hostMatchesPattern(host: String, pattern: String): Boolean {
        if (pattern == "*") return true

        if (pattern.contains('*')) {
            val regexPattern = "^" + Regex.escape(pattern).replace("\\*", ".*") + "$"
            return Regex(regexPattern, RegexOption.IGNORE_CASE).matches(host)
        }

        if (host == pattern) return true
        return host.endsWith(".$pattern")
    }
}

fun BridgeConfig.Proxy.toBridgeProxySettings(): BridgeProxySettings =
    BridgeProxySettings(
        hostname = hostname,
        port = port,
        username = username,
        password = password,
        ignoredAddresses = ignoredAddresses,
        bypassLocalAddresses = bypassLocalAddresses,
    )

object BridgeProxyContext {
    private val current = ThreadLocal<BridgeProxySettings?>()

    fun current(): BridgeProxySettings? = current.get()

    suspend fun <T> withProxy(
        settings: BridgeProxySettings?,
        block: suspend () -> T,
    ): T {
        val previous = current.get()
        current.set(settings)
        return try {
            block()
        } finally {
            if (previous == null) {
                current.remove()
            } else {
                current.set(previous)
            }
        }
    }
}

class BridgeProxySelector(
    private val delegate: ProxySelector? = ProxySelector.getDefault(),
) : ProxySelector() {
    override fun select(uri: URI?): MutableList<Proxy> {
        if (uri == null) return mutableListOf(Proxy.NO_PROXY)

        val context = BridgeProxyContext.current() ?: ConfigManager.config.proxy.toBridgeProxySettings()
        if (!context.isConfigured()) {
            return delegateSelect(uri)
        }

        val host = uri.host?.trim()?.takeIf { it.isNotBlank() } ?: return delegateSelect(uri)
        if (context.shouldBypass(host)) {
            return mutableListOf(Proxy.NO_PROXY)
        }

        val address = InetSocketAddress(context.hostname, context.port)
        return mutableListOf(Proxy(Proxy.Type.HTTP, address))
    }

    override fun connectFailed(
        uri: URI?,
        sa: SocketAddress?,
        ioe: IOException?,
    ) {
        delegate?.connectFailed(uri, sa, ioe)
    }

    private fun delegateSelect(uri: URI): MutableList<Proxy> {
        return try {
            delegate?.select(uri)?.toMutableList() ?: mutableListOf(Proxy.NO_PROXY)
        } catch (_: Exception) {
            mutableListOf(Proxy.NO_PROXY)
        }
    }
}
