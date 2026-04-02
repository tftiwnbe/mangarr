package eu.kanade.tachiyomi.network.interceptor

import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.network.POST
import eu.kanade.tachiyomi.network.BridgeProxyContext
import eu.kanade.tachiyomi.network.toBridgeProxySettings
import eu.kanade.tachiyomi.network.awaitSuccess
import eu.kanade.tachiyomi.network.parseAs
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import mangarr.tachibridge.config.ConfigManager
import mangarr.tachibridge.config.FlareSolverrConfigProvider
import okhttp3.Cookie
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.jsoup.parser.Parser
import uy.kohesive.injekt.injectLazy
import java.io.IOException
import java.net.Proxy
import java.net.URLEncoder
import java.net.SocketTimeoutException
import kotlin.time.Duration.Companion.seconds
import kotlin.time.toJavaDuration

@kotlinx.serialization.ExperimentalSerializationApi
class CloudflareInterceptor(
    private val setUserAgent: (String) -> Unit,
    private val configProvider: FlareSolverrConfigProvider,
) : Interceptor {
    private val logger = KotlinLogging.logger {}

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        logger.trace { "CloudflareInterceptor is being used." }

        val originalResponse =
            try {
                chain.proceed(originalRequest)
            } catch (e: SocketTimeoutException) {
                val flareConfig = configProvider.config.value
                if (!flareConfig.enabled) {
                    throw e
                }
                logger.debug {
                    "Request timed out for ${originalRequest.url}, trying FlareSolverr before failing"
                }
                return resolveThroughFlareSolverr(
                    originalRequest = originalRequest,
                    originalResponse = null,
                    isKnownCloudflareResponse = false,
                    flareResponseFallback = flareConfig.responseFallback,
                    chain = chain,
                )
            }
        val flareConfig = configProvider.config.value
        val serverHeader = originalResponse.header("Server")
        val isKnownCloudflareResponse =
            originalResponse.code in ERROR_CODES && serverHeader in SERVER_CHECK

        // Attempt bypass for blocked responses when FlareSolverr is enabled.
        if (!(originalResponse.code in ERROR_CODES && flareConfig.enabled)) {
            return originalResponse
        }

        if (isKnownCloudflareResponse) {
            logger.debug { "Cloudflare anti-bot is on, CloudflareInterceptor is kicking in..." }
        } else {
            logger.debug {
                "Blocked response (${originalResponse.code}) from ${originalRequest.url.host} " +
                    "with server=${serverHeader ?: "<unknown>"}, trying FlareSolverr"
            }
        }

        return resolveThroughFlareSolverr(
            originalRequest = originalRequest,
            originalResponse = originalResponse,
            isKnownCloudflareResponse = isKnownCloudflareResponse,
            flareResponseFallback = flareConfig.responseFallback,
            chain = chain,
        )
    }

    private fun resolveThroughFlareSolverr(
        originalRequest: Request,
        originalResponse: Response?,
        isKnownCloudflareResponse: Boolean,
        flareResponseFallback: Boolean,
        chain: Interceptor.Chain,
    ): Response {
        return try {
            originalResponse?.close()

            val flareResponse =
                runBlocking {
                    CFClearance.resolveWithFlareSolver(originalRequest, !flareResponseFallback)
                }

            if (
                flareResponseFallback &&
                flareResponse.solution.status in 200..299 &&
                flareResponse.solution.response != null
            ) {
                val rawResponse = flareResponse.solution.response
                val normalizedResponse = unwrapPreformattedJson(rawResponse)
                val wasUnwrappedFromHtml = normalizedResponse != rawResponse
                val contentType =
                    flareResponse.solution.headers
                        ?.entries
                        ?.firstOrNull { it.key.equals("content-type", ignoreCase = true) }
                        ?.value
                val isImage = CHROME_IMAGE_TEMPLATE_REGEX in rawResponse
                val isHtml = contentType?.contains("text/html", ignoreCase = true) == true
                val isJsonBody = normalizedResponse.trimStart().startsWith("{") ||
                    normalizedResponse.trimStart().startsWith("[")
                val useDirectJsonFallback =
                    !wasUnwrappedFromHtml && !isImage && isJsonBody &&
                        looksLikeUsableApiJson(normalizedResponse)

                if ((wasUnwrappedFromHtml || useDirectJsonFallback) && !isImage && isJsonBody) {
                    logger.debug { "Falling back to FlareSolverr response" }

                    setUserAgent(flareResponse.solution.userAgent)
                    val baseResponseBuilder =
                        originalResponse?.newBuilder()
                            ?: Response
                                .Builder()
                                .request(originalRequest)
                                .protocol(Protocol.HTTP_1_1)
                                .message("FlareSolverr")
                    return baseResponseBuilder
                        .code(flareResponse.solution.status)
                        .body(normalizedResponse.toResponseBody())
                        .build()
                } else if (!wasUnwrappedFromHtml && (!isHtml || isJsonBody)) {
                    logger.debug {
                        "Ignoring direct FlareSolverr body for ${originalRequest.url}; retrying with solved cookies"
                    }
                }
            }

            if (
                isKnownCloudflareResponse &&
                flareResponse.message.contains("not detected", ignoreCase = true)
            ) {
                logger.debug { "FlareSolverr failed to detect Cloudflare challenge" }
            }

            val request = CFClearance.requestWithFlareSolverr(flareResponse, setUserAgent, originalRequest)
            chain.proceed(request)
        } catch (e: Exception) {
            val reason = e.message?.takeIf { it.isNotBlank() } ?: e::class.java.simpleName
            throw IOException("FlareSolverr resolution failed: $reason", e)
        }
    }

    companion object {
        private val ERROR_CODES = listOf(403, 503)
        private val SERVER_CHECK = arrayOf("cloudflare-nginx", "cloudflare")
        private val CHROME_IMAGE_TEMPLATE_REGEX = Regex("""<title>(.*?) \(\d+×\d+\)</title>""")
        private val HTML_PRE_JSON_REGEX = Regex("<pre>([\\s\\S]+?)</pre>", RegexOption.IGNORE_CASE)

        private fun unwrapPreformattedJson(body: String): String {
            val trimmed = body.trimStart()
            if (!trimmed.startsWith("<", ignoreCase = true)) {
                return body
            }
            val preMatch = HTML_PRE_JSON_REGEX.find(body) ?: return body
            val preContent = preMatch.groupValues.getOrNull(1)?.trim() ?: return body
            return Parser.unescapeEntities(preContent, false)
        }

        private fun looksLikeUsableApiJson(body: String): Boolean {
            val trimmed = body.trimStart()
            if (trimmed.startsWith("[")) return true
            if (!trimmed.startsWith("{")) return false
            val lower = trimmed.lowercase()
            val hasData = "\"data\"" in lower
            val hasToast = "\"toast\"" in lower
            val hasError = "\"error\"" in lower || "\"errors\"" in lower
            return hasData && !hasToast && !hasError
        }
    }
}

