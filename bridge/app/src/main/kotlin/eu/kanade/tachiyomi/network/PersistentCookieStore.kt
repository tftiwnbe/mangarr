package eu.kanade.tachiyomi.network

import android.content.Context
import okhttp3.Cookie
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okio.withLock
import java.net.CookieStore
import java.net.HttpCookie
import java.net.URI
import java.util.concurrent.locks.ReentrantLock
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

// from TachiWeb-Server
class PersistentCookieStore(
    context: Context,
) : CookieStore {
    private val cookieMap = mutableMapOf<String, List<Cookie>>()
    private val prefs = context.getSharedPreferences("cookie_store", Context.MODE_PRIVATE)

    private val lock = ReentrantLock()

    init {
        lock.withLock {
            val domains =
                prefs.all.keys.toSet()
            val domainsToSave = mutableSetOf<String>()
            domains.forEach { domain ->
                val cookies = prefs.getStringSet(domain, emptySet())
                if (!cookies.isNullOrEmpty()) {
                    try {
                        val url = "http://$domain".toHttpUrlOrNull() ?: return@forEach
                        val nonExpiredCookies =
                            cookies
                                .mapNotNull { Cookie.parse(url, it) }
                                .filter { !it.hasExpired() }
                                .groupBy { it.domain }
                                .mapValues { entry -> entry.value.distinctBy { it.cookieIdentity() } }
                        nonExpiredCookies.forEach { (domain, cookies) ->
                            cookieMap[domain] = cookies
                            domainsToSave.add(domain)
                        }
                        domainsToSave.add(domain)
                    } catch (_: Exception) {
                        // Ignore
                    }
                }
            }
            saveToDisk(domainsToSave)
        }
    }

    fun addAll(
        url: HttpUrl,
        cookies: List<Cookie>,
    ) {
        lock.withLock {
            val domainsToSave = mutableSetOf<String>()
            // Append or replace the cookies for this domain.
            for (cookie in cookies) {
                val cookiesForDomain = cookieMap[cookie.domain].orEmpty().toMutableList()
                // Find a cookie with the same name. Replace it if found, otherwise add a new one.
                val pos = cookiesForDomain.indexOfFirst { it.cookieIdentity() == cookie.cookieIdentity() }
                if (pos == -1) {
                    cookiesForDomain.add(cookie)
                } else {
                    cookiesForDomain[pos] = cookie
                }
                cookieMap[cookie.domain] = cookiesForDomain
                domainsToSave.add(cookie.domain)
            }

            saveToDisk(domainsToSave.toSet())
        }
    }

    override fun removeAll(): Boolean =
        lock.withLock {
            val wasNotEmpty = cookieMap.isNotEmpty()
            prefs.edit().clear().apply()
            cookieMap.clear()
            wasNotEmpty
        }

    fun replaceDomains(
        domains: Set<String>,
        cookies: List<Cookie>,
    ) {
        val normalizedDomains = domains.map { it.removePrefix(".").lowercase() }.toSet()
        lock.withLock {
            normalizedDomains.forEach(cookieMap::remove)
            cookies
                .asSequence()
                .filter { !it.hasExpired() }
                .filter { it.domain.lowercase() in normalizedDomains }
                .groupBy { it.domain.lowercase() }
                .forEach { (domain, domainCookies) ->
                    cookieMap[domain] = domainCookies.distinctBy { it.cookieIdentity() }
                }
            saveToDisk(normalizedDomains)
        }
    }

    fun remove(uri: URI) {
        val url = uri.toURL()
        lock.withLock {
            prefs.edit().remove(url.host).apply()
            cookieMap.remove(url.host)
        }
    }

    override fun get(uri: URI): List<HttpCookie> {
        val url = uri.toURL()
        return get(url.toHttpUrlOrNull()!!).map {
            it.toHttpCookie()
        }
    }

    operator fun get(url: HttpUrl): List<Cookie> =
        lock.withLock {
            cookieMap.values
                .flatten()
                .filter { !it.hasExpired() && it.matches(url) }
        }

    override fun add(
        uri: URI?,
        cookie: HttpCookie,
    ) {
        lock.withLock {
            val cookie = cookie.toCookie(uri?.host) ?: return@withLock
            val cookiesForDomain = cookieMap[cookie.domain].orEmpty().toMutableList()
            // Find a cookie with the same name. Replace it if found, otherwise add a new one.
            val pos = cookiesForDomain.indexOfFirst { it.name == cookie.name }
            if (pos == -1) {
                cookiesForDomain.add(cookie)
            } else {
                cookiesForDomain[pos] = cookie
            }
            cookieMap[cookie.domain] = cookiesForDomain
            saveToDisk(setOf(cookie.domain))
        }
    }

    override fun getCookies(): List<HttpCookie> =
        lock.withLock {
            cookieMap.values.flatMap { it ->
                it.map {
                    it.toHttpCookie()
                }
            }
        }

    fun getStoredCookies(): List<Cookie> =
        lock.withLock {
            cookieMap.values.flatMap { it }
        }

    override fun getURIs(): List<URI> =
        lock.withLock {
            cookieMap.keys.toList().map {
                URI("http://$it")
            }
        }

    override fun remove(
        uri: URI?,
        cookie: HttpCookie,
    ): Boolean =
        lock.withLock {
            val cookie = cookie.toCookie(uri?.host) ?: return@withLock false
            val cookies = cookieMap[cookie.domain].orEmpty()
            val index =
                cookies.indexOfFirst {
                    it.cookieIdentity() == cookie.cookieIdentity()
                }
            if (index >= 0) {
                val newList = cookies.toMutableList()
                newList.removeAt(index)
                cookieMap[cookie.domain] = newList.toList()
                saveToDisk(setOf(cookie.domain))
                true
            } else {
                false
            }
        }

    private fun saveToDisk(domains: Set<String>) {
        // Get cookies to be stored in disk
        prefs
            .edit()
            .apply {
                domains.forEach { domain ->
                    val newValues =
                        cookieMap[domain]
                            .orEmpty()
                            .asSequence()
                            // WebView login cookies are frequently session-scoped but still need to
                            // survive a bridge restart, just like Android WebView's flushed store.
                            .filter { !it.hasExpired() }
                            .map(Cookie::toString)
                            .toSet()
                    if (newValues.isNotEmpty()) {
                        remove(domain)
                        putStringSet(domain, newValues)
                    } else {
                        remove(domain)
                    }
                }
            }.apply()
    }

    private fun Cookie.hasExpired() = System.currentTimeMillis() >= expiresAt

    private fun Cookie.cookieIdentity() = Triple(name, domain.lowercase(), path)

    private fun HttpCookie.toCookie(urlDomain: String?): Cookie? {
        return Cookie
            .Builder()
            .name(name)
            .value(value)
            .domain((domain ?: urlDomain ?: return null).removePrefix("."))
            .path(path ?: "/")
            .also {
                if (maxAge != -1L) {
                    it.expiresAt(System.currentTimeMillis() + maxAge.seconds.inWholeMilliseconds)
                } else {
                    it.expiresAt(Long.MAX_VALUE)
                }
                if (secure) {
                    it.secure()
                }
                if (isHttpOnly) {
                    it.httpOnly()
                }
                if (domain != null && !domain.startsWith('.')) {
                    it.hostOnlyDomain(domain.removePrefix("."))
                }
            }.build()
    }

    private fun Cookie.toHttpCookie(): HttpCookie {
        val it = this
        return HttpCookie(it.name, it.value).apply {
            domain =
                if (hostOnly) {
                    it.domain
                } else {
                    "." + it.domain
                }
            path = it.path
            secure = it.secure
            maxAge =
                if (it.persistent) {
                    (it.expiresAt.milliseconds - System.currentTimeMillis().milliseconds).inWholeSeconds
                } else {
                    -1
                }

            isHttpOnly = it.httpOnly
        }
    }
}
