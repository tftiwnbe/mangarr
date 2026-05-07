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
import kotlin.math.min
import kotlin.random.Random

private val JSON_MEDIA_TYPE = "application/json".toMediaType()
private const val CONVEX_OCC_MAX_ATTEMPTS = 4
private const val CONVEX_OCC_BASE_BACKOFF_MS = 150L

@Serializable
data class LeaseCommand(
    val id: String,
    val commandType: String,
    val payload: JsonElement,
    val requestedByUserId: String? = null,
    val leaseToken: String,
    val attemptCount: Double,
    val maxAttempts: Double,
)

@Serializable
data class OkResponse(
    val ok: Boolean,
    val stale: Boolean = false,
)

@Serializable
data class FailResponse(
    val ok: Boolean,
    val retried: Boolean = false,
    val stale: Boolean = false,
)

@Serializable
data class RecoverExpiredLeasesResponse(
    val recoveredCommands: Double,
    val deadLetteredCommands: Double,
)

@Serializable
data class LeaseBatchRequestStat(
    val lane: String,
    val requestedSlots: Double,
    val candidateCount: Double,
    val leasedCount: Double,
)

@Serializable
data class CommandQueueLaneStat(
    val lane: String,
    val readyCount: Double,
    val oldestReadyAgeMs: Double,
)

@Serializable
data class CommandQueueSnapshotResponse(
    val lanes: List<CommandQueueLaneStat>,
)

@Serializable
data class LeaseBatchResponse(
    val leasedCommands: List<LeaseCommand>,
    val requestStats: List<LeaseBatchRequestStat>,
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

@Serializable
data class RecoverDownloadsResponse(
    val recoveredTasks: Double,
    val requeuedTasks: Double,
    val failedTasks: Double,
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
        mutation("runtime_commands:lease", args)

    fun leaseCommandsBatch(args: JsonObject): LeaseBatchResponse =
        mutation("runtime_commands:leaseBatch", args)

    fun commandQueueSnapshot(args: JsonObject): CommandQueueSnapshotResponse =
        query("runtime_commands:queueSnapshot", args)

    fun recoverExpiredLeases(args: JsonObject): RecoverExpiredLeasesResponse =
        mutation("runtime_commands:recoverExpiredLeases", args)

    fun renewCommandLease(args: JsonObject): OkResponse =
        mutation("runtime_commands:renewLease", args)

    fun completeCommand(args: JsonObject): OkResponse =
        mutation("runtime_commands:complete", args)

    fun failCommand(args: JsonObject): FailResponse =
        mutation("runtime_commands:fail", args)

    fun updateCommandProgress(args: JsonObject): OkResponse =
        mutation("runtime_commands:updateProgress", args)

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

    fun upsertLibraryTitleMetadata(args: JsonObject): OkResponse =
        mutation("library:upsertTitleMetadataFromBridge", args)

    fun refreshLibraryTitleStats(args: JsonObject): OkResponse =
        mutation("library:refreshTitleStatsFromBridge", args)

    fun ingestDiscoveryFeedPage(args: JsonObject): OkResponse =
        mutation("discovery:ingestFeedPageFromBridge", args)

    fun upsertDiscoveryTitleMetadata(args: JsonObject): OkResponse =
        mutation("discovery:upsertTitleMetadataFromBridge", args)

    fun recordDiscoveryCrawlFailure(args: JsonObject): OkResponse =
        mutation("discovery:recordCrawlFailureFromBridge", args)

    fun recordDiscoveryTitleHydrationFailure(args: JsonObject): OkResponse =
        mutation("discovery:recordTitleHydrationFailureFromBridge", args)

    fun setLibraryChapterDownloadState(args: JsonObject): OkResponse =
        mutation("library:setChapterDownloadState", args)

    fun recoverActiveDownloads(args: JsonObject): RecoverDownloadsResponse =
        mutation("library:recoverActiveDownloads", args)

    private inline fun <reified T> mutation(path: String, args: JsonObject): T =
        call("/api/mutation", path, args)

    private inline fun <reified T> query(path: String, args: JsonObject): T =
        call("/api/query", path, args)

    private inline fun <reified T> call(endpoint: String, path: String, args: JsonObject): T {
        val startedAt = System.currentTimeMillis()
        var attempt = 0
        while (true) {
            try {
                val value = callOnce<T>(endpoint, path, args)
                BridgeMetrics.recordConvexCall(
                    endpoint = endpoint,
                    path = path,
                    outcome = if (attempt == 0) "success" else "success_after_retry",
                    durationMs = System.currentTimeMillis() - startedAt,
                )
                return value
            } catch (error: IllegalStateException) {
                attempt += 1
                if (!isRetryableConvexOcc(error.message) || attempt >= CONVEX_OCC_MAX_ATTEMPTS) {
                    BridgeMetrics.recordConvexCall(
                        endpoint = endpoint,
                        path = path,
                        outcome = "error",
                        durationMs = System.currentTimeMillis() - startedAt,
                    )
                    throw error
                }
                BridgeMetrics.recordConvexRetry(endpoint = endpoint, path = path)
                Thread.sleep(convexOccBackoffMs(attempt))
            }
        }
    }

    private inline fun <reified T> callOnce(endpoint: String, path: String, args: JsonObject): T {
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

private fun isRetryableConvexOcc(message: String?): Boolean =
    message?.contains("Documents read from or written to", ignoreCase = true) == true &&
        message.contains("changed while this mutation was being run", ignoreCase = true)

private fun convexOccBackoffMs(attempt: Int): Long {
    val exponential = CONVEX_OCC_BASE_BACKOFF_MS * (1L shl (attempt - 1).coerceAtLeast(0))
    val jitter = Random.nextLong(0L, 75L)
    return min(exponential + jitter, 1_250L)
}