@kotlinx.serialization.ExperimentalSerializationApi
object CFClearance {
    private val logger = KotlinLogging.logger {}
    private val network: NetworkHelper by injectLazy()

    private fun getClient(): okhttp3.OkHttpClient {
        val flareConfig = FlareSolverrConfigProvider.config.value
        val timeout = flareConfig.timeoutSeconds.seconds
        return network.client
            .newBuilder()
            .proxy(Proxy.NO_PROXY)
            .callTimeout(timeout.plus(10.seconds).toJavaDuration())
            .readTimeout(timeout.plus(5.seconds).toJavaDuration())
            .build()
    }

    private val json =
        Json {
            ignoreUnknownKeys = true
            isLenient = true
        }
    private val jsonMediaType = "application/json".toMediaType()
    private val mutex = Mutex()

    @Serializable
    data class FlareSolverCookie(
        val name: String,
        val value: String,
    )

    @Serializable
    data class FlareSolverRequest(
        val cmd: String,
        val url: String,
        val maxTimeout: Int? = null,
        val session: String? = null,
        @SerialName("session_ttl_minutes")
        val sessionTtlMinutes: Int? = null,
        val cookies: List<FlareSolverCookie>? = null,
        val returnOnlyCookies: Boolean? = null,
        val proxy: String? = null,
        val headers: Map<String, String>? = null,
        val postData: String? = null,
    )

    @Serializable
    data class FlareSolverSolutionCookie(
        val name: String,
        val value: String,
        val domain: String,
        val path: String? = null,
        val expires: Double? = null,
        val size: Int? = null,
        val httpOnly: Boolean? = null,
        val secure: Boolean? = null,
        val session: Boolean? = null,
        val sameSite: String? = null,
    )

    @Serializable
    data class FlareSolverSolution(
        val url: String,
        val status: Int,
        val headers: Map<String, String>? = null,
        val response: String? = null,
        val cookies: List<FlareSolverSolutionCookie>,
        val userAgent: String,
    )

    @Serializable
    data class FlareSolverResponse(
        val solution: FlareSolverSolution,
        val status: String,
        val message: String,
        val startTimestamp: Long,
        val endTimestamp: Long,
        val version: String,
    )

