package mangarr.tachibridge.runtime

import io.github.oshai.kotlinlogging.KotlinLogging
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
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

private val logger = KotlinLogging.logger {}

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
    private val service: BridgeAlphaService,
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
                                    add(JsonPrimitive("explore.search"))
                                    add(JsonPrimitive("explore.title.fetch"))
                                    add(JsonPrimitive("library.import"))
                                },
                            )
                            put("now", now)
                            put("limit", 10)
                            put("leaseDurationMs", leaseDurationMs)
                        },
                    ),
                )

            for (command in leased) {
                handleCommand(client, command)
            }

            snapshot = snapshot.copy(lastSuccessAt = now, lastError = null)
        } catch (error: Exception) {
            logger.error(error) { "Bridge command poll failed" }
            snapshot = snapshot.copy(lastError = error.message ?: "Unknown command error")
        }
    }

    private fun handleCommand(client: ConvexBridgeClient, command: LeaseCommand) {
        val now = System.currentTimeMillis()
        client.markCommandRunning(
            client.payload(
                buildJsonObject {
                    put("commandId", command.id)
                    put("bridgeId", bridgeId)
                    put("now", now)
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
        } catch (error: Exception) {
            logger.error(error) { "Bridge command execution failed for ${command.commandType}" }
            client.failCommand(
                client.payload(
                    buildJsonObject {
                        put("commandId", command.id)
                        put("bridgeId", bridgeId)
                        put("now", System.currentTimeMillis())
                        put("message", error.message ?: "Unhandled bridge command error")
                        put("retryDelayMs", 5000)
                    },
                ),
            )
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
                                    installed.sourceIds.forEach { add(JsonPrimitive(it)) }
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
                            installed.sourceIds.forEach { add(JsonPrimitive(it)) }
                        },
                    )
                }
            }
            "explore.search" -> {
                val query = payload.requiredString("query")
                val limit = payload.optionalInt("limit") ?: 30
                kotlinx.coroutines.runBlocking { service.searchTitles(query, limit) }
            }
            "explore.title.fetch" -> {
                val sourceId = payload.requiredString("sourceId")
                val titleUrl = payload.requiredString("titleUrl")
                kotlinx.coroutines.runBlocking { service.fetchTitle(sourceId, titleUrl) }
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
                                put("description", resolved.optionalString("description"))
                                put("coverUrl", resolved.optionalString("coverUrl"))
                                put("now", System.currentTimeMillis())
                            },
                        ),
                    )

                buildJsonObject {
                    put("ok", true)
                    put("created", clientResult.created)
                    put("titleId", clientResult.titleId)
                    put("title", resolved.requiredString("title"))
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
}
