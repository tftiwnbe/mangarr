package eu.kanade.tachiyomi.network.interceptor

import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.network.POST
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
import mangarr.tachibridge.config.FlareSolverrConfigProvider
import okhttp3.Cookie
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import uy.kohesive.injekt.injectLazy
import java.io.IOException
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

        val originalResponse = chain.proceed(originalRequest)

        // Check if Cloudflare anti-bot is on
        if (!(originalResponse.code in ERROR_CODES && originalResponse.header("Server") in SERVER_CHECK)) {
            return originalResponse
        }

        val flareConfig = configProvider.config.value

        if (!flareConfig.enabled) {
            throw IOException("Cloudflare bypass currently disabled")
        }

        logger.debug { "Cloudflare anti-bot is on, CloudflareInterceptor is kicking in..." }

        return try {
            originalResponse.close()

            val flareResponseFallback = flareConfig.responseFallback
            val flareResponse =
                runBlocking {
                    CFClearance.resolveWithFlareSolver(originalRequest, !flareResponseFallback)
                }

            if (flareResponse.message.contains("not detected", ignoreCase = true)) {
                logger.debug { "FlareSolverr failed to detect Cloudflare challenge" }

                if (flareResponseFallback &&
                    flareResponse.solution.status in 200..299 &&
                    flareResponse.solution.response != null
                ) {
                    val isImage = CHROME_IMAGE_TEMPLATE_REGEX in flareResponse.solution.response
                    if (!isImage) {
                        logger.debug { "Falling back to FlareSolverr response" }

                        setUserAgent(flareResponse.solution.userAgent)

                        return originalResponse
                            .newBuilder()
                            .code(flareResponse.solution.status)
                            .body(flareResponse.solution.response.toResponseBody())
                            .build()
                    } else {
                        logger.debug { "FlareSolverr response is an image html template, not falling back" }
                    }
                }
            }

            val request = CFClearance.requestWithFlareSolverr(flareResponse, setUserAgent, originalRequest)

            chain.proceed(request)
        } catch (e: Exception) {
            throw IOException(e)
        }
    }

    companion object {
        private val ERROR_CODES = listOf(403, 503)
        private val SERVER_CHECK = arrayOf("cloudflare-nginx", "cloudflare")
        private val CHROME_IMAGE_TEMPLATE_REGEX = Regex("""<title>(.*?) \(\d+×\d+\)</title>""")
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
            val response =
                getClient()
                    .newCall(
                        POST(
                            url = flareConfig.url.removeSuffix("/") + "/v1",
                            body =
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
                                            returnOnlyCookies = onlyCookies,
                                            maxTimeout = timeout.inWholeMilliseconds.toInt(),
                                        ),
                                    ).toRequestBody(jsonMediaType),
                        ),
                    ).awaitSuccess()

            // Parse response manually with our json instance
            val responseBody =
                response.body?.string()
                    ?: throw IOException("Empty FlareSolverr response")

            json.decodeFromString<FlareSolverResponse>(responseBody)
        }
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
