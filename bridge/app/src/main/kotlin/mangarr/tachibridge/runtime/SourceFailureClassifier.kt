package mangarr.tachibridge.runtime

import eu.kanade.tachiyomi.network.HttpException
import kotlinx.serialization.SerializationException

data class SourceFailureClassification(
    val retryable: Boolean,
    val expected: Boolean,
    val message: String,
    val httpCode: Int? = null,
)

fun classifySourceFailure(
    commandType: String,
    error: Throwable,
): SourceFailureClassification {
    val httpError = error.findHttpException()
    val normalizedMessage = normalizeSourceFailureMessage(error)
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

private fun parseHttpStatusCode(message: String?): Int? {
    if (message.isNullOrBlank()) {
        return null
    }
    return HTTP_ERROR_PATTERN.find(message)?.groupValues?.getOrNull(1)?.toIntOrNull()
}
