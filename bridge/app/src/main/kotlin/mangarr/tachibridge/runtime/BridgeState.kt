package mangarr.tachibridge.runtime

import kotlinx.serialization.Serializable
import java.util.concurrent.atomic.AtomicReference

@Serializable
data class BridgeSnapshot(
    val configured: Boolean,
    val running: Boolean,
    val ready: Boolean,
    val degraded: Boolean,
    val status: String,
    val bridgeId: String,
    val port: Int,
    val restartCount: Int,
    val lastStartupError: String? = null,
    val lastStartupWarning: String? = null,
)

class BridgeState(
    private val bridgeId: String,
    private val port: Int,
    configured: Boolean,
) {
    private val snapshot =
        AtomicReference(
            BridgeSnapshot(
                configured = configured,
                running = false,
                ready = false,
                degraded = false,
                status = if (configured) "starting" else "error",
                bridgeId = bridgeId,
                port = port,
                restartCount = 0,
                lastStartupError = if (configured) null else "Convex bridge config is incomplete",
                lastStartupWarning = null,
            ),
        )

    fun current(): BridgeSnapshot = snapshot.get()

    fun setRunning() {
        update {
            it.copy(
                running = true,
                degraded = false,
                status = if (it.ready) "ready" else "starting",
                lastStartupError = null,
                lastStartupWarning = null,
            )
        }
    }

    fun setReady() {
        update {
            it.copy(
                running = true,
                ready = true,
                degraded = false,
                status = "ready",
                lastStartupError = null,
                lastStartupWarning = null,
            )
        }
    }

    fun setDegraded(message: String) {
        update {
            it.copy(
                running = true,
                ready = true,
                degraded = true,
                status = "degraded",
                lastStartupError = null,
                lastStartupWarning = message,
            )
        }
    }

    fun setStopped() {
        update {
            it.copy(running = false, ready = false, degraded = false, status = "stopped")
        }
    }

    fun setError(message: String) {
        update {
            it.copy(
                running = it.running,
                ready = false,
                degraded = false,
                status = "error",
                lastStartupError = message,
                lastStartupWarning = null,
            )
        }
    }

    fun restarted() {
        update {
            it.copy(
                restartCount = it.restartCount + 1,
                running = true,
                ready = false,
                degraded = false,
                status = "starting",
                lastStartupError = null,
                lastStartupWarning = null,
            )
        }
    }

    private fun update(transform: (BridgeSnapshot) -> BridgeSnapshot) {
        snapshot.updateAndGet(transform)
    }
}
