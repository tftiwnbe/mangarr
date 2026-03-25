package eu.kanade.tachiyomi.network

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.okio.decodeFromBufferedSource
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import rx.Observable
import rx.Producer
import rx.Subscription
import java.io.IOException
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import kotlin.concurrent.atomics.AtomicBoolean
import kotlin.concurrent.atomics.ExperimentalAtomicApi
import kotlin.coroutines.resumeWithException

val jsonMime = "application/json; charset=utf-8".toMediaType()

@OptIn(ExperimentalAtomicApi::class)
fun Call.asObservable(): Observable<Response> {
    return Observable.unsafeCreate { subscriber ->
        // Since Call is a one-shot type, clone it for each new subscriber.
        val call = clone()

        // Wrap the call in a helper which handles both unsubscription and backpressure.
        val requestArbiter =
            object : Producer, Subscription {
                val boolean = AtomicBoolean(false)

                override fun request(n: Long) {
                    if (n == 0L || !boolean.compareAndSet(expectedValue = false, newValue = true)) return

                    try {
                        val response = call.execute()
                        if (!subscriber.isUnsubscribed) {
                            subscriber.onNext(response)
                            subscriber.onCompleted()
                        }
                    } catch (e: Exception) {
                        if (!subscriber.isUnsubscribed) {
                            subscriber.onError(e)
                        }
                    }
                }

                override fun unsubscribe() {
                    call.cancel()
                }

                override fun isUnsubscribed(): Boolean = call.isCanceled()
            }

        subscriber.add(requestArbiter)
        subscriber.setProducer(requestArbiter)
    }
}

fun Call.asObservableSuccess(): Observable<Response> =
    asObservable().doOnNext { response ->
        if (!response.isSuccessful) {
            val retryAfterSeconds = retryAfterSeconds(response)
            response.close()
            throw HttpException(response.code, retryAfterSeconds)
        }
    }

// Based on https://github.com/gildor/kotlin-coroutines-okhttp
@OptIn(ExperimentalCoroutinesApi::class)
private suspend fun Call.await(callStack: Array<StackTraceElement>): Response {
    return suspendCancellableCoroutine { continuation ->
        val callback =
            object : Callback {
                override fun onResponse(
                    call: Call,
                    response: Response,
                ) {
                    continuation.resume(response) {
                        response.body!!.close()
                    }
                }

                override fun onFailure(
                    call: Call,
                    e: IOException,
                ) {
                    // Don't bother with resuming the continuation if it is already cancelled.
                    if (continuation.isCancelled) return
                    val exception = IOException(e.message, e).apply { stackTrace = callStack }
                    continuation.resumeWithException(exception)
                }
            }

        enqueue(callback)

        continuation.invokeOnCancellation {
            try {
                cancel()
            } catch (ex: Throwable) {
                // Ignore cancel exception
            }
        }
    }
}

suspend fun Call.await(): Response {
    val callStack = Exception().stackTrace.run { copyOfRange(1, size) }
    return await(callStack)
}

/**
 * @since extensions-lib 1.5
 */
suspend fun Call.awaitSuccess(): Response {
    val callStack = Exception().stackTrace.run { copyOfRange(1, size) }
    val response = await(callStack)
    if (!response.isSuccessful) {
        val retryAfterSeconds = retryAfterSeconds(response)
        response.close()
        throw HttpException(response.code, retryAfterSeconds).apply { stackTrace = callStack }
    }
    return response
}

private fun retryAfterSeconds(response: Response): Long? {
    val headerValue = response.header("Retry-After")?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    headerValue.toLongOrNull()?.let { return it.coerceAtLeast(0) }

    val retryAt =
        runCatching { ZonedDateTime.parse(headerValue, DateTimeFormatter.RFC_1123_DATE_TIME) }
            .getOrNull()
            ?: return null
    val seconds = ChronoUnit.SECONDS.between(ZonedDateTime.now(retryAt.zone), retryAt)
    return seconds.coerceAtLeast(0)
}

fun OkHttpClient.newCachelessCallWithProgress(
    request: Request,
    listener: ProgressListener,
): Call {
    val progressClient =
        newBuilder()
            .cache(null)
            .addNetworkInterceptor { chain ->
                val originalResponse = chain.proceed(chain.request())
                originalResponse
                    .newBuilder()
                    .body(originalResponse.body?.let { ProgressResponseBody(it, listener) })
                    .build()
            }.build()

    return progressClient.newCall(request)
}

@kotlinx.serialization.ExperimentalSerializationApi
context(_: Json)
inline fun <reified T> Response.parseAs(): T = decodeFromJsonResponse(serializer(), this)

@kotlinx.serialization.ExperimentalSerializationApi
context(_: Json)
fun <T> decodeFromJsonResponse(
    deserializer: DeserializationStrategy<T>,
    response: Response,
): T =
    response.body!!.source().use {
        Json.decodeFromBufferedSource(deserializer, it)
    }

/**
 * Exception that handles HTTP codes considered not successful by OkHttp.
 * Use it to have a standardized error message in the app across the extensions.
 *
 * @since extensions-lib 1.5
 * @param code [Int] the HTTP status code
 */
class HttpException(
    val code: Int,
    val retryAfterSeconds: Long? = null,
) : IllegalStateException("HTTP error $code")
