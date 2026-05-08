package mangarr.tachibridge.server

import java.net.InetAddress
import java.net.UnknownHostException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class BridgeHttpServerSecurityTest {
    @Test
    fun `resolve pinned remote cover target keeps validated public addresses`() {
        val publicAddress = InetAddress.getByName("93.184.216.34")

        val target =
            resolvePinnedRemoteCoverTarget("https://covers.example/image.webp") { host ->
                assertEquals("covers.example", host)
                listOf(publicAddress)
            }

        assertNotNull(target)
        assertEquals("https://covers.example/image.webp", target.uri.toString())
        assertEquals(listOf(publicAddress), target.resolvedAddresses)
    }

    @Test
    fun `resolve pinned remote cover target rejects private addresses`() {
        val target =
            resolvePinnedRemoteCoverTarget("https://covers.example/image.webp") {
                listOf(InetAddress.getByName("127.0.0.1"))
            }

        assertNull(target)
    }

    @Test
    fun `resolve pinned remote cover target rejects credentials and unsupported schemes`() {
        assertNull(resolvePinnedRemoteCoverTarget("https://user:pass@covers.example/image.webp") { emptyList() })
        assertNull(resolvePinnedRemoteCoverTarget("file:///etc/passwd") { emptyList() })
    }

    @Test
    fun `pinned cover dns only returns validated addresses for the expected host`() {
        val publicAddress = InetAddress.getByName("93.184.216.34")
        val dns = pinnedRemoteCoverDns("covers.example", listOf(publicAddress))

        assertEquals(listOf(publicAddress), dns.lookup("covers.example"))
        assertEquals(listOf(publicAddress), dns.lookup("COVERS.EXAMPLE"))
        assertFailsWith<UnknownHostException> {
            dns.lookup("169.254.169.254.nip.io")
        }
    }
}