    suspend fun resolveWithFlareSolver(
        originalRequest: Request,
        onlyCookies: Boolean,
    ): FlareSolverResponse {
        val flareConfig = FlareSolverrConfigProvider.config.value
        val timeout = flareConfig.timeoutSeconds.seconds

        return mutex.withLock {
            val requestPayload =
                Json
                    .encodeToString(
                        FlareSolverRequest(
                            "request.get",
                            originalRequest.url.toString(),
                            session = flareConfig.sessionName,
                            sessionTtlMinutes = flareConfig.sessionTtlMinutes,
                            cookies =
                                network.cookieStore.get(originalRequest.url).map {
                                    FlareSolverCookie(it.name, it.value)
                                },
                            proxy = buildFlareSolverProxy(originalRequest),
                            headers = buildFlareSolverHeaders(originalRequest),
                            returnOnlyCookies = onlyCookies,
                            maxTimeout = timeout.inWholeMilliseconds.toInt(),
                        ),
                    ).toRequestBody(jsonMediaType)
            val endpoints = buildFlareSolverEndpoints(flareConfig.url)
            var lastError: Exception? = null

            for (endpoint in endpoints) {
                try {
                    val responseBody =
                        getClient()
                            .newCall(
                                POST(
                                    url = endpoint,
                                    body = requestPayload,
                                ),
                            ).awaitSuccess()
                            .use { response ->
                                response.body?.string()
                                    ?: throw IOException("Empty FlareSolverr response")
                            }
                    return@withLock json.decodeFromString<FlareSolverResponse>(responseBody)
                } catch (e: Exception) {
                    lastError = e
                }
            }

            throw IOException(
                "Unable to call FlareSolverr at ${flareConfig.url}. Tried: ${endpoints.joinToString()}",
                lastError,
            )
        }
    }

    private fun buildFlareSolverEndpoints(rawUrl: String): List<String> {
        val base = rawUrl.trim().removeSuffix("/")
        if (base.isEmpty()) return listOf("/v1")

        fun withV1(url: String): String =
            if (url.endsWith("/v1")) url else "$url/v1"

        val endpoints = linkedSetOf<String>()
        endpoints += withV1(base)

        if (base.startsWith("http://")) {
            val httpsBase = "https://" + base.removePrefix("http://")
            endpoints += withV1(httpsBase)
        }

        return endpoints.toList()
    }

    private fun buildFlareSolverProxy(originalRequest: Request): String? {
        val proxySettings = BridgeProxyContext.current() ?: ConfigManager.config.proxy.toBridgeProxySettings()
        if (!proxySettings.isConfigured()) return null

        val requestHost = originalRequest.url.host
        if (proxySettings.shouldBypass(requestHost)) {
            return null
        }

        val encodedUser = proxySettings.username?.trim().orEmpty().takeIf { it.isNotBlank() }?.let(::encodeProxyPart)
        val encodedPass = proxySettings.password.orEmpty().takeIf { encodedUser != null }?.let(::encodeProxyPart)
        val authPart =
            if (encodedUser != null) {
                "$encodedUser:${encodedPass.orEmpty()}@"
            } else {
                ""
            }

        return "http://$authPart${proxySettings.hostname}:${proxySettings.port}"
    }

    private fun encodeProxyPart(value: String): String =
        URLEncoder.encode(value, Charsets.UTF_8).replace("+", "%20")

    private fun buildFlareSolverHeaders(originalRequest: Request): Map<String, String>? {
        val blockedHeaders =
            setOf(
                "host",
                "content-length",
            )

        val headers = linkedMapOf<String, String>()
        for (name in originalRequest.headers.names()) {
            if (name.lowercase() in blockedHeaders) continue
            val value = originalRequest.header(name)?.trim().orEmpty()
            if (value.isNotEmpty()) {
                headers[name] = value
            }
        }
        return headers.takeIf { it.isNotEmpty() }
    }

    fun requestWithFlareSolverr(
        flareSolverResponse: FlareSolverResponse,
        setUserAgent: (String) -> Unit,
        originalRequest: Request,
    ): Request {
        if (flareSolverResponse.solution.status in 200..299) {
            setUserAgent(flareSolverResponse.solution.userAgent)
            val cookies =
                flareSolverResponse.solution.cookies
                    .map { cookie ->
                        Cookie
                            .Builder()
                            .name(cookie.name)
                            .value(cookie.value)
                            .domain(cookie.domain.removePrefix("."))
                            .also {
                                if (cookie.httpOnly != null && cookie.httpOnly) it.httpOnly()
                                if (cookie.secure != null && cookie.secure) it.secure()
                                if (!cookie.path.isNullOrEmpty()) it.path(cookie.path)
                                if (cookie.expires != null && cookie.expires > 0) {
                                    it.expiresAt((cookie.expires * 1000).toLong())
                                }
                                if (!cookie.domain.startsWith('.')) {
                                    it.hostOnlyDomain(cookie.domain.removePrefix("."))
                                }
                            }.build()
                    }.groupBy { it.domain }
                    .flatMap { (domain, cookies) ->
                        network.cookieStore.addAll(
                            HttpUrl
                                .Builder()
                                .scheme("http")
                                .host(domain.removePrefix("."))
                                .build(),
                            cookies,
                        )

                        cookies
                    }
            logger.trace { "New cookies\n${cookies.joinToString("; ")}" }
            val finalCookies =
                network.cookieStore.get(originalRequest.url).joinToString("; ", postfix = "; ") {
                    "${it.name}=${it.value}"
                }
            logger.trace { "Final cookies\n$finalCookies" }
            return originalRequest
                .newBuilder()
                .header("Cookie", finalCookies)
                .header("User-Agent", flareSolverResponse.solution.userAgent)
                .build()
        } else {
            logger.debug { "Cloudflare challenge failed to resolve" }
            throw CloudflareBypassException()
        }
    }

    private class CloudflareBypassException : Exception()
}
