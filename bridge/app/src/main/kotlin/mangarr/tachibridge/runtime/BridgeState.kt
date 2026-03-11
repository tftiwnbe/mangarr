package mangarr.tachibridge.runtime

import kotlinx.serialization.Serializable
import java.util.concurrent.atomic.AtomicReference

@Serializable
data class BridgeSnapshot(
    val configured: Boolean,
    val running: Boolean,
    val ready: Boolean,
    val status: String,
    val bridgeId: String,
    val port: Int,
    val restartCount: Int,
    val lastStartupError: String? = null,
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
                status = if (configured) "starting" else "error",
                bridgeId = bridgeId,
                port = port,
                restartCount = 0,
                lastStartupError = if (configured) null else "Convex bridge config is incomplete",
            ),
        )

    fun current(): BridgeSnapshot = snapshot.get()

    fun setRunning() {
        update {
            it.copy(running = true, status = if (it.ready) "ready" else "starting", lastStartupError = null)
        }
    }

    fun setReady() {
        update {
            it.copy(running = true, ready = true, status = "ready", lastStartupError = null)
        }
    }

    fun setStopped() {
        update {
            it.copy(running = false, ready = false, status = "stopped")
        }
    }

    fun setError(message: String) {
        update {
            it.copy(running = false, ready = false, status = "error", lastStartupError = message)
        }
    }

    fun restarted() {
        update {
            it.copy(restartCount = it.restartCount + 1, running = true, ready = false, status = "starting")
        }
    }

    private fun update(transform: (BridgeSnapshot) -> BridgeSnapshot) {
        snapshot.updateAndGet(transform)
    }
}
