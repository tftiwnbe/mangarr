package mangarr.tachibridge.runtime

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
import mangarr.tachibridge.logging.EventLogger

private val events = EventLogger.named(
    "mangarr.tachibridge.runtime.BridgeHeartbeatReporter",
    "component" to "bridge_heartbeat",
)
private const val HEARTBEAT_REPORT_MIN_INTERVAL_MS = 60_000L

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
    private var lastReportedAt: Long? = null
    @Volatile
    private var lastReportedState: HeartbeatStateSignature? = null
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
        val signature =
            HeartbeatStateSignature(
                status = runtime.status,
                port = runtime.port,
                ready = runtime.ready,
                restartCount = runtime.restartCount,
                lastStartupError = runtime.lastStartupError,
            )
        val lastSentAt = lastReportedAt
        val shouldReport =
            lastSentAt == null ||
                lastReportedState != signature ||
                now - lastSentAt >= HEARTBEAT_REPORT_MIN_INTERVAL_MS

        if (!shouldReport) {
            return
        }

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
            lastReportedAt = now
            lastReportedState = signature
            snapshot = snapshot.copy(lastSuccessAt = now, lastError = null)
        } catch (error: Exception) {
            events.error(
                "bridge.heartbeat.failed",
                "Failed to report bridge heartbeat to Convex",
                error,
                "bridgeId" to bridgeId,
                "status" to runtime.status,
                "ready" to runtime.ready,
                "restartCount" to runtime.restartCount,
            )
            snapshot = snapshot.copy(lastError = error.message ?: "Unknown heartbeat error")
        }
    }
}

private data class HeartbeatStateSignature(
    val status: String,
    val port: Int,
    val ready: Boolean,
    val restartCount: Int,
    val lastStartupError: String?,
)
