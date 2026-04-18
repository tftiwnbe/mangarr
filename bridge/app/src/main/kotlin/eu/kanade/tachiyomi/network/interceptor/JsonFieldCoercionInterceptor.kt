package eu.kanade.tachiyomi.network.interceptor

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Interceptor
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

class JsonFieldCoercionInterceptor(
    private val json: Json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        explicitNulls = false
    },
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val response = chain.proceed(chain.request())
        val body = response.body ?: return response
        val mediaType = body.contentType()
        val isJsonLike =
            mediaType?.subtype?.contains("json", ignoreCase = true) == true ||
                mediaType?.subtype?.contains("javascript", ignoreCase = true) == true
        if (!isJsonLike) {
            return response
        }

        val raw = body.string()
        if (!raw.contains("\"summary\"")) {
            return response.newBuilder().body(raw.toResponseBody(mediaType)).build()
        }

        val normalized =
            runCatching {
                val element = json.parseToJsonElement(raw)
                val coerced = coerceSummaryFields(element)
                json.encodeToString(JsonElement.serializer(), coerced)
            }.getOrElse {
                raw
            }

        return response
            .newBuilder()
            .body(normalized.toResponseBody(mediaType))
            .build()
    }

    private fun coerceSummaryFields(element: JsonElement): JsonElement =
        when (element) {
            is JsonObject ->
                JsonObject(
                    element.mapValues { (key, value) ->
                        if (key == "summary") {
                            JsonPrimitive(value.coercedSummaryText())
                        } else {
                            coerceSummaryFields(value)
                        }
                    },
                )

            is JsonArray -> JsonArray(element.map(::coerceSummaryFields))
            else -> element
        }

    private fun JsonElement.coercedSummaryText(): String =
        when (this) {
            JsonNull -> ""
            is JsonPrimitive -> contentOrNull.orEmpty()
            is JsonArray -> this.mapNotNull { it.flattenTextOrNull() }.joinToString("\n").trim()
            is JsonObject -> flattenTextOrNull().orEmpty()
        }

    private fun JsonElement.flattenTextOrNull(): String? {
        return when (this) {
            JsonNull -> null
            is JsonPrimitive -> contentOrNull?.trim()?.takeIf { it.isNotEmpty() }
            is JsonArray ->
                this.mapNotNull { it.flattenTextOrNull() }
                    .joinToString("\n")
                    .trim()
                    .ifEmpty { null }

            is JsonObject -> {
                val directText = this["text"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                if (directText.isNotEmpty()) {
                    directText
                } else {
                    val contentText =
                        this["content"]?.let { content ->
                            when (content) {
                                is JsonArray -> content.mapNotNull { it.flattenTextOrNull() }.joinToString("\n")
                                else -> content.flattenTextOrNull().orEmpty()
                            }
                        }.orEmpty()

                    if (contentText.isNotBlank()) {
                        contentText.trim()
                    } else {
                        this.values
                            .mapNotNull { it.flattenTextOrNull() }
                            .joinToString("\n")
                            .trim()
                            .ifEmpty { null }
                    }
                }
            }
        }
    }
}
