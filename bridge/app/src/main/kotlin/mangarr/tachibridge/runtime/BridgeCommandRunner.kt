package mangarr.tachibridge.runtime

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import mangarr.tachibridge.config.ConfigManager
import mangarr.tachibridge.logging.EventLogger
import mangarr.tachibridge.logging.LogContext

private val events = EventLogger.named(
    "mangarr.tachibridge.runtime.BridgeCommandRunner",
    "component" to "bridge_command_runner",
)

private const val DOWNLOAD_PROGRESS_UPDATE_INTERVAL_MS = 5_000L
private const val DOWNLOAD_LEASE_RENEW_INTERVAL_MS = 5_000L
private const val DISCOVERY_RETRY_DELAY_MS = 15 * 60 * 1000L
private const val MAX_LEASE_RECOVERY_INTERVAL_MS = 15_000L
private const val MAX_COMMAND_LEASE_RENEW_INTERVAL_MS = 10_000L
private const val IDLE_POLL_BACKOFF_STEP_POLLS = 3
private const val MAX_IDLE_POLL_INTERVAL_MS = 15_000L

@Serializable
data class CommandRunnerSnapshot(
    val configured: Boolean,
    val running: Boolean,
    val lastPollAt: Long? = null,
    val lastSuccessAt: Long? = null,
    val lastError: String? = null,
)

private class StaleCommandLeaseException(
    commandId: String,
    action: String,
) : IllegalStateException("Command $commandId lost its lease before $action")

private data class CommandPollResult(
    val success: Boolean,
    val leasedCount: Int,
)

internal fun idlePollDelayMs(
    baseIntervalMs: Long,
    consecutiveIdlePolls: Int,
): Long {
    if (consecutiveIdlePolls <= 0) {
        return baseIntervalMs
    }
    val step = (consecutiveIdlePolls / IDLE_POLL_BACKOFF_STEP_POLLS).coerceAtMost(3)
    return (baseIntervalMs * (1L shl step)).coerceAtMost(MAX_IDLE_POLL_INTERVAL_MS)
}

