package mangarr.tachibridge.webview

import dev.datlag.kcef.KCEF
import dev.datlag.kcef.KCEFBrowser
import dev.datlag.kcef.KCEFClient
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.browser.CefRendering
import org.cef.callback.CefAuthCallback
import org.cef.callback.CefMediaAccessCallback
import org.cef.handler.CefDisplayHandlerAdapter
import org.cef.handler.CefLifeSpanHandlerAdapter
import org.cef.handler.CefLoadHandler
import org.cef.handler.CefLoadHandlerAdapter
import org.cef.handler.CefPermissionHandler
import org.cef.handler.CefRenderHandlerAdapter
import org.cef.handler.CefRequestHandlerAdapter
import org.cef.handler.CefResourceRequestHandler
import org.cef.handler.CefResourceRequestHandlerAdapter
import org.cef.misc.BoolRef
import org.cef.network.CefRequest
import java.awt.EventQueue
import java.awt.Rectangle
import java.awt.event.InputEvent
import java.awt.event.KeyEvent
import java.awt.event.MouseEvent
import java.awt.event.MouseWheelEvent
import java.awt.image.BufferedImage
import java.awt.image.DataBufferInt
import java.io.ByteArrayOutputStream
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import javax.imageio.ImageIO
import javax.swing.JPanel
import kotlin.math.sign

data class RemoteInputEvent(
    val eventType: String,
    val x: Float,
    val y: Float,
    val button: Int,
    val deltaY: Float,
    val key: String?,
    val ctrlKey: Boolean,
    val shiftKey: Boolean,
    val metaKey: Boolean,
) {
    companion object {
        fun from(message: JsonObject): RemoteInputEvent? {
            val eventType = message["eventType"]?.jsonPrimitive?.contentOrNull ?: return null
            return RemoteInputEvent(
                eventType = eventType,
                x = message["x"]?.jsonPrimitive?.floatOrNull ?: 0f,
                y = message["y"]?.jsonPrimitive?.floatOrNull ?: 0f,
                button = message["button"]?.jsonPrimitive?.intOrNull ?: 0,
                deltaY = message["deltaY"]?.jsonPrimitive?.floatOrNull ?: 0f,
                key = message["key"]?.jsonPrimitive?.contentOrNull,
                ctrlKey = message["ctrlKey"]?.jsonPrimitive?.booleanOrNull ?: false,
                shiftKey = message["shiftKey"]?.jsonPrimitive?.booleanOrNull ?: false,
                metaKey = message["metaKey"]?.jsonPrimitive?.booleanOrNull ?: false,
            )
        }
    }
}

