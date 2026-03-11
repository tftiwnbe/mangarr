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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val logger = KotlinLogging.logger {}

@Serializable
data class HeartbeatSnapshot(
    val configured: Boolean,
    val lastAttemptAt: Long? = null,
    val lastSuccessAt: Long? = null,
    val lastError: String? = null,
)

class BridgeHeartbeatReporter(
    private val bridgeClient: ConvexBridgeClient?,
    private val bridgeState: BridgeState,
    private val bridgeId: String,
    private val version: String,
    private val intervalMs: Long,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var job: Job? = null
    @Volatile
    private var snapshot =
        HeartbeatSnapshot(
            configured = bridgeClient != null,
            lastError = if (bridgeClient == null) "Convex URL is not configured" else null,
        )

    fun snapshot(): HeartbeatSnapshot = snapshot

    fun start() {
        if (job != null) {
            return
        }
        job =
            scope.launch {
                while (isActive) {
                    runOnce()
                    delay(intervalMs)
                }
            }
    }

    suspend fun stop() {
        job?.cancel()
        job = null
    }

    private fun runOnce() {
        val now = System.currentTimeMillis()
        snapshot = snapshot.copy(lastAttemptAt = now)
        val client = bridgeClient ?: return
        val runtime = bridgeState.current()

        try {
            client.reportHeartbeat(
                client.payload(
                    buildJsonObject {
                        put("bridgeId", bridgeId)
                        put("version", version)
                        put("capabilities", kotlinx.serialization.json.JsonArray(emptyList()))
                        put("lastHeartbeatAt", now)
                        put("status", runtime.status)
                        put("port", runtime.port)
                        put("ready", runtime.ready)
                        put("restartCount", runtime.restartCount)
                        runtime.lastStartupError?.let { put("lastStartupError", it) }
                    },
                ),
            )
            snapshot = snapshot.copy(lastSuccessAt = now, lastError = null)
        } catch (error: Exception) {
            logger.error(error) { "Failed to report bridge heartbeat to Convex" }
            snapshot = snapshot.copy(lastError = error.message ?: "Unknown heartbeat error")
        }
    }
}
