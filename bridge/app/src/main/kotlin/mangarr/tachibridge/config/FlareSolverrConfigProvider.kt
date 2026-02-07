package mangarr.tachibridge.config

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Provides live FlareSolverr configuration to NetworkHelper.
 * Updates automatically when config changes via gRPC.
 */
object FlareSolverrConfigProvider {
    private val configFlow = MutableStateFlow(ConfigManager.config.flareSolverr)

    val config: StateFlow<BridgeConfig.FlareSolverr> = configFlow.asStateFlow()

    internal fun update(newConfig: BridgeConfig.FlareSolverr) {
        configFlow.value = newConfig
    }
}
