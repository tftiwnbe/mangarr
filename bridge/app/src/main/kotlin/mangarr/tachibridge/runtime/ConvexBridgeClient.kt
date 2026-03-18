package mangarr.tachibridge.runtime

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

private val JSON_MEDIA_TYPE = "application/json".toMediaType()

@Serializable
data class LeaseCommand(
    val id: String,
    val commandType: String,
    val payload: JsonElement,
    val requestedByUserId: String? = null,
    val attemptCount: Double,
    val maxAttempts: Double,
)

@Serializable
data class OkResponse(
    val ok: Boolean,
)

@Serializable
data class FailResponse(
    val ok: Boolean,
    val retried: Boolean,
)

@Serializable
data class UpsertRepositoryResponse(
    val updated: Boolean,
    val created: Boolean,
)

@Serializable
data class ImportLibraryResponse(
    val created: Boolean,
    val titleId: String,
)

@Serializable
data class HeartbeatResponse(
    val bridgeStateId: String,
    val created: Boolean,
)

data class ConvexBridgeClientConfig(
    val baseUrl: String,
    val authTokenProvider: () -> String,
)

class ConvexBridgeClient(
    private val config: ConvexBridgeClientConfig,
    private val httpClient: OkHttpClient = OkHttpClient(),
    private val json: Json = Json { ignoreUnknownKeys = true },
) {
    fun reportHeartbeat(args: JsonObject): HeartbeatResponse =
        mutation("bridge:reportHeartbeat", args)

    fun leaseCommands(args: JsonObject): List<LeaseCommand> =
        mutation("commands:lease", args)

    fun markCommandRunning(args: JsonObject): OkResponse =
        mutation("commands:markRunning", args)

    fun renewCommandLease(args: JsonObject): OkResponse =
        mutation("commands:renewLease", args)

    fun completeCommand(args: JsonObject): OkResponse =
        mutation("commands:complete", args)

    fun failCommand(args: JsonObject): FailResponse =
        mutation("commands:fail", args)

    fun updateCommandProgress(args: JsonObject): OkResponse =
        mutation("commands:updateProgress", args)

    fun setExtensionRepository(args: JsonObject): UpsertRepositoryResponse =
        mutation("extensions:setRepository", args)

    fun upsertInstalledExtension(args: JsonObject): OkResponse =
        mutation("extensions:upsertInstalled", args)

    fun setInstalledExtensionSourceEnabled(args: JsonObject): OkResponse =
        mutation("extensions:setSourceEnabled", args)

    fun removeInstalledExtension(args: JsonObject): OkResponse =
        mutation("extensions:removeInstalled", args)

    fun importLibraryTitle(args: JsonObject): ImportLibraryResponse =
        mutation("library:importForUser", args)

    fun upsertLibraryChapters(args: JsonObject): OkResponse =
        mutation("library:upsertChaptersForTitle", args)

    fun setLibraryTitleLocalCover(args: JsonObject): OkResponse =
        mutation("library:setLocalCoverPath", args)

    fun setLibraryChapterDownloadState(args: JsonObject): OkResponse =
        mutation("library:setChapterDownloadState", args)

    private inline fun <reified T> mutation(path: String, args: JsonObject): T =
        call("/api/mutation", path, args)

    private inline fun <reified T> call(endpoint: String, path: String, args: JsonObject): T {
        val requestBody =
            buildJsonObject {
                put("path", path)
                put("format", "convex_encoded_json")
                put(
                    "args",
                    buildJsonArray {
                        add(args)
                    },
                )
            }

        val request =
            Request
                .Builder()
                .url("${config.baseUrl.removeSuffix("/")}$endpoint")
                .header("Content-Type", "application/json")
                .header("Convex-Client", "tachibridge-http")
                .header("Authorization", "Bearer ${config.authTokenProvider()}")
                .post(json.encodeToString(JsonObject.serializer(), requestBody).toRequestBody(JSON_MEDIA_TYPE))
                .build()

        httpClient.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw IllegalStateException("Convex request failed (${response.code}): $raw")
            }

            val payload = json.parseToJsonElement(raw).jsonObject
            when (payload["status"]?.jsonPrimitive?.contentOrNull) {
                "success" -> {
                    val value = payload["value"] ?: JsonPrimitive("")
                    return json.decodeFromJsonElement(value)
                }
                "error" -> {
                    val message = payload["errorMessage"]?.jsonPrimitive?.contentOrNull ?: "Unknown Convex error"
                    throw IllegalStateException(message)
                }
                else -> throw IllegalStateException("Unexpected Convex response: $raw")
            }
        }
    }

    fun payload(baseArgs: JsonObject = buildJsonObject { }): JsonObject = baseArgs
}
