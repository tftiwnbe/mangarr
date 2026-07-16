package mangarr.tachibridge.webview

import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import mangarr.tachibridge.extensions.ExtensionManager
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID

data class WebViewSessionTicket(
    val sessionId: String,
    val ticket: String,
    val packageName: String,
    val extensionName: String,
    val sourceId: Long,
    val sourceName: String,
    val initialUrl: String,
    val expiresAt: Long,
)

class WebViewUnavailableException(
    message: String,
) : IllegalStateException(message)

interface WebViewClientSink {
    fun sendText(message: String)

    fun sendBinary(bytes: ByteArray)

    fun close(
        code: Int,
        reason: String,
    )
}

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
class WebViewSessionManager(
    private val extensionManager: ExtensionManager,
    private val cookieSync: KcefCookieSync,
    private val proxyConfig: KcefProxyConfig? = null,
    private val browserReady: () -> Boolean = { true },
    private val now: () -> Long = System::currentTimeMillis,
) {
    private data class Session(
        val sessionId: String,
        val ticket: ByteArray,
        val launch: ExtensionWebViewLaunch,
        val expiresAt: Long,
        val createdAt: Long,
        var sink: WebViewClientSink? = null,
        var browser: KcefRemoteBrowser? = null,
        var lastActivityAt: Long,
    )

    private val logger = KotlinLogging.logger {}
    private val json = Json { ignoreUnknownKeys = true }
    private val secureRandom = SecureRandom()
    private val lock = Any()
    private var active: Session? = null

    suspend fun create(
        packageName: String,
        preferredSourceId: Long? = null,
        preferredUrl: String? = null,
    ): WebViewSessionTicket {
        if (!browserReady()) {
            throw WebViewUnavailableException("WebView is still initializing or unavailable")
        }
        val launch = extensionManager.resolveWebViewLaunch(packageName, preferredSourceId, preferredUrl)
        val rawTicket = ByteArray(TICKET_BYTES).also(secureRandom::nextBytes)
        val encodedTicket = Base64.getUrlEncoder().withoutPadding().encodeToString(rawTicket)
        val session =
            Session(
                sessionId = UUID.randomUUID().toString(),
                ticket = rawTicket,
                launch = launch,
                expiresAt = now() + TICKET_TTL_MS,
                createdAt = now(),
                lastActivityAt = now(),
            )
        val previous = synchronized(lock) { active.also { active = session } }
        previous?.let { closeSession(it, 1001, "Replaced by a new authentication session") }
        logger.info {
            "Created extension WebView session session=${session.sessionId} package=${launch.packageName} source=${launch.sourceId}"
        }
        return WebViewSessionTicket(
            sessionId = session.sessionId,
            ticket = encodedTicket,
            packageName = launch.packageName,
            extensionName = launch.extensionName,
            sourceId = launch.sourceId,
            sourceName = launch.sourceName,
            initialUrl = launch.initialUrl,
            expiresAt = session.expiresAt,
        )
    }

    fun attach(
        encodedTicket: String,
        sink: WebViewClientSink,
    ): String? {
        val supplied = runCatching { Base64.getUrlDecoder().decode(encodedTicket) }.getOrNull() ?: return null
        val session =
            synchronized(lock) {
                val candidate = active ?: return@synchronized null
                if (candidate.sink != null || candidate.expiresAt < now()) return@synchronized null
                if (!MessageDigest.isEqual(candidate.ticket, supplied)) return@synchronized null
                candidate.sink = sink
                candidate.lastActivityAt = now()
                candidate
            } ?: return null

        try {
            cookieSync.loadIntoBrowser()
            val browser =
                KcefRemoteBrowser(
                    launch = session.launch,
                    sink = sink,
                    cookieSync = cookieSync,
                    proxyConfig = proxyConfig,
                )
            synchronized(lock) {
                if (active !== session) {
                    browser.close(flushCookies = false)
                    return null
                }
                session.browser = browser
            }
            browser.start()
            sink.sendText(
                buildJsonObject {
                    put("type", "ready")
                    put("sessionId", session.sessionId)
                    put("packageName", session.launch.packageName)
                    put("extensionName", session.launch.extensionName)
                    put("sourceId", session.launch.sourceId.toString())
                    put("sourceName", session.launch.sourceName)
                    put("initialUrl", session.launch.initialUrl)
                }.toString(),
            )
            logger.info { "Attached extension WebView session session=${session.sessionId}" }
            return session.sessionId
        } catch (error: Exception) {
            logger.error(error) { "Failed to attach extension WebView session session=${session.sessionId}" }
            synchronized(lock) {
                if (active === session) active = null
            }
            session.browser?.close(flushCookies = false)
            sink.sendText(errorMessage("Unable to start WebView session"))
            sink.close(1011, "Unable to start WebView session")
            return null
        }
    }

    fun handleMessage(
        sessionId: String,
        rawMessage: String,
    ) {
        val session = synchronized(lock) { active?.takeIf { it.sessionId == sessionId } } ?: return
        if (rawMessage.length > MAX_CONTROL_MESSAGE_BYTES) {
            session.sink?.close(1009, "Control message is too large")
            return
        }
        synchronized(lock) {
            if (active === session) session.lastActivityAt = now()
        }
        val message = runCatching { json.parseToJsonElement(rawMessage).jsonObject }.getOrNull() ?: return
        val type = message["type"]?.jsonPrimitive?.contentOrNull ?: return
        val browser = session.browser ?: return
        when (type) {
            "resize" -> {
                val width = message["width"]?.jsonPrimitive?.intOrNull ?: return
                val height = message["height"]?.jsonPrimitive?.intOrNull ?: return
                browser.resize(width, height)
            }

            "back" -> browser.goBack()
            "forward" -> browser.goForward()
            "reload" -> browser.reload()
            "input" -> browser.input(RemoteInputEvent.from(message) ?: return)
            "paste" -> {
                val value = message["value"]?.jsonPrimitive?.contentOrNull?.take(MAX_PASTE_CHARS) ?: return
                browser.paste(value)
            }

            "done" -> complete(session)
            "close" -> close(sessionId, 1000, "Closed by user", flushCookies = true)
        }
    }

    fun detach(sessionId: String) {
        close(sessionId, 1001, "WebView client disconnected", flushCookies = true)
    }

    fun close(
        sessionId: String,
        code: Int = 1000,
        reason: String = "Session closed",
        flushCookies: Boolean = true,
    ) {
        val session =
            synchronized(lock) {
                active?.takeIf { it.sessionId == sessionId }?.also { active = null }
            } ?: return
        closeSession(session, code, reason, flushCookies)
    }

    suspend fun clearExtension(packageName: String): Set<String> {
        val matchingSession =
            synchronized(lock) {
                active?.takeIf { it.launch.packageName == packageName }?.also { active = null }
            }
        matchingSession?.let { closeSession(it, 1001, "Extension authentication was cleared", flushCookies = false) }
        val domains = extensionManager.webViewDomains(packageName)
        cookieSync.clearDomains(domains)
        return domains
    }

    fun shutdown() {
        val session = synchronized(lock) { active.also { active = null } }
        session?.let { closeSession(it, 1001, "Bridge shutting down") }
    }

    fun expireInactive() {
        val currentTime = now()
        val expired =
            synchronized(lock) {
                active
                    ?.takeIf { session ->
                        val idleLimit = if (session.sink == null) TICKET_TTL_MS else ATTACHED_IDLE_TTL_MS
                        currentTime - session.lastActivityAt >= idleLimit ||
                            currentTime - session.createdAt >= MAX_SESSION_LIFETIME_MS
                    }?.also { active = null }
            } ?: return
        closeSession(expired, 1001, "WebView session expired")
    }

    private fun complete(session: Session) {
        synchronized(lock) {
            if (active === session) active = null
        }
        session.browser?.close(flushCookies = true)
        session.browser = null
        session.sink?.sendText(buildJsonObject { put("type", "completed") }.toString())
        session.sink?.close(1000, "Authentication session completed")
        logger.info { "Completed extension WebView session session=${session.sessionId}" }
    }

    private fun closeSession(
        session: Session,
        code: Int,
        reason: String,
        flushCookies: Boolean = true,
    ) {
        session.browser?.close(flushCookies)
        session.browser = null
        session.sink?.close(code, reason)
        session.sink = null
        logger.info { "Closed extension WebView session session=${session.sessionId} code=$code" }
    }

    private fun errorMessage(message: String): String =
        buildJsonObject {
            put("type", "error")
            put("message", message)
        }.toString()

    companion object {
        private const val TICKET_BYTES = 32
        private const val TICKET_TTL_MS = 60_000L
        private const val ATTACHED_IDLE_TTL_MS = 15 * 60_000L
        private const val MAX_SESSION_LIFETIME_MS = 30 * 60_000L
        private const val MAX_CONTROL_MESSAGE_BYTES = 16 * 1024
        private const val MAX_PASTE_CHARS = 8 * 1024
    }
}