class KcefRemoteBrowser(
    private val launch: ExtensionWebViewLaunch,
    private val sink: WebViewClientSink,
    private val cookieSync: KcefCookieSync,
    private val proxyConfig: KcefProxyConfig? = null,
) {
    private data class RenderFrame(
        val width: Int,
        val height: Int,
        val pixels: IntArray,
    )

    private val logger = KotlinLogging.logger {}
    private val requestPolicy = WebViewRequestPolicy(launch.trustedHosts)
    private val renderHandler = RenderHandler()
    private val pendingFrame = AtomicReference<RenderFrame?>()
    private val encoderRunning = AtomicBoolean(false)
    private val frameEncoder =
        Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "webview-frame-encoder").apply { isDaemon = true }
        }
    private val firstNavigation = AtomicBoolean(true)
    private val closed = AtomicBoolean(false)
    private var client: KCEFClient? = null
    private var browser: KCEFBrowser? = null
    @Volatile private var width = DEFAULT_WIDTH
    @Volatile private var height = DEFAULT_HEIGHT

    fun start() {
        check(!closed.get()) { "WebView browser is already closed" }
        client =
            KCEF.newClientBlocking().apply {
                addDisplayHandler(DisplayHandler())
                addLoadHandler(LoadHandler())
                addRequestHandler(RequestHandler())
                addPermissionHandler(DenyPermissionHandler())
                addLifeSpanHandler(PopupHandler())
            }
        browser =
            client!!
                .createBrowser(
                    launch.initialUrl,
                    CefRendering.CefRenderingWithHandler(renderHandler, JPanel()),
                    false,
                ).apply {
                    createImmediately()
                    setWindowlessFrameRate(MAX_FRAME_RATE)
                    setFocus(true)
                }
        sendNavigationState()
    }

    fun resize(
        requestedWidth: Int,
        requestedHeight: Int,
    ) {
        width = requestedWidth.coerceIn(MIN_WIDTH, MAX_WIDTH)
        height = requestedHeight.coerceIn(MIN_HEIGHT, MAX_HEIGHT)
        browser?.wasResized(width, height)
    }

    fun goBack() {
        browser?.takeIf(CefBrowser::canGoBack)?.goBack()
    }

    fun goForward() {
        browser?.takeIf(CefBrowser::canGoForward)?.goForward()
    }

    fun reload() {
        browser?.reload()
    }

    fun paste(value: String) {
        val current = browser ?: return
        val component = current.uiComponent ?: return
        current.setFocus(true)
        value.forEach { char -> sendCharacter(current, component, char) }
    }

    fun input(event: RemoteInputEvent) {
        val current = browser ?: return
        val component = current.uiComponent ?: return
        val modifiers =
            (if (event.ctrlKey) InputEvent.CTRL_DOWN_MASK else 0) or
                (if (event.shiftKey) InputEvent.SHIFT_DOWN_MASK else 0) or
                (if (event.metaKey) InputEvent.META_DOWN_MASK else 0)
        val x = event.x.toInt().coerceIn(0, width - 1)
        val y = event.y.toInt().coerceIn(0, height - 1)

        when (event.eventType) {
            "mousemove", "mousedown", "mouseup", "click" -> {
                val id =
                    when (event.eventType) {
                        "mousedown" -> MouseEvent.MOUSE_PRESSED
                        "mouseup" -> MouseEvent.MOUSE_RELEASED
                        "click" -> MouseEvent.MOUSE_CLICKED
                        else -> MouseEvent.MOUSE_MOVED
                    }
                val button =
                    when (event.button) {
                        1 -> MouseEvent.BUTTON2
                        2 -> MouseEvent.BUTTON3
                        else -> MouseEvent.BUTTON1
                    }
                val buttonMask =
                    when (button) {
                        MouseEvent.BUTTON2 -> InputEvent.BUTTON2_DOWN_MASK
                        MouseEvent.BUTTON3 -> InputEvent.BUTTON3_DOWN_MASK
                        else -> InputEvent.BUTTON1_DOWN_MASK
                    }
                val eventModifiers =
                    if (id == MouseEvent.MOUSE_PRESSED) {
                        modifiers or buttonMask
                    } else {
                        modifiers
                    }
                current.sendMouseEvent(
                    MouseEvent(
                        component,
                        id,
                        System.currentTimeMillis(),
                        eventModifiers,
                        x,
                        y,
                        if (id == MouseEvent.MOUSE_PRESSED || id == MouseEvent.MOUSE_RELEASED) 1 else 0,
                        event.button == 2,
                        if (id == MouseEvent.MOUSE_MOVED) MouseEvent.NOBUTTON else button,
                    ),
                )
            }

            "wheel" -> {
                val rotation = event.deltaY.sign.toInt().takeIf { it != 0 } ?: 1
                current.sendMouseWheelEvent(
                    MouseWheelEvent(
                        component,
                        MouseEvent.MOUSE_WHEEL,
                        System.currentTimeMillis(),
                        modifiers,
                        x,
                        y,
                        0,
                        false,
                        MouseWheelEvent.WHEEL_UNIT_SCROLL,
                        3,
                        rotation,
                    ),
                )
            }

            "keydown", "keyup" -> sendKeyEvent(current, component, event, modifiers)
        }
    }

    fun close(flushCookies: Boolean) {
        if (!closed.compareAndSet(false, true)) return
        if (flushCookies) {
            runCatching(cookieSync::flushToNetworkStore).onFailure { error ->
                logger.warn(error) { "Failed to flush WebView cookies for ${launch.packageName}" }
            }
        }
        // CefClient.dispose() owns the asynchronous browser shutdown and keeps its handlers alive
        // until CEF delivers onBeforeClose. Closing the browser separately races that lifecycle and
        // can make native CEF process the same off-screen browser more than once.
        browser = null
        client?.let { current -> runCatching(current::dispose) }
        client = null
        frameEncoder.shutdownNow()
    }

    private fun sendKeyEvent(
        current: CefBrowser,
        component: java.awt.Component,
        event: RemoteInputEvent,
        modifiers: Int,
    ) {
        val key = event.key ?: return
        val char = key.singleOrNull() ?: KeyEvent.CHAR_UNDEFINED
        val code = specialKeyCode(key) ?: char.takeIf { it != KeyEvent.CHAR_UNDEFINED }?.code?.let(KeyEvent::getExtendedKeyCodeForChar)
        if (code == null || code == KeyEvent.VK_UNDEFINED) return
        val id = if (event.eventType == "keydown") KeyEvent.KEY_PRESSED else KeyEvent.KEY_RELEASED
        current.sendKeyEvent(
            KeyEvent(component, id, System.currentTimeMillis(), modifiers, code, char, KeyEvent.KEY_LOCATION_STANDARD),
        )
        if (event.eventType == "keydown" && char != KeyEvent.CHAR_UNDEFINED) {
            sendTypedEvent(current, component, char, modifiers)
        }
    }

    private fun sendCharacter(
        current: CefBrowser,
        component: java.awt.Component,
        char: Char,
    ) {
        val code =
            when (char) {
                '\n', '\r' -> KeyEvent.VK_ENTER
                '\t' -> KeyEvent.VK_TAB
                else -> KeyEvent.getExtendedKeyCodeForChar(char.code)
            }
        if (code == KeyEvent.VK_UNDEFINED) {
            sendTypedEvent(current, component, char, 0)
            return
        }
        val modifiers = if (char.isUpperCase()) InputEvent.SHIFT_DOWN_MASK else 0
        val keyChar = if (char == '\n' || char == '\r' || char == '\t') KeyEvent.CHAR_UNDEFINED else char
        val timestamp = System.currentTimeMillis()
        current.sendKeyEvent(
            KeyEvent(
                component,
                KeyEvent.KEY_PRESSED,
                timestamp,
                modifiers,
                code,
                keyChar,
                KeyEvent.KEY_LOCATION_STANDARD,
            ),
        )
        if (keyChar != KeyEvent.CHAR_UNDEFINED) {
            sendTypedEvent(current, component, keyChar, modifiers)
        }
        current.sendKeyEvent(
            KeyEvent(
                component,
                KeyEvent.KEY_RELEASED,
                timestamp,
                modifiers,
                code,
                keyChar,
                KeyEvent.KEY_LOCATION_STANDARD,
            ),
        )
    }

    private fun sendTypedEvent(
        current: CefBrowser,
        component: java.awt.Component,
        char: Char,
        modifiers: Int,
    ) {
        current.sendKeyEvent(
            KeyEvent(
                component,
                KeyEvent.KEY_TYPED,
                System.currentTimeMillis(),
                modifiers,
                KeyEvent.VK_UNDEFINED,
                char,
                KeyEvent.KEY_LOCATION_UNKNOWN,
            ),
        )
    }

    private fun specialKeyCode(key: String): Int? =
        when (key) {
            "Backspace" -> KeyEvent.VK_BACK_SPACE
            "Delete" -> KeyEvent.VK_DELETE
            "Enter" -> KeyEvent.VK_ENTER
            "Escape" -> KeyEvent.VK_ESCAPE
            "Tab" -> KeyEvent.VK_TAB
            "ArrowLeft" -> KeyEvent.VK_LEFT
            "ArrowRight" -> KeyEvent.VK_RIGHT
            "ArrowUp" -> KeyEvent.VK_UP
            "ArrowDown" -> KeyEvent.VK_DOWN
            "Home" -> KeyEvent.VK_HOME
            "End" -> KeyEvent.VK_END
            "PageUp" -> KeyEvent.VK_PAGE_UP
            "PageDown" -> KeyEvent.VK_PAGE_DOWN
            "Shift" -> KeyEvent.VK_SHIFT
            "Control" -> KeyEvent.VK_CONTROL
            "Meta" -> KeyEvent.VK_META
            else -> null
        }

    private inner class DisplayHandler : CefDisplayHandlerAdapter() {
        override fun onAddressChange(
            browser: CefBrowser,
            frame: CefFrame,
            url: String,
        ) {
            if (!frame.isMain) return
            sink.sendText(
                buildJsonObject {
                    put("type", "address")
                    put("url", url)
                }.toString(),
            )
            sendNavigationState()
        }

        override fun onTitleChange(
            browser: CefBrowser,
            title: String,
        ) {
            sink.sendText(
                buildJsonObject {
                    put("type", "title")
                    put("title", title)
                }.toString(),
            )
        }
    }

    private inner class LoadHandler : CefLoadHandlerAdapter() {
        override fun onLoadingStateChange(
            browser: CefBrowser,
            isLoading: Boolean,
            canGoBack: Boolean,
            canGoForward: Boolean,
        ) {
            sink.sendText(
                buildJsonObject {
                    put("type", "loading")
                    put("loading", isLoading)
                    put("canGoBack", canGoBack)
                    put("canGoForward", canGoForward)
                }.toString(),
            )
        }

        override fun onLoadEnd(
            browser: CefBrowser,
            frame: CefFrame,
            httpStatusCode: Int,
        ) {
            if (!frame.isMain) return
            sink.sendText(
                buildJsonObject {
                    put("type", "load")
                    put("url", frame.url)
                    put("status", httpStatusCode)
                }.toString(),
            )
        }

        override fun onLoadError(
            browser: CefBrowser,
            frame: CefFrame,
            errorCode: CefLoadHandler.ErrorCode,
            errorText: String,
            failedUrl: String,
        ) {
            if (!frame.isMain || errorCode == CefLoadHandler.ErrorCode.ERR_ABORTED) return
            sink.sendText(
                buildJsonObject {
                    put("type", "loadError")
                    put("url", failedUrl)
                    put("message", errorText)
                }.toString(),
            )
        }
    }

    private inner class RequestHandler : CefRequestHandlerAdapter() {
        override fun onBeforeBrowse(
            browser: CefBrowser,
            frame: CefFrame,
            request: CefRequest,
            userGesture: Boolean,
            isRedirect: Boolean,
        ): Boolean = !requestPolicy.allows(request.url, navigation = true)

        override fun getResourceRequestHandler(
            browser: CefBrowser,
            frame: CefFrame,
            request: CefRequest,
            isNavigation: Boolean,
            isDownload: Boolean,
            requestInitiator: String,
            disableDefaultHandling: BoolRef,
        ): CefResourceRequestHandler = ResourceHandler(isNavigation, isDownload)

        override fun getAuthCredentials(
            browser: CefBrowser,
            originUrl: String,
            isProxy: Boolean,
            host: String,
            port: Int,
            realm: String,
            scheme: String,
            callback: CefAuthCallback,
        ): Boolean {
            val proxy = proxyConfig ?: return false
            val username = proxy.username ?: return false
            if (!isProxy || !proxy.matches(host, port)) return false
            callback.Continue(username, proxy.password.orEmpty())
            return true
        }
    }

    private inner class ResourceHandler(
        private val navigation: Boolean,
        private val download: Boolean,
    ) : CefResourceRequestHandlerAdapter() {
        override fun onBeforeResourceLoad(
            browser: CefBrowser?,
            frame: CefFrame?,
            request: CefRequest,
        ): Boolean {
            if (download || !requestPolicy.allows(request.url, navigation)) return true
            if (navigation && frame?.isMain == true && firstNavigation.compareAndSet(true, false)) {
                launch.headers.forEach { (name, value) -> request.setHeaderByName(name, value, true) }
            }
            return false
        }

    }

    private inner class PopupHandler : CefLifeSpanHandlerAdapter() {
        override fun onBeforePopup(
            browser: CefBrowser,
            frame: CefFrame,
            targetUrl: String,
            targetFrameName: String,
        ): Boolean {
            if (requestPolicy.allows(targetUrl, navigation = true)) {
                // CEF may ignore re-entrant navigation while it is still deciding whether to
                // create the popup. Cancel it first, then reuse the current browser on the UI loop.
                EventQueue.invokeLater {
                    if (!closed.get()) browser.loadURL(targetUrl)
                }
            }
            return true
        }
    }

    private class DenyPermissionHandler : CefPermissionHandler {
        override fun onRequestMediaAccessPermission(
            browser: CefBrowser,
            frame: CefFrame,
            requestingUrl: String,
            requestedPermissions: Int,
            callback: CefMediaAccessCallback,
        ): Boolean {
            callback.Cancel()
            return true
        }
    }

    private inner class RenderHandler : CefRenderHandlerAdapter() {
        private var baseFrame: RenderFrame? = null
        private var popupRect: Rectangle? = null

        override fun getViewRect(browser: CefBrowser): Rectangle = Rectangle(0, 0, width, height)

        override fun onPopupSize(
            browser: CefBrowser,
            size: Rectangle,
        ) {
            popupRect = size
        }

        @Synchronized
        override fun onPaint(
            browser: CefBrowser,
            popup: Boolean,
            dirtyRects: Array<Rectangle>,
            buffer: ByteBuffer,
            frameWidth: Int,
            frameHeight: Int,
        ) {
            if (closed.get() || frameWidth <= 0 || frameHeight <= 0) return
            val pixels = IntArray(frameWidth * frameHeight)
            buffer.order(ByteOrder.LITTLE_ENDIAN).asIntBuffer().get(pixels)
            val rendered =
                if (!popup) {
                    RenderFrame(frameWidth, frameHeight, pixels).also { baseFrame = it }
                } else {
                    compositePopup(baseFrame, popupRect, frameWidth, frameHeight, pixels) ?: return
                }
            pendingFrame.set(rendered)
            scheduleEncoding()
        }
    }

    private fun compositePopup(
        base: RenderFrame?,
        rect: Rectangle?,
        popupWidth: Int,
        popupHeight: Int,
        popupPixels: IntArray,
    ): RenderFrame? {
        if (base == null || rect == null) return null
        val combined = base.pixels.copyOf()
        val sourceX = (-rect.x).coerceAtLeast(0)
        val sourceY = (-rect.y).coerceAtLeast(0)
        val destinationX = rect.x.coerceAtLeast(0)
        val destinationY = rect.y.coerceAtLeast(0)
        val copyWidth =
            minOf(popupWidth - sourceX, rect.width - sourceX, base.width - destinationX).coerceAtLeast(0)
        val copyHeight =
            minOf(popupHeight - sourceY, rect.height - sourceY, base.height - destinationY).coerceAtLeast(0)
        for (row in 0 until copyHeight) {
            popupPixels.copyInto(
                combined,
                destinationOffset = (destinationY + row) * base.width + destinationX,
                startIndex = (sourceY + row) * popupWidth + sourceX,
                endIndex = (sourceY + row) * popupWidth + sourceX + copyWidth,
            )
        }
        return RenderFrame(base.width, base.height, combined)
    }

    private fun scheduleEncoding() {
        if (!encoderRunning.compareAndSet(false, true)) return
        frameEncoder.execute {
            try {
                while (!closed.get()) {
                    val frame = pendingFrame.getAndSet(null) ?: break
                    val startedAt = System.nanoTime()
                    val image = BufferedImage(frame.width, frame.height, BufferedImage.TYPE_INT_ARGB_PRE)
                    frame.pixels.copyInto((image.raster.dataBuffer as DataBufferInt).data)
                    val output = ByteArrayOutputStream()
                    if (ImageIO.write(image, "png", output)) {
                        sink.sendBinary(output.toByteArray())
                    }
                    val elapsedMs = (System.nanoTime() - startedAt) / 1_000_000L
                    val delayMs = FRAME_INTERVAL_MS - elapsedMs
                    if (delayMs > 0) Thread.sleep(delayMs)
                }
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            } catch (error: Exception) {
                if (!closed.get()) logger.warn(error) { "Failed to encode WebView frame" }
            } finally {
                encoderRunning.set(false)
                if (pendingFrame.get() != null && !closed.get()) scheduleEncoding()
            }
        }
    }

    private fun sendNavigationState() {
        val current = browser ?: return
        sink.sendText(
            buildJsonObject {
                put("type", "navigation")
                put("canGoBack", current.canGoBack())
                put("canGoForward", current.canGoForward())
            }.toString(),
        )
    }

    private class WebViewRequestPolicy(
        trustedHosts: Set<String>,
    ) {
        private val trustedHosts = trustedHosts.map(String::lowercase).toSet()
        private val publicHostCache = ConcurrentHashMap<String, Boolean>()

        fun allows(
            rawUrl: String?,
            navigation: Boolean,
        ): Boolean {
            val uri = runCatching { URI(rawUrl) }.getOrNull() ?: return false
            val scheme = uri.scheme?.lowercase() ?: return false
            if (!navigation && scheme in setOf("data", "blob")) return true
            if (scheme !in setOf("http", "https")) return false
            val host = uri.host?.lowercase() ?: return false
            if (host in trustedHosts) return true
            if (host == "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false
            return publicHostCache.computeIfAbsent(host, ::isPublicHost)
        }

        private fun isPublicHost(host: String): Boolean =
            runCatching {
                InetAddress.getAllByName(host).let { addresses ->
                    addresses.isNotEmpty() && addresses.all(::isPublicAddress)
                }
            }.getOrDefault(false)

        private fun isPublicAddress(address: InetAddress): Boolean {
            if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress ||
                address.isSiteLocalAddress || address.isMulticastAddress
            ) {
                return false
            }
            if (address is Inet6Address) {
                val first = address.address.first().toInt() and 0xff
                if (first and 0xfe == 0xfc) return false
            }
            return true
        }
    }

    companion object {
        private const val DEFAULT_WIDTH = 1100
        private const val DEFAULT_HEIGHT = 800
        private const val MIN_WIDTH = 320
        private const val MIN_HEIGHT = 240
        private const val MAX_WIDTH = 1920
        private const val MAX_HEIGHT = 1080
        private const val MAX_FRAME_RATE = 15
        private const val FRAME_INTERVAL_MS = 1000L / MAX_FRAME_RATE
    }
}