class BridgeCommandRunner(
    private val bridgeClient: ConvexBridgeClient?,
    private val service: BridgeService,
    private val bridgeId: String,
    private val pollIntervalMs: Long,
    private val leaseDurationMs: Long,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val commandLaneTracker = BridgeCommandLaneTracker()
    private val leaseRecoveryIntervalMs =
        (leaseDurationMs / 2).coerceAtLeast(pollIntervalMs).coerceAtMost(MAX_LEASE_RECOVERY_INTERVAL_MS)
    private val commandLeaseRenewIntervalMs =
        (leaseDurationMs / 3).coerceAtLeast(5_000L).coerceAtMost(MAX_COMMAND_LEASE_RENEW_INTERVAL_MS)
    private var job: Job? = null
    private var lastLeaseRecoveryAt = 0L
    private var consecutiveIdlePolls = 0
    @Volatile
    private var snapshot =
        CommandRunnerSnapshot(
            configured = bridgeClient != null,
            running = false,
            lastError = if (bridgeClient == null) "Convex URL is not configured" else null,
        )

    fun snapshot(): CommandRunnerSnapshot = snapshot

    fun executeWorkpoolCommand(
        commandType: String,
        payload: JsonObject,
        requestedByUserId: String? = null,
    ): JsonObject {
        val client = bridgeClient ?: error("Convex URL is not configured")
        val syntheticCommand =
            LeaseCommand(
                id = "workpool-${System.currentTimeMillis()}",
                commandType = commandType,
                payload = payload,
                requestedByUserId = requestedByUserId ?: payload.optionalString("requestedByUserId"),
                leaseToken = "workpool",
                attemptCount = 0.0,
                maxAttempts = 1.0,
            )
        return executeCommand(client, syntheticCommand)
    }

    fun start() {
        if (job != null) {
            return
        }
        snapshot = snapshot.copy(running = true)
        job =
            scope.launch {
                recoverDownloadStateOnStartup()
                while (isActive) {
                    val result = poll()
                    consecutiveIdlePolls =
                        if (!result.success || result.leasedCount > 0) {
                            0
                        } else {
                            consecutiveIdlePolls + 1
                        }
                    val nextDelayMs = idlePollDelayMs(pollIntervalMs, consecutiveIdlePolls)
                    delay(nextDelayMs)
                }
            }
    }

    suspend fun stop() {
        job?.cancel()
        job = null
        snapshot = snapshot.copy(running = false)
    }

    private suspend fun poll(): CommandPollResult {
        val client =
            bridgeClient
                ?: return CommandPollResult(success = false, leasedCount = 0)
        val now = System.currentTimeMillis()
        snapshot = snapshot.copy(lastPollAt = now)

        try {
            maybeRecoverExpiredCommandLeases(client, now)
            val requests =
                commandLaneTracker.lanes()
                    .mapNotNull { lane ->
                        val slots = commandLaneTracker.availableSlots(lane)
                        if (slots > 0) {
                            lane to slots
                        } else {
                            null
                        }
                    }
            if (requests.isEmpty()) {
                snapshot = snapshot.copy(lastSuccessAt = now, lastError = null)
                return CommandPollResult(success = true, leasedCount = 0)
            }
            val leaseStartedAt = System.currentTimeMillis()
            val leaseResponse = leaseCommandsBatch(client, now, requests)
            val leased = leaseResponse.leasedCommands
            val leaseDurationMs = System.currentTimeMillis() - leaseStartedAt

            if (leased.isNotEmpty()) {
                events.debug(
                    "bridge.commands.leased",
                    "Leased bridge commands",
                    "bridgeId" to bridgeId,
                    "count" to leased.size,
                    "durationMs" to leaseDurationMs,
                )
            }

            dispatchLeasedCommands(client, leased)

            snapshot = snapshot.copy(lastSuccessAt = now, lastError = null)
            return CommandPollResult(success = true, leasedCount = leased.size)
        } catch (error: Exception) {
            events.error(
                "bridge.commands.poll_failed",
                "Bridge command poll failed",
                error,
                "bridgeId" to bridgeId,
            )
            snapshot = snapshot.copy(lastError = error.message ?: "Unknown command error")
            return CommandPollResult(success = false, leasedCount = 0)
        }
    }

    private fun maybeRecoverExpiredCommandLeases(
        client: ConvexBridgeClient,
        now: Long,
    ) {
        if (lastLeaseRecoveryAt != 0L && now - lastLeaseRecoveryAt < leaseRecoveryIntervalMs) {
            return
        }
        val recovered =
            client.recoverExpiredLeases(
                client.payload(
                    buildJsonObject {
                        put("now", now)
                    },
                ),
            )
        lastLeaseRecoveryAt = now
        if (recovered.recoveredCommands > 0) {
            events.warn(
                "bridge.commands.recovered_expired_leases",
                "Recovered expired command leases before polling for new work",
                "bridgeId" to bridgeId,
                "recoveredCommands" to recovered.recoveredCommands.toInt(),
                "deadLetteredCommands" to recovered.deadLetteredCommands.toInt(),
            )
        }
    }

    private fun leaseCommandsBatch(
        client: ConvexBridgeClient,
        now: Long,
        requests: List<Pair<BridgeCommandLane, Int>>,
    ): LeaseBatchResponse {
        if (requests.isEmpty()) {
            return LeaseBatchResponse(leasedCommands = emptyList(), requestStats = emptyList())
        }
        return client
            .leaseCommandsBatch(
                client.payload(
                    buildJsonObject {
                        put("bridgeId", bridgeId)
                        put("now", now)
                        put("leaseDurationMs", leaseDurationMs)
                        put(
                            "requests",
                            kotlinx.serialization.json.buildJsonArray {
                                requests.forEach { (lane, limit) ->
                                    add(
                                        buildJsonObject {
                                            put("lane", lane.name.lowercase())
                                            put(
                                                "capabilities",
                                                kotlinx.serialization.json.buildJsonArray {
                                                    lane.capabilities.forEach { capability -> add(JsonPrimitive(capability)) }
                                                },
                                            )
                                            put("limit", limit)
                                        },
                                    )
                                }
                            },
                        )
                    },
                ),
            )
    }

    private suspend fun recoverDownloadStateOnStartup() {
        val client = bridgeClient ?: return
        runCatching {
            val recovered =
                client.recoverActiveDownloads(
                    client.payload(
                        buildJsonObject {
                            put("now", System.currentTimeMillis())
                            put("forceRunningCommands", true)
                        },
                    ),
                )
            if (recovered.recoveredTasks > 0) {
                events.info(
                    "bridge.downloads.recovered",
                    "Recovered active download state after bridge startup",
                    "recoveredTasks" to recovered.recoveredTasks.toInt(),
                    "requeuedTasks" to recovered.requeuedTasks.toInt(),
                    "failedTasks" to recovered.failedTasks.toInt(),
                )
            }
        }.onFailure { error ->
            events.error(
                "bridge.downloads.recovery_failed",
                "Failed to recover active download state on startup",
                error,
                "bridgeId" to bridgeId,
            )
        }
    }

    private fun dispatchLeasedCommands(
        client: ConvexBridgeClient,
        leased: List<LeaseCommand>,
    ) {
        if (leased.isEmpty()) {
            return
        }
        for (command in leased) {
            val lane = BridgeCommandLane.fromCommandType(command.commandType)
            val counter = commandLaneTracker.increment(command.commandType)
            counter.incrementAndGet()
            scope.launch {
                try {
                    handleCommand(client, command)
                } finally {
                    counter.decrementAndGet()
                }
            }
        }
    }

    private fun requireLeaseOwnership(
        command: LeaseCommand,
        action: String,
        response: OkResponse,
    ) {
        if (response.stale) {
            throw StaleCommandLeaseException(command.id, action)
        }
        check(response.ok) { "Bridge command ${command.id} failed during $action" }
    }

    private fun renewLeaseOrThrowStale(
        client: ConvexBridgeClient,
        command: LeaseCommand,
        now: Long = System.currentTimeMillis(),
    ) {
        requireLeaseOwnership(
            command = command,
            action = "lease renewal",
            response =
                client.renewCommandLease(
                    client.payload(
                        buildJsonObject {
                            put("commandId", command.id)
                            put("bridgeId", bridgeId)
                            put("leaseToken", command.leaseToken)
                            put("now", now)
                            put("leaseDurationMs", leaseDurationMs)
                        },
                    ),
                ),
        )
    }

    private fun startLeaseKeepalive(client: ConvexBridgeClient, command: LeaseCommand): Job =
        scope.launch {
            while (isActive) {
                delay(commandLeaseRenewIntervalMs)
                try {
                    renewLeaseOrThrowStale(client, command)
                } catch (_: StaleCommandLeaseException) {
                    return@launch
                } catch (_: Exception) {
                    return@launch
                }
            }
        }

    private fun handleCommand(client: ConvexBridgeClient, command: LeaseCommand) {
        val startedAt = System.currentTimeMillis()
        commandContext(command).use {
            events.debug(
                "bridge.command.started",
                "Starting bridge command",
                "attempt" to command.attemptCount.toInt() + 1,
                "maxAttempts" to command.maxAttempts.toInt(),
            )
            val renewJob = startLeaseKeepalive(client, command)

            try {
                val result = executeCommand(client, command)
                val completion =
                    client.completeCommand(
                        client.payload(
                            buildJsonObject {
                                put("commandId", command.id)
                                put("bridgeId", bridgeId)
                                put("leaseToken", command.leaseToken)
                                put("now", System.currentTimeMillis())
                                put("result", result)
                            },
                        ),
                    )
                if (completion.stale) {
                    throw StaleCommandLeaseException(command.id, "completion")
                }
                check(completion.ok) { "Bridge command ${command.id} could not be completed" }
                val durationMs = System.currentTimeMillis() - startedAt
                events.debug(
                    "bridge.command.completed",
                    "Completed bridge command",
                    "durationMs" to durationMs,
                )
            } catch (error: Exception) {
                val durationMs = System.currentTimeMillis() - startedAt
                if (error is StaleCommandLeaseException) {
                    events.warn(
                        "bridge.command.stale_lease",
                        "Bridge command lost lease ownership; abandoning stale worker",
                        "commandId" to command.id,
                        "bridgeId" to bridgeId,
                        "durationMs" to durationMs,
                        "message" to (error.message ?: "stale lease"),
                    )
                } else {
                    val failure = classifySourceFailure(command.commandType, error)
                    val retryable = failure.retryable
                    val httpError = error.findHttpException()
                    val retryDelayMs =
                        if (retryable && command.commandType == "downloads.chapter") {
                            maxOf(
                                ConfigManager.config.downloads.failedRetryDelaySeconds * 1000L,
                                (httpError?.retryAfterSeconds ?: 0L) * 1000L,
                            )
                        } else if (retryable && (command.commandType == "discovery.feed.crawl" || command.commandType == "discovery.title.hydrate")) {
                            maxOf(
                                DISCOVERY_RETRY_DELAY_MS,
                                (httpError?.retryAfterSeconds ?: 0L) * 1000L,
                            )
                        } else {
                            5_000L
                        }
                    if (retryable) {
                        if (failure.expected || command.commandType == "discovery.feed.crawl" || command.commandType == "discovery.title.hydrate") {
                            events.warn(
                                "bridge.command.failed",
                                "Bridge command execution failed",
                                "durationMs" to durationMs,
                                "retryDelayMs" to retryDelayMs,
                                "throwable_class" to error::class.simpleName,
                                "throwable_message" to failure.message,
                                "httpCode" to failure.httpCode,
                            )
                        } else {
                            events.error(
                                "bridge.command.failed",
                                "Bridge command execution failed",
                                error,
                                "durationMs" to durationMs,
                                "retryDelayMs" to retryDelayMs,
                            )
                        }
                    } else {
                        events.warn(
                            "bridge.command.failed_permanent",
                            "Bridge command failed permanently",
                            "durationMs" to durationMs,
                            "retryDelayMs" to retryDelayMs,
                            "throwable_class" to error::class.simpleName,
                            "throwable_message" to failure.message,
                            "httpCode" to failure.httpCode,
                        )
                    }
                    if (command.commandType == "discovery.feed.crawl") {
                        runCatching {
                            val payload = command.payload.jsonObject
                            client.recordDiscoveryCrawlFailure(
                                client.payload(
                                    buildJsonObject {
                                        put("sourceId", payload.requiredString("sourceId"))
                                        put("feedType", payload.requiredString("feedType"))
                                        put("message", failure.message)
                                        put("retryAfterMs", (httpError?.retryAfterSeconds ?: 0L) * 1000L)
                                        put("now", System.currentTimeMillis())
                                    },
                                ),
                            )
                        }
                    } else if (command.commandType == "discovery.title.hydrate") {
                        runCatching {
                            val payload = command.payload.jsonObject
                            client.recordDiscoveryTitleHydrationFailure(
                                client.payload(
                                    buildJsonObject {
                                        put("sourceId", payload.requiredString("sourceId"))
                                        put("titleUrl", payload.requiredString("titleUrl"))
                                        put("retryAfterMs", (httpError?.retryAfterSeconds ?: 0L) * 1000L)
                                        put("now", System.currentTimeMillis())
                                    },
                                ),
                            )
                        }
                    }
                    val failed =
                        client.failCommand(
                            client.payload(
                                buildJsonObject {
                                    put("commandId", command.id)
                                    put("bridgeId", bridgeId)
                                    put("leaseToken", command.leaseToken)
                                    put("now", System.currentTimeMillis())
                                    put("message", failure.message)
                                    put("retryDelayMs", retryDelayMs)
                                    put("retryable", retryable)
                                    failure.code?.let { put("failureCode", it) }
                                },
                            ),
                        )
                    if (failed.stale) {
                        events.warn(
                            "bridge.command.stale_lease_on_fail",
                            "Bridge command failed after lease ownership moved; skipping stale failure write",
                            "commandId" to command.id,
                            "bridgeId" to bridgeId,
                        )
                    } else if (!failed.ok) {
                        events.warn(
                            "bridge.command.fail_rejected",
                            "Bridge command failure could not be recorded",
                            "commandId" to command.id,
                            "bridgeId" to bridgeId,
                        )
                    }
                }
            } finally {
                renewJob.cancel()
            }
        }
    }

    private fun executeCommand(client: ConvexBridgeClient, command: LeaseCommand): JsonObject {
        val payload = command.payload.jsonObject
        return when (command.commandType) {
            "extensions.repo.sync" -> {
                val url = payload.requiredString("url")
                val syncResult = service.syncRepository(url)
                val persisted =
                    client.setExtensionRepository(
                        client.payload(
                            buildJsonObject {
                                put("url", url)
                                put("languages", syncResult["languages"] ?: kotlinx.serialization.json.JsonArray(emptyList()))
                                put("now", System.currentTimeMillis())
                            },
                        ),
                    )

                buildJsonObject {
                    put("ok", true)
                    put("url", url)
                    put("extensionCount", syncResult["extensionCount"] ?: JsonPrimitive(0))
                    put("updated", persisted.updated)
                    put("created", persisted.created)
                }
            }
            "extensions.repo.search" -> {
                val query = payload.optionalString("query").orEmpty()
                val limit = payload.optionalInt("limit") ?: 5000
                service.searchRepository(query, limit)
            }
            "extensions.install" -> {
                val pkg = payload.requiredString("pkg")
                val installed = kotlinx.coroutines.runBlocking { service.installExtension(pkg) }
                client.upsertInstalledExtension(
                    client.payload(
                        buildJsonObject {
                            put("pkg", installed.pkg)
                            put("name", installed.name)
                            put("lang", installed.lang)
                            put("version", installed.version)
                            put(
                                "sourceIds",
                                kotlinx.serialization.json.buildJsonArray {
                                    installed.sources.forEach { add(JsonPrimitive(it.id.toString())) }
                                },
                            )
                            put(
                                "sources",
                                kotlinx.serialization.json.buildJsonArray {
                                    installed.sources.forEach { source ->
                                        add(
                                            buildJsonObject {
                                                put("id", source.id.toString())
                                                put("name", source.name)
                                                put("lang", source.lang)
                                                put("supportsLatest", source.supportsLatest)
                                                put("enabled", source.enabled)
                                            },
                                        )
                                    }
                                },
                            )
                            put("now", System.currentTimeMillis())
                        },
                    ),
                )
                buildJsonObject {
                    put("ok", true)
                    put("pkg", installed.pkg)
                    put("name", installed.name)
                    put("lang", installed.lang)
                    put("version", installed.version)
                    put(
                        "sourceIds",
                        kotlinx.serialization.json.buildJsonArray {
                            installed.sources.forEach { add(JsonPrimitive(it.id.toString())) }
                        },
                    )
                    put(
                        "sources",
                        kotlinx.serialization.json.buildJsonArray {
                            installed.sources.forEach { source ->
                                add(
                                    buildJsonObject {
                                        put("id", source.id.toString())
                                        put("name", source.name)
                                        put("lang", source.lang)
                                        put("supportsLatest", source.supportsLatest)
                                        put("enabled", source.enabled)
                                    },
                                )
                            }
                        },
                    )
                }
            }
            "extensions.update" -> {
                val pkg = payload.requiredString("pkg")
                val updated = kotlinx.coroutines.runBlocking { service.updateExtension(pkg) }
                client.upsertInstalledExtension(
                    client.payload(
                        buildJsonObject {
                            put("pkg", updated.pkg)
                            put("name", updated.name)
                            put("lang", updated.lang)
                            put("version", updated.version)
                            put(
                                "sourceIds",
                                kotlinx.serialization.json.buildJsonArray {
                                    updated.sources.forEach { add(JsonPrimitive(it.id.toString())) }
                                },
                            )
                            put(
                                "sources",
                                kotlinx.serialization.json.buildJsonArray {
                                    updated.sources.forEach { source ->
                                        add(
                                            buildJsonObject {
                                                put("id", source.id.toString())
                                                put("name", source.name)
                                                put("lang", source.lang)
                                                put("supportsLatest", source.supportsLatest)
                                                put("enabled", source.enabled)
                                            },
                                        )
                                    }
                                },
                            )
                            put("now", System.currentTimeMillis())
                        },
                    ),
                )
                buildJsonObject {
                    put("ok", true)
                    put("pkg", updated.pkg)
                    put("name", updated.name)
                    put("lang", updated.lang)
                    put("version", updated.version)
                }
            }
            "extensions.uninstall" -> {
                val pkg = payload.requiredString("pkg")
                val result = kotlinx.coroutines.runBlocking { service.uninstallExtension(pkg) }
                client.removeInstalledExtension(
                    client.payload(
                        buildJsonObject {
                            put("pkg", pkg)
                        },
                    ),
                )
                result
            }
            "sources.preferences.fetch" -> {
                val sourceId = payload.requiredString("sourceId")
                kotlinx.coroutines.runBlocking { service.fetchSourcePreferences(sourceId) }
            }
            "sources.preferences.save" -> {
                val sourceId = payload.requiredString("sourceId")
                val entries =
                    payload["entries"]?.jsonArray?.map { entry ->
                        val obj = entry.jsonObject
                        obj.requiredString("key") to (obj["value"] ?: JsonNull)
                    }
                        ?: payload["values"]?.jsonObject?.entries?.map { it.key to it.value }
                        ?: error("Missing values")
                kotlinx.coroutines.runBlocking { service.saveSourcePreferences(sourceId, entries) }
            }
            "explore.search" -> {
                val query = payload["query"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val limit = payload.optionalInt("limit") ?: 30
                val page = payload.optionalInt("page") ?: 1
                val sourceId = payload.optionalString("sourceId")
                val searchFilters = payload["searchFilters"]?.jsonObject
                kotlinx.coroutines.runBlocking {
                    service.searchTitles(query, limit, sourceId, searchFilters, page)
                }
            }
            "explore.popular" -> {
                val sourceId = payload.requiredString("sourceId")
                val page = payload.optionalInt("page") ?: 1
                val limit = payload.optionalInt("limit") ?: 30
                val result = kotlinx.coroutines.runBlocking { service.fetchPopular(sourceId, page, limit) }
                client.ingestDiscoveryFeedPage(
                    client.payload(
                        buildJsonObject {
                            put("feedType", "popular")
                            put("sourceId", sourceId)
                            put("page", page)
                            put("hasNextPage", result["hasNextPage"] ?: JsonPrimitive(false))
                            put("items", result["items"] ?: kotlinx.serialization.json.buildJsonArray { })
                            put("updateCrawlState", false)
                            put("now", System.currentTimeMillis())
                        },
                    ),
                )
                result
            }
            "explore.latest" -> {
                val sourceId = payload.requiredString("sourceId")
                val page = payload.optionalInt("page") ?: 1
                val limit = payload.optionalInt("limit") ?: 30
                val result = kotlinx.coroutines.runBlocking { service.fetchLatest(sourceId, page, limit) }
                client.ingestDiscoveryFeedPage(
                    client.payload(
                        buildJsonObject {
                            put("feedType", "latest")
                            put("sourceId", sourceId)
                            put("page", page)
                            put("hasNextPage", result["hasNextPage"] ?: JsonPrimitive(false))
                            put("items", result["items"] ?: kotlinx.serialization.json.buildJsonArray { })
                            put("updateCrawlState", false)
                            put("now", System.currentTimeMillis())
                        },
                    ),
                )
                result
            }
            "discovery.feed.crawl" -> {
                val sourceId = payload.requiredString("sourceId")
                val feedType = payload.requiredString("feedType")
                val page = payload.optionalInt("page") ?: 1
                val limit = payload.optionalInt("limit") ?: 24
                val result =
                    when (feedType) {
                        "latest" -> kotlinx.coroutines.runBlocking { service.fetchLatest(sourceId, page, limit) }
                        else -> kotlinx.coroutines.runBlocking { service.fetchPopular(sourceId, page, limit) }
                    }
                client.ingestDiscoveryFeedPage(
                    client.payload(
                        buildJsonObject {
                            put("feedType", feedType)
                            put("sourceId", sourceId)
                            put("page", page)
                            put("hasNextPage", result["hasNextPage"] ?: JsonPrimitive(false))
                            put("items", result["items"] ?: kotlinx.serialization.json.buildJsonArray { })
                            put("updateCrawlState", true)
                            put("now", System.currentTimeMillis())
                        },
                    ),
                )
                result
            }
            "discovery.title.hydrate" -> {
                val sourceId = payload.requiredString("sourceId")
                val titleUrl = payload.requiredString("titleUrl")
                val titleResult = kotlinx.coroutines.runBlocking { service.fetchTitle(sourceId, titleUrl) }
                val normalizedTitle = titleResult["title"]?.jsonObject ?: error("Missing title payload")
                client.upsertLibraryTitleMetadata(
                    client.payload(
                        buildJsonObject {
                            put("sourceId", sourceId)
                            put("titleUrl", titleUrl)
                            put("sourcePkg", normalizedTitle.optionalString("sourcePkg"))
                            put("sourceLang", normalizedTitle.optionalString("sourceLang"))
                            put("title", normalizedTitle.requiredString("title"))
                            put("author", normalizedTitle.optionalString("author"))
                            put("artist", normalizedTitle.optionalString("artist"))
                            put("description", normalizedTitle.optionalString("description"))
                            put("coverUrl", normalizedTitle.optionalString("coverUrl"))
                            put("genre", normalizedTitle.optionalString("genre"))
                            put("status", normalizedTitle.optionalInt("status") ?: 0)
                            put("now", System.currentTimeMillis())
                        },
                    ),
                )
                client.upsertDiscoveryTitleMetadata(
                    client.payload(
                        buildJsonObject {
                            put("sourceId", sourceId)
                            put("titleUrl", titleUrl)
                            put("sourcePkg", normalizedTitle.optionalString("sourcePkg"))
                            put("sourceLang", normalizedTitle.optionalString("sourceLang"))
                            put("title", normalizedTitle.requiredString("title"))
                            put("author", normalizedTitle.optionalString("author"))
                            put("description", normalizedTitle.optionalString("description"))
                            put("coverUrl", normalizedTitle.optionalString("coverUrl"))
                            put("genre", normalizedTitle.optionalString("genre"))
                            put("status", normalizedTitle.optionalInt("status") ?: 0)
                            put("now", System.currentTimeMillis())
                        },
                    ),
                )
                titleResult
            }
            "explore.title.fetch" -> {
                val sourceId = payload.requiredString("sourceId")
                val titleUrl = payload.requiredString("titleUrl")
                val titleResult = kotlinx.coroutines.runBlocking { service.fetchTitle(sourceId, titleUrl) }
                val normalizedTitle = titleResult["title"]?.jsonObject ?: error("Missing title payload")
                client.upsertLibraryTitleMetadata(
                    client.payload(
                        buildJsonObject {
                            put("sourceId", sourceId)
                            put("titleUrl", titleUrl)
                            put("sourcePkg", normalizedTitle.optionalString("sourcePkg"))
                            put("sourceLang", normalizedTitle.optionalString("sourceLang"))
                            put("title", normalizedTitle.requiredString("title"))
                            put("author", normalizedTitle.optionalString("author"))
                            put("artist", normalizedTitle.optionalString("artist"))
                            put("description", normalizedTitle.optionalString("description"))
                            put("coverUrl", normalizedTitle.optionalString("coverUrl"))
                            put("genre", normalizedTitle.optionalString("genre"))
                            put("status", normalizedTitle.optionalInt("status") ?: 0)
                            put("now", System.currentTimeMillis())
                        },
                    ),
                )
                client.upsertDiscoveryTitleMetadata(
                    client.payload(
                        buildJsonObject {
                            put("sourceId", sourceId)
                            put("titleUrl", titleUrl)
                            put("sourcePkg", normalizedTitle.optionalString("sourcePkg"))
                            put("sourceLang", normalizedTitle.optionalString("sourceLang"))
                            put("title", normalizedTitle.requiredString("title"))
                            put("author", normalizedTitle.optionalString("author"))
                            put("description", normalizedTitle.optionalString("description"))
                            put("coverUrl", normalizedTitle.optionalString("coverUrl"))
                            put("genre", normalizedTitle.optionalString("genre"))
                            put("status", normalizedTitle.optionalInt("status") ?: 0)
                            put("now", System.currentTimeMillis())
                        },
                    ),
                )
                titleResult
            }
            "explore.chapters.fetch" -> {
                val sourceId = payload.requiredString("sourceId")
                val titleUrl = payload.requiredString("titleUrl")
                kotlinx.coroutines.runBlocking { service.fetchChapters(sourceId, titleUrl) }
            }
            "reader.pages.fetch" -> {
                val sourceId = payload.requiredString("sourceId")
                val chapterUrl = payload.requiredString("chapterUrl")
                val chapterName = payload.optionalString("chapterName")
                kotlinx.coroutines.runBlocking { service.fetchPages(sourceId, chapterUrl, chapterName) }
            }
            "library.chapters.sync" -> {
                val titleId = payload.requiredString("titleId")
                val sourceId = payload.requiredString("sourceId")
                val titleUrl = payload.requiredString("titleUrl")
                val chapters = kotlinx.coroutines.runBlocking { service.fetchChapters(sourceId, titleUrl) }
                client.upsertLibraryChapters(
                    client.payload(
                        buildJsonObject {
                            put("titleId", titleId)
                            put("sourceId", sourceId)
                            put("titleUrl", titleUrl)
                            put("chapters", chapters["chapters"] ?: error("Missing chapters payload"))
                            put("now", System.currentTimeMillis())
                        },
                    ),
                )
                buildJsonObject {
                    put("ok", true)
                    put("titleId", titleId)
                    put("chapterCount", chapters["chapters"]?.jsonArray?.size ?: 0)
                }
            }
            "library.cover.cache" -> {
                val titleId = payload.requiredString("titleId")
                val sourceId = payload.optionalString("sourceId")
                val coverUrl = payload.optionalString("coverUrl")
                val coverPath = cacheLibraryCover(client, titleId, sourceId, coverUrl)
                buildJsonObject {
                    put("ok", true)
                    put("titleId", titleId)
                    put("cached", !coverPath.isNullOrBlank())
                    put("localCoverPath", coverPath)
                }
            }
            "library.title.stats.refresh" -> {
                val titleId = payload.requiredString("titleId")
                client.refreshLibraryTitleStats(
                    client.payload(
                        buildJsonObject {
                            put("titleId", titleId)
                            put("now", System.currentTimeMillis())
                        },
                    ),
                )
                buildJsonObject {
                    put("ok", true)
                    put("titleId", titleId)
                }
            }
            "library.import" -> {
                val sourceId = payload.requiredString("sourceId")
                val sourcePkg = payload.requiredString("sourcePkg")
                val sourceLang = payload.requiredString("sourceLang")
                val titleUrl = payload.requiredString("titleUrl")
                val canonicalKey = payload.requiredString("canonicalKey")
                val userId = payload.optionalString("userId") ?: command.requestedByUserId
                val resolved =
                    try {
                        kotlinx.coroutines.runBlocking {
                            service.resolveImport(sourceId, sourcePkg, sourceLang, titleUrl)
                        }
                    } catch (error: Exception) {
                        val fallbackResolved =
                            fallbackImportMetadata(
                                payload = payload,
                                sourceId = sourceId,
                                sourcePkg = sourcePkg,
                                sourceLang = sourceLang,
                                titleUrl = titleUrl,
                                canonicalKey = canonicalKey,
                            )
                        if (fallbackResolved != null && error is SerializationException) {
                            events.warn(
                                "bridge.library.import.metadata_fallback",
                                "Falling back to caller metadata after title details decoding failed",
                                "sourceId" to sourceId,
                                "titleUrl" to titleUrl,
                                "commandId" to command.id,
                                "error" to (error.message ?: "Unknown serialization error"),
                            )
                            fallbackResolved
                        } else {
                            throw error
                        }
                    }

                client.upsertLibraryTitleMetadata(
                    client.payload(
                        buildJsonObject {
                            put("sourceId", sourceId)
                            put("titleUrl", titleUrl)
                            put("sourcePkg", sourcePkg)
                            put("sourceLang", sourceLang)
                            put("title", resolved.requiredString("title"))
                            put("author", resolved.optionalString("author"))
                            put("artist", resolved.optionalString("artist"))
                            put("description", resolved.optionalString("description"))
                            put("coverUrl", resolved.optionalString("coverUrl"))
                            put("genre", resolved.optionalString("genre"))
                            put("status", resolved.optionalInt("status") ?: 0)
                            put("now", System.currentTimeMillis())
                        },
                    ),
                )

                val clientResult =
                    client.importLibraryTitle(
                        client.payload(
                            buildJsonObject {
                                put("userId", userId ?: error("Missing user id"))
                                put("canonicalKey", canonicalKey)
                                put("sourceId", sourceId)
                                put("sourcePkg", sourcePkg)
                                put("sourceLang", sourceLang)
                                put("titleUrl", titleUrl)
                                put("title", resolved.requiredString("title"))
                                put("author", resolved.optionalString("author"))
                                put("artist", resolved.optionalString("artist"))
                                put("description", resolved.optionalString("description"))
                                put("coverUrl", resolved.optionalString("coverUrl"))
                                put("genre", resolved.optionalString("genre"))
                                put("status", resolved.optionalInt("status") ?: 0)
                                put("now", System.currentTimeMillis())
                            },
                        ),
                    )

                val coverPath =
                    cacheLibraryCover(
                        client,
                        clientResult.titleId,
                        sourceId,
                        resolved.optionalString("coverUrl"),
                    )

                val chapters =
                    try {
                        kotlinx.coroutines.runBlocking { service.fetchChapters(sourceId, titleUrl) }
                    } catch (error: Exception) {
                        val httpError = error.findHttpException()
                        if (httpError != null && isPermanentHttpFailure(httpError.code)) {
                            events.warn(
                                "bridge.library.import.chapter_sync_blocked",
                                "Initial chapter sync was blocked by a permanent source failure",
                                "titleId" to clientResult.titleId,
                                "sourceId" to sourceId,
                                "titleUrl" to titleUrl,
                                "httpCode" to httpError.code,
                                "message" to (error.message ?: "Unknown chapter sync failure"),
                            )
                            null
                        } else {
                            throw error
                        }
                    }
                if (chapters != null) {
                    client.upsertLibraryChapters(
                        client.payload(
                            buildJsonObject {
                                put("titleId", clientResult.titleId)
                                put("sourceId", sourceId)
                                put("titleUrl", titleUrl)
                                put("chapters", chapters["chapters"] ?: error("Missing chapters payload"))
                                put("now", System.currentTimeMillis())
                            },
                        ),
                    )
                }

                buildJsonObject {
                    put("ok", true)
                    put("created", clientResult.created)
                    put("titleId", clientResult.titleId)
                    put("title", resolved.requiredString("title"))
                    put("genre", resolved.optionalString("genre"))
                    put("status", resolved.optionalInt("status") ?: 0)
                    put("localCoverPath", coverPath)
                    put("chapterCount", chapters?.get("chapters")?.jsonArray?.size ?: 0)
                    put("chapterSyncBlocked", chapters == null)
                }
            }
            "downloads.chapter" -> {
                val chapterId = payload.requiredString("chapterId")
                val downloadTaskId = payload.optionalString("downloadTaskId") ?: command.id
                val titleId = payload.requiredString("titleId")
                val titleName = payload.optionalString("title") ?: titleId
                val sourceId = payload.requiredString("sourceId")
                val sourcePkg = payload.optionalString("sourcePkg") ?: "source"
                val sourceLang = payload.optionalString("sourceLang") ?: ""
                val chapterUrl = payload.requiredString("chapterUrl")
                val chapterName = payload.optionalString("chapterName") ?: "chapter"
                val chapterNumber = payload.optionalDouble("chapterNumber")
                val attemptOwner =
                    buildString {
                        append(downloadTaskId)
                        append("-")
                        append(command.id)
                        append("-")
                        append(command.attemptCount.toInt())
                        append("-")
                        append(command.leaseToken)
                    }

                client.setLibraryChapterDownloadState(
                    client.payload(
                        buildJsonObject {
                            put("chapterId", chapterId)
                            downloadTaskId?.let { put("downloadTaskId", it) }
                            put("status", "downloading")
                            put("downloadedPages", 0)
                            put("lastErrorMessage", "")
                            put("now", System.currentTimeMillis())
                        },
                    ),
                )

                try {
                    var lastDownloadProgressUpdateAt = System.currentTimeMillis()
                    var lastDownloadLeaseRenewAt = lastDownloadProgressUpdateAt
                    val downloadProgressLock = Any()
                    val result =
                        kotlinx.coroutines.runBlocking {
                            service.downloadChapter(
                                titleId = titleId,
                                titleName = titleName,
                                sourceId = sourceId,
                                sourcePkg = sourcePkg,
                                sourceLang = sourceLang,
                                chapterUrl = chapterUrl,
                                chapterName = chapterName,
                                chapterNumber = chapterNumber,
                                downloadTaskId = downloadTaskId,
                                attemptOwner = attemptOwner,
                            ) { downloadedPages, totalPages ->
                                val now = System.currentTimeMillis()
                                val (shouldRenewLease, shouldPushProgress) =
                                    synchronized(downloadProgressLock) {
										val renewLease =
											now - lastDownloadLeaseRenewAt >= DOWNLOAD_LEASE_RENEW_INTERVAL_MS
										if (renewLease) {
											lastDownloadLeaseRenewAt = now
										}

										val pushProgress =
											downloadedPages <= 1 ||
												now - lastDownloadProgressUpdateAt >= DOWNLOAD_PROGRESS_UPDATE_INTERVAL_MS
										if (pushProgress) {
											lastDownloadProgressUpdateAt = now
										}

										renewLease to pushProgress
									}
								if (shouldRenewLease) {
									renewLeaseOrThrowStale(client, command, now)
								}

                                if (shouldPushProgress) {
                                    client.setLibraryChapterDownloadState(
                                        client.payload(
                                            buildJsonObject {
                                                put("chapterId", chapterId)
                                                downloadTaskId?.let { put("downloadTaskId", it) }
                                                put("status", "downloading")
                                                put("downloadedPages", downloadedPages)
                                                put("totalPages", totalPages)
                                                put("now", now)
                                            },
                                        ),
                                    )
                                }
                            }
                        }

                    client.setLibraryChapterDownloadState(
                        client.payload(
                            buildJsonObject {
                                put("chapterId", chapterId)
                                downloadTaskId?.let { put("downloadTaskId", it) }
                                put("status", "downloaded")
                                put("downloadedPages", result.requiredInt("downloadedPages"))
                                put("totalPages", result.requiredInt("totalPages"))
                                put("localRelativePath", result.requiredString("localRelativePath"))
                                put("storageKind", result.requiredString("storageKind"))
                                put("fileSizeBytes", result.requiredLong("fileSizeBytes"))
                                put("lastErrorMessage", "")
                                put("now", System.currentTimeMillis())
                            },
                        ),
                    )

                    result
                } catch (error: Exception) {
                    if (error !is StaleCommandLeaseException) {
                        client.setLibraryChapterDownloadState(
                            client.payload(
                                buildJsonObject {
                                    put("chapterId", chapterId)
                                    downloadTaskId.let { put("downloadTaskId", it) }
                                    put("status", "failed")
                                    put("lastErrorMessage", error.message ?: "Download failed")
                                    put("now", System.currentTimeMillis())
                                },
                            ),
                        )
                    }
                    throw error
                }
            }
            else -> throw IllegalStateException("Unsupported command type: ${command.commandType}")
        }
    }

    private fun cacheLibraryCover(
        client: ConvexBridgeClient,
        titleId: String,
        sourceId: String?,
        coverUrl: String?,
    ): String? {
        val coverPath =
            runCatching {
                kotlinx.coroutines.runBlocking {
                    service.cacheCover(titleId, sourceId, coverUrl)
                }
            }.onFailure { error ->
                events.error(
                    "bridge.library.cover_cache_failed",
                    "Failed to cache cover for library title",
                    error,
                    "titleId" to titleId,
                )
            }.getOrNull()

        if (!coverPath.isNullOrBlank()) {
            client.setLibraryTitleLocalCover(
                client.payload(
                    buildJsonObject {
                        put("titleId", titleId)
                        put("localCoverPath", coverPath)
                        put("now", System.currentTimeMillis())
                    },
                ),
            )
        }

        return coverPath
    }

    private fun JsonObject.requiredString(key: String): String =
        this[key]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("Missing $key")

    private fun JsonObject.optionalString(key: String): String? =
        this[key]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }

    private fun fallbackImportMetadata(
        payload: JsonObject,
        sourceId: String,
        sourcePkg: String,
        sourceLang: String,
        titleUrl: String,
        canonicalKey: String,
    ): JsonObject? {
        val fallbackTitle = payload.optionalString("fallbackTitle") ?: return null
        return buildJsonObject {
            put("canonicalKey", canonicalKey)
            put("sourceId", sourceId)
            put("sourcePkg", sourcePkg)
            put("sourceLang", sourceLang)
            put("titleUrl", titleUrl)
            put("title", fallbackTitle)
            put("author", payload.optionalString("fallbackAuthor"))
            put("artist", payload.optionalString("fallbackArtist"))
            put("description", payload.optionalString("fallbackDescription"))
            put("coverUrl", payload.optionalString("fallbackCoverUrl"))
            put("genre", payload.optionalString("fallbackGenre"))
            put("status", 0)
        }
    }

    private fun JsonObject.optionalInt(key: String): Int? =
        this[key]?.jsonPrimitive?.intLikeOrNull()

    private fun JsonObject.optionalDouble(key: String): Double? =
        this[key]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull()

    private fun JsonObject.requiredInt(key: String): Int =
        this[key]?.jsonPrimitive?.intLikeOrNull() ?: throw IllegalArgumentException("Missing $key")

    private fun JsonObject.requiredLong(key: String): Long =
        this[key]?.jsonPrimitive?.contentOrNull?.toLongOrNull()
            ?: throw IllegalArgumentException("Missing $key")

    private fun commandContext(command: LeaseCommand): LogContext {
        val payload = command.payload.jsonObject
        return LogContext.of(
            "bridgeId" to bridgeId,
            "commandId" to command.id,
            "commandType" to command.commandType,
            "requestedByUserId" to command.requestedByUserId,
            "sourceId" to payload.optionalString("sourceId"),
            "titleId" to payload.optionalString("titleId"),
            "titleUrl" to payload.optionalString("titleUrl"),
            "chapterId" to payload.optionalString("chapterId"),
            "chapterUrl" to payload.optionalString("chapterUrl"),
            "pkg" to payload.optionalString("pkg"),
        )
    }

    private fun kotlinx.serialization.json.JsonPrimitive.intLikeOrNull(): Int? {
        val numeric = contentOrNull?.toDoubleOrNull() ?: return null
        if (!numeric.isFinite() || numeric % 1.0 != 0.0) return null
        return numeric.toInt()
    }
}
