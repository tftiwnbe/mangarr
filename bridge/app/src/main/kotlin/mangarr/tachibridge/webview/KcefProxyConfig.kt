package mangarr.tachibridge.webview

import mangarr.tachibridge.config.BridgeConfig
import java.util.Locale

data class KcefProxyConfig(
    val hostname: String,
    val port: Int,
    val username: String?,
    val password: String?,
    val bypassList: String?,
) {
    val serverArgument: String
        get() = "--proxy-server=http://${formatHost(hostname)}:$port"

    val bypassArgument: String?
        get() = bypassList?.let { "--proxy-bypass-list=$it" }

    fun matches(
        challengedHost: String,
        challengedPort: Int,
    ): Boolean =
        challengedPort == port &&
            normalizeHost(challengedHost) == normalizeHost(hostname)

    companion object {
        fun from(config: BridgeConfig.Proxy): KcefProxyConfig? {
            val hostname = normalizeHost(config.hostname)
            if (hostname.isBlank() || config.port !in 1..65535) return null

            val username = config.username?.trim()?.takeIf(String::isNotEmpty)
            val ignoredHosts =
                config.ignoredAddresses
                    .split(';')
                    .map(String::trim)
                    .filter(String::isNotEmpty)
                    .toMutableList()
            if (config.bypassLocalAddresses) {
                ignoredHosts += listOf("<local>", "localhost", "127.0.0.1", "[::1]")
            }

            return KcefProxyConfig(
                hostname = hostname,
                port = config.port,
                username = username,
                password = config.password?.takeIf { username != null },
                bypassList = ignoredHosts.distinct().joinToString(";").takeIf(String::isNotEmpty),
            )
        }

        private fun normalizeHost(host: String): String =
            host.trim().removePrefix("[").removeSuffix("]").trimEnd('.').lowercase(Locale.ROOT)

        private fun formatHost(host: String): String = if (host.contains(':')) "[$host]" else host
    }
}
