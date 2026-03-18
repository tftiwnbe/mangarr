package mangarr.tachibridge.runtime

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
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

@Serializable
data class CommandRunnerSnapshot(
    val configured: Boolean,
    val running: Boolean,
    val lastPollAt: Long? = null,
    val lastSuccessAt: Long? = null,
    val lastError: String? = null,
)

class BridgeCommandRunner(
    private val bridgeClient: ConvexBridgeClient?,
    private val service: BridgeService,
    private val bridgeId: String,
    private val pollIntervalMs: Long,
    private val leaseDurationMs: Long,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var job: Job? = null
    @Volatile
    private var snapshot =
        CommandRunnerSnapshot(
            configured = bridgeClient != null,
            running = false,
            lastError = if (bridgeClient == null) "Convex URL is not configured" else null,
        )

    fun snapshot(): CommandRunnerSnapshot = snapshot

    fun start() {
        if (job != null) {
            return
        }
        snapshot = snapshot.copy(running = true)
        job =
            scope.launch {
                while (isActive) {
                    poll()
                    delay(pollIntervalMs)
                }
            }
    }

    suspend fun stop() {
        job?.cancel()
        job = null
        snapshot = snapshot.copy(running = false)
    }

    private fun poll() {
        val client = bridgeClient ?: return
        val now = System.currentTimeMillis()
        snapshot = snapshot.copy(lastPollAt = now)

        try {
            val leased =
                client.leaseCommands(
                    client.payload(
                        buildJsonObject {
                            put("bridgeId", bridgeId)
                            put(
                                "capabilities",
                                kotlinx.serialization.json.buildJsonArray {
                                    add(JsonPrimitive("extensions.repo"))
                                    add(JsonPrimitive("extensions.install"))
                                    add(JsonPrimitive("sources.preferences"))
                                    add(JsonPrimitive("explore.search"))
                                    add(JsonPrimitive("explore.feed"))
                                    add(JsonPrimitive("explore.title.fetch"))
                                    add(JsonPrimitive("reader.pages.fetch"))
                                    add(JsonPrimitive("library.chapters.sync"))
                                    add(JsonPrimitive("library.import"))
                                    add(JsonPrimitive("downloads.chapter"))
                                },
                            )
                            put("now", now)
                            put("limit", 4)
                            put("leaseDurationMs", leaseDurationMs)
                        },
                    ),
                )

            if (leased.isNotEmpty()) {
                events.debug(
                    "bridge.commands.leased",
                    "Leased bridge commands",
                    "bridgeId" to bridgeId,
                    "count" to leased.size,
                )
            }

            for (command in leased) {
                handleCommand(client, command)
            }

            snapshot = snapshot.copy(lastSuccessAt = now, lastError = null)
        } catch (error: Exception) {
            events.error(
                "bridge.commands.poll_failed",
                "Bridge command poll failed",
                error,
                "bridgeId" to bridgeId,
            )
            snapshot = snapshot.copy(lastError = error.message ?: "Unknown command error")
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

            client.markCommandRunning(
                client.payload(
                    buildJsonObject {
                        put("commandId", command.id)
                        put("bridgeId", bridgeId)
                        put("now", startedAt)
                        put("leaseDurationMs", leaseDurationMs)
                    },
                ),
            )

            try {
                client.renewCommandLease(
                    client.payload(
                        buildJsonObject {
                            put("commandId", command.id)
                            put("bridgeId", bridgeId)
                            put("now", System.currentTimeMillis())
                            put("leaseDurationMs", leaseDurationMs)
                        },
                    ),
                )

                val result = executeCommand(client, command)
                client.completeCommand(
                    client.payload(
                        buildJsonObject {
                            put("commandId", command.id)
                            put("bridgeId", bridgeId)
                            put("now", System.currentTimeMillis())
                            put("result", result)
                        },
                    ),
                )
                events.debug(
                    "bridge.command.completed",
                    "Completed bridge command",
                    "durationMs" to (System.currentTimeMillis() - startedAt),
                )
            } catch (error: Exception) {
                val retryDelayMs =
                    if (command.commandType == "downloads.chapter") {
                        ConfigManager.config.downloads.failedRetryDelaySeconds * 1000L
                    } else {
                        5_000L
                    }
                events.error(
                    "bridge.command.failed",
                    "Bridge command execution failed",
                    error,
                    "durationMs" to (System.currentTimeMillis() - startedAt),
                    "retryDelayMs" to retryDelayMs,
                )
                client.failCommand(
                    client.payload(
                        buildJsonObject {
                            put("commandId", command.id)
                            put("bridgeId", bridgeId)
                            put("now", System.currentTimeMillis())
                            put("message", error.message ?: "Unhandled bridge command error")
                            put("retryDelayMs", retryDelayMs)
                        },
                    ),
                )
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
                                    installed.sources.forEach { add(JsonPrimitive(it.id)) }
                                },
                            )
                            put(
                                "sources",
                                kotlinx.serialization.json.buildJsonArray {
                                    installed.sources.forEach { source ->
                                        add(
                                            buildJsonObject {
                                                put("id", source.id)
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
                            installed.sources.forEach { add(JsonPrimitive(it.id)) }
                        },
                    )
                    put(
                        "sources",
                        kotlinx.serialization.json.buildJsonArray {
                            installed.sources.forEach { source ->
                                add(
                                    buildJsonObject {
                                        put("id", source.id)
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
                                    updated.sources.forEach { add(JsonPrimitive(it.id)) }
                                },
                            )
                            put(
                                "sources",
                                kotlinx.serialization.json.buildJsonArray {
                                    updated.sources.forEach { source ->
                                        add(
                                            buildJsonObject {
                                                put("id", source.id)
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
                val values = payload["values"]?.jsonObject ?: error("Missing values")
                kotlinx.coroutines.runBlocking { service.saveSourcePreferences(sourceId, values) }
            }
            "explore.search" -> {
                val query = payload.requiredString("query")
                val limit = payload.optionalInt("limit") ?: 30
                val sourceId = payload.optionalString("sourceId")
                val searchFilters = payload["searchFilters"]?.jsonObject
                kotlinx.coroutines.runBlocking { service.searchTitles(query, limit, sourceId, searchFilters) }
            }
            "explore.popular" -> {
                val sourceId = payload.requiredString("sourceId")
                val page = payload.optionalInt("page") ?: 1
                val limit = payload.optionalInt("limit") ?: 30
                kotlinx.coroutines.runBlocking { service.fetchPopular(sourceId, page, limit) }
            }
            "explore.latest" -> {
                val sourceId = payload.requiredString("sourceId")
                val page = payload.optionalInt("page") ?: 1
                val limit = payload.optionalInt("limit") ?: 30
                kotlinx.coroutines.runBlocking { service.fetchLatest(sourceId, page, limit) }
            }
            "explore.title.fetch" -> {
                val sourceId = payload.requiredString("sourceId")
                val titleUrl = payload.requiredString("titleUrl")
                kotlinx.coroutines.runBlocking { service.fetchTitle(sourceId, titleUrl) }
            }
            "explore.chapters.fetch" -> {
                val sourceId = payload.requiredString("sourceId")
                val titleUrl = payload.requiredString("titleUrl")
                kotlinx.coroutines.runBlocking { service.fetchChapters(sourceId, titleUrl) }
            }
            "reader.pages.fetch" -> {
                val sourceId = payload.requiredString("sourceId")
                val chapterUrl = payload.requiredString("chapterUrl")
                kotlinx.coroutines.runBlocking { service.fetchPages(sourceId, chapterUrl) }
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
            "library.import" -> {
                val sourceId = payload.requiredString("sourceId")
                val sourcePkg = payload.requiredString("sourcePkg")
                val sourceLang = payload.requiredString("sourceLang")
                val titleUrl = payload.requiredString("titleUrl")
                val canonicalKey = payload.requiredString("canonicalKey")
                val userId = payload.optionalString("userId") ?: command.requestedByUserId
                val resolved =
                    kotlinx.coroutines.runBlocking {
                        service.resolveImport(sourceId, sourcePkg, sourceLang, titleUrl)
                    }

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
                    runCatching {
                        service.cacheCover(clientResult.titleId, resolved.optionalString("coverUrl"))
                    }.onFailure { error ->
                        events.error(
                            "bridge.library.cover_cache_failed",
                            "Failed to cache cover for imported title",
                            error,
                            "titleId" to clientResult.titleId,
                        )
                    }.getOrNull()

                if (!coverPath.isNullOrBlank()) {
                    client.setLibraryTitleLocalCover(
                        client.payload(
                            buildJsonObject {
                                put("titleId", clientResult.titleId)
                                put("localCoverPath", coverPath)
                                put("now", System.currentTimeMillis())
                            },
                        ),
                    )
                }

                val chapters = kotlinx.coroutines.runBlocking { service.fetchChapters(sourceId, titleUrl) }
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

                buildJsonObject {
                    put("ok", true)
                    put("created", clientResult.created)
                    put("titleId", clientResult.titleId)
                    put("title", resolved.requiredString("title"))
                    put("genre", resolved.optionalString("genre"))
                    put("status", resolved.optionalInt("status") ?: 0)
                    put("localCoverPath", coverPath)
                    put("chapterCount", chapters["chapters"]?.jsonArray?.size ?: 0)
                }
            }
            "downloads.chapter" -> {
                val chapterId = payload.requiredString("chapterId")
                val titleId = payload.requiredString("titleId")
                val sourceId = payload.requiredString("sourceId")
                val chapterUrl = payload.requiredString("chapterUrl")

                client.setLibraryChapterDownloadState(
                    client.payload(
                        buildJsonObject {
                            put("chapterId", chapterId)
                            put("status", "downloading")
                            put("downloadedPages", 0)
                            put("lastErrorMessage", "")
                            put("now", System.currentTimeMillis())
                        },
                    ),
                )

                try {
                    val result =
                        kotlinx.coroutines.runBlocking {
                            service.downloadChapter(titleId, sourceId, chapterUrl) { downloadedPages, totalPages ->
                                val now = System.currentTimeMillis()
                                client.renewCommandLease(
                                    client.payload(
                                        buildJsonObject {
                                            put("commandId", command.id)
                                            put("bridgeId", bridgeId)
                                            put("now", now)
                                            put("leaseDurationMs", leaseDurationMs)
                                        },
                                    ),
                                )
                                client.updateCommandProgress(
                                    client.payload(
                                        buildJsonObject {
                                            put("commandId", command.id)
                                            put("bridgeId", bridgeId)
                                            put("now", now)
                                            put(
                                                "progress",
                                                buildJsonObject {
                                                    put("downloadedPages", downloadedPages)
                                                    put("totalPages", totalPages)
                                                    put(
                                                        "percent",
                                                        if (totalPages > 0) {
                                                            (downloadedPages * 100) / totalPages
                                                        } else {
                                                            0
                                                        },
                                                    )
                                                },
                                            )
                                        },
                                    ),
                                )
                                client.setLibraryChapterDownloadState(
                                    client.payload(
                                        buildJsonObject {
                                            put("chapterId", chapterId)
                                            put("status", "downloading")
                                            put("downloadedPages", downloadedPages)
                                            put("totalPages", totalPages)
                                            put("now", now)
                                        },
                                    ),
                                )
                            }
                        }

                    client.setLibraryChapterDownloadState(
                        client.payload(
                            buildJsonObject {
                                put("chapterId", chapterId)
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
                    client.setLibraryChapterDownloadState(
                        client.payload(
                            buildJsonObject {
                                put("chapterId", chapterId)
                                put("status", "failed")
                                put("lastErrorMessage", error.message ?: "Download failed")
                                put("now", System.currentTimeMillis())
                            },
                        ),
                    )
                    throw error
                }
            }
            else -> throw IllegalStateException("Unsupported command type: ${command.commandType}")
        }
    }

    private fun JsonObject.requiredString(key: String): String =
        this[key]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("Missing $key")

    private fun JsonObject.optionalString(key: String): String? =
        this[key]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }

    private fun JsonObject.optionalInt(key: String): Int? =
        this[key]?.jsonPrimitive?.intOrNull

    private fun JsonObject.requiredInt(key: String): Int =
        this[key]?.jsonPrimitive?.intOrNull ?: throw IllegalArgumentException("Missing $key")

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
}
