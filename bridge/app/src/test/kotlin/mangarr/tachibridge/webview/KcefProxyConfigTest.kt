package mangarr.tachibridge.webview

import mangarr.tachibridge.config.BridgeConfig
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class KcefProxyConfigTest {
    @Test
    fun `returns null for an incomplete proxy`() {
        assertNull(KcefProxyConfig.from(BridgeConfig.Proxy()))
        assertNull(KcefProxyConfig.from(BridgeConfig.Proxy(hostname = "proxy.example", port = 0)))
    }

    @Test
    fun `builds credential-free chromium arguments and local bypasses`() {
        val proxy =
            KcefProxyConfig.from(
                BridgeConfig.Proxy(
                    hostname = " Proxy.Example. ",
                    port = 8443,
                    username = " user ",
                    password = "secret",
                    ignoredAddresses = "example.test; *.internal ;example.test",
                    bypassLocalAddresses = true,
                ),
            )!!

        assertEquals("--proxy-server=http://proxy.example:8443", proxy.serverArgument)
        assertEquals(
            "--proxy-bypass-list=example.test;*.internal;<local>;localhost;127.0.0.1;[::1]",
            proxy.bypassArgument,
        )
        assertFalse(proxy.serverArgument.contains("user"))
        assertFalse(proxy.serverArgument.contains("secret"))
        assertEquals("user", proxy.username)
        assertEquals("secret", proxy.password)
    }

    @Test
    fun `matches proxy authentication challenges by normalized host and port`() {
        val proxy =
            KcefProxyConfig.from(
                BridgeConfig.Proxy(hostname = "2001:db8::1", port = 3128),
            )!!

        assertEquals("--proxy-server=http://[2001:db8::1]:3128", proxy.serverArgument)
        assertTrue(proxy.matches("[2001:DB8::1]", 3128))
        assertFalse(proxy.matches("2001:db8::2", 3128))
        assertFalse(proxy.matches("2001:db8::1", 8080))
    }
}
