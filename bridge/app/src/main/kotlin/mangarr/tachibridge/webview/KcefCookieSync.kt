package mangarr.tachibridge.webview

import eu.kanade.tachiyomi.network.PersistentCookieStore
import io.github.oshai.kotlinlogging.KotlinLogging
import mangarr.tachibridge.util.toCefCookie
import mangarr.tachibridge.util.toOkHttpCookie
import okhttp3.Cookie
import org.cef.callback.CefCompletionCallback
import org.cef.network.CefCookieManager
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class KcefCookieSync(
    private val cookieStore: PersistentCookieStore,
    private val cookieManager: CefCookieManager = CefCookieManager.getGlobalManager(),
) {
    private val logger = KotlinLogging.logger {}

    fun loadIntoBrowser() {
        cookieStore.getStoredCookies().forEach { cookie ->
            val scheme = if (cookie.secure) "https" else "http"
            val url = "$scheme://${cookie.domain.removePrefix(".")}${cookie.path}"
            if (!cookieManager.setCookie(url, cookie.toCefCookie())) {
                logger.warn { "Failed to load browser cookie domain=${cookie.domain} name=${cookie.name}" }
            }
        }
        cookieManager.flushStore(null)
    }

    fun flushToNetworkStore(timeoutMs: Long = 2_000L) {
        val cookies = mutableListOf<Cookie>()
        val completed = CountDownLatch(1)
        val existingDomains = cookieStore.getStoredCookies().map { it.domain.lowercase() }.toMutableSet()
        val visitStarted =
            cookieManager.visitAllCookies { cefCookie, count, total, _ ->
                runCatching { cefCookie.toOkHttpCookie() }
                    .onSuccess { cookie ->
                        synchronized(cookies) {
                            cookies += cookie
                            existingDomains += cookie.domain.lowercase()
                        }
                    }.onFailure { error ->
                        logger.warn(error) {
                            "Failed to persist browser cookie domain=${cefCookie.domain} name=${cefCookie.name}"
                        }
                    }
                if (count + 1 >= total) {
                    completed.countDown()
                }
                true
            }
        if (!visitStarted) {
            logger.warn { "CEF refused browser cookie enumeration" }
            return
        }
        if (!completed.await(timeoutMs, TimeUnit.MILLISECONDS)) {
            logger.warn { "Timed out waiting for browser cookie enumeration" }
            return
        }
        val snapshot = synchronized(cookies) { cookies.toList() }
        val domains = synchronized(cookies) { existingDomains.toSet() }
        cookieStore.replaceDomains(domains, snapshot)
        cookieManager.flushStore(
            object : CefCompletionCallback {
                override fun onComplete() = Unit
            },
        )
    }

    fun clearDomains(domains: Set<String>) {
        val normalized = domains.map { it.removePrefix(".").lowercase() }.toSet()
        normalized.forEach { domain ->
            cookieManager.deleteCookies("https://$domain", "")
            cookieManager.deleteCookies("http://$domain", "")
        }
        cookieStore.replaceDomains(normalized, emptyList())
        cookieManager.flushStore(null)
    }
}
