package mangarr.tachibridge.util

import okhttp3.Cookie
import org.cef.network.CefCookie
import java.util.Date

fun Cookie.toCefCookie(): CefCookie {
    val cookie = this
    return CefCookie(
        cookie.name,
        cookie.value,
        if (cookie.hostOnly) {
            cookie.domain
        } else {
            "." + cookie.domain
        },
        cookie.path,
        cookie.secure,
        cookie.httpOnly,
        Date(),
        null,
        cookie.expiresAt < 253402300799999L, // okhttp3.internal.http.MAX_DATE
        Date(cookie.expiresAt),
    )
}

fun CefCookie.toOkHttpCookie(): Cookie =
    Cookie
        .Builder()
        .name(name)
        .value(value)
        .path(path.takeIf { it.startsWith('/') } ?: "/$path")
        .apply {
            val normalizedDomain = domain.removePrefix(".")
            if (domain.startsWith('.')) {
                domain(normalizedDomain)
            } else {
                hostOnlyDomain(normalizedDomain)
            }
            if (hasExpires) {
                expiresAt(expires.time)
            }
            if (httponly) {
                httpOnly()
            }
            if (secure) {
                secure()
            }
        }.build()
