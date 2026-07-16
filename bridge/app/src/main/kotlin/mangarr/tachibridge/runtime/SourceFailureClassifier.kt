package mangarr.tachibridge.runtime

import eu.kanade.tachiyomi.network.HttpException
import kotlinx.serialization.SerializationException

data class SourceFailureClassification(
    val retryable: Boolean,
    val expected: Boolean,
    val message: String,
    val httpCode: Int? = null,
    val code: String? = null,
)

fun classifySourceFailure(
    commandType: String,
    error: Throwable,
): SourceFailureClassification {
    val httpError = error.findHttpException()
    val normalizedMessage = normalizeSourceFailureMessage(error)
    if (isWebViewAuthenticationRequired(error)) {
        return SourceFailureClassification(
            retryable = false,
            expected = true,
            message = normalizedMessage,
            httpCode = httpError?.code,
            code = "source_auth_required",
        )
    }
    if (isExtensionRuntimeAbiMismatch(error)) {
        return SourceFailureClassification(
            retryable = false,
            expected = true,
            message = "Extension runtime ABI mismatch: $normalizedMessage",
            httpCode = httpError?.code,
        )
    }
    if (isPermanentSourceRequestFailure(error)) {
        return SourceFailureClassification(
            retryable = false,
            expected = true,
            message = normalizedMessage,
            httpCode = httpError?.code,
        )
    }
    val permanentChapterFailure =
        commandType == "downloads.chapter" && isPermanentChapterAccessFailure(normalizedMessage)

    if (permanentChapterFailure) {
        return SourceFailureClassification(
            retryable = false,
            expected = true,
            message = normalizedMessage,
            httpCode = httpError?.code,
        )
    }

    if (httpError != null) {
        val retryable =
            if (commandType == "downloads.chapter") {
                httpError.code == 429 || httpError.code in 500..599
            } else {
                !isPermanentHttpFailure(httpError.code)
            }
        return SourceFailureClassification(
            retryable = retryable,
            expected = true,
            message = normalizedMessage,
            httpCode = httpError.code,
        )
    }

    if (error is SerializationException || error.causedBy<SerializationException>()) {
        return SourceFailureClassification(
            retryable = true,
            expected = true,
            message = normalizedMessage,
        )
    }

    return SourceFailureClassification(
        retryable = true,
        expected = false,
        message = normalizedMessage,
    )
}

fun Throwable.findHttpException(): HttpException? {
    var current: Throwable? = this
    while (current != null) {
        if (current is HttpException) {
            return current
        }
        parseHttpStatusCode(current.message)?.let { return HttpException(it) }
        current = current.cause
    }
    return null
}

fun isPermanentHttpFailure(code: Int): Boolean =
    code in 400..499 && code != 408 && code != 409 && code != 425 && code != 429

internal fun isPermanentSourceRequestFailure(error: Throwable): Boolean {
    var current: Throwable? = error
    while (current != null) {
        val message = current.message?.trim()
        if (!message.isNullOrBlank()) {
            if (TOO_MANY_FOLLOW_UP_REQUESTS_PATTERN.containsMatchIn(message) ||
                MISSING_SOURCE_PATTERN.containsMatchIn(message)
            ) {
                return true
            }
        }
        current = current.cause
    }
    return false
}

internal fun isExtensionRuntimeAbiMismatch(error: Throwable): Boolean {
    var current: Throwable? = error
    while (current != null) {
        if (current is NoSuchMethodError || current is NoClassDefFoundError) {
            val message = current.message?.trim().orEmpty()
            if (
                message.contains("okhttp3.OkHttpClient\$Builder") ||
                message.contains("okhttp3.") ||
                message.contains("okio.")
            ) {
                return true
            }
        }
        current = current.cause
    }
    return false
}

internal fun isWebViewAuthenticationRequired(error: Throwable): Boolean {
    var current: Throwable? = error
    while (current != null) {
        val message = current.message?.lowercase().orEmpty()
        if (message.contains("webview") &&
            WEBVIEW_ACTION_TERMS.any(message::contains)
        ) {
            return true
        }
        current = current.cause
    }
    return false
}

private val WEBVIEW_ACTION_TERMS =
    listOf(
        "authoriz",
        "authenticat",
        "login",
        "log in",
        "sign in",
        "challenge",
        "captcha",
        "авторизац",
        "войд",
        "капч",
    )

private fun isPermanentChapterAccessFailure(message: String): Boolean {
    val normalized = message.lowercase()
    return normalized.contains("глава не куплена") ||
        normalized.contains("chapter not purchased") ||
        normalized.contains("chapter is not purchased") ||
        normalized.contains("not purchased")
}

private fun normalizeSourceFailureMessage(error: Throwable): String {
    val message = error.message?.trim()
    if (!message.isNullOrBlank()) {
        return message
    }
    return error::class.simpleName ?: "Source request failed"
}

private inline fun <reified T : Throwable> Throwable.causedBy(): Boolean {
    var current: Throwable? = this.cause
    while (current != null) {
        if (current is T) return true
        current = current.cause
    }
    return false
}

private val HTTP_ERROR_PATTERN = Regex("HTTP error\\s+(\\d{3})")
private val TOO_MANY_FOLLOW_UP_REQUESTS_PATTERN = Regex("too many follow-up requests", RegexOption.IGNORE_CASE)
private val MISSING_SOURCE_PATTERN =
    Regex("^Source(?: \\d+)? not found(?::.*| or wrong type)?$", RegexOption.IGNORE_CASE)

private fun parseHttpStatusCode(message: String?): Int? {
    if (message.isNullOrBlank()) {
        return null
    }
    return HTTP_ERROR_PATTERN.find(message)?.groupValues?.getOrNull(1)?.toIntOrNull()
}
