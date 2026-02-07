package mangarr.tachibridge.config

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Complete bridge configuration in a single JSON file.
 * All data needed between restarts is stored here.
 */
@Serializable
data class BridgeConfig(
    @SerialName("repo_url")
    val repoUrl: String = "",
    val extensions: List<InstalledExtension> = emptyList(),
    @SerialName("source_prefs")
    val sourcePreferences: Map<String, Map<String, PreferenceValue>> = emptyMap(),
    @SerialName("flare_solverr")
    val flareSolverr: FlareSolverr = FlareSolverr(),
) {
    @Serializable
    data class FlareSolverr(
        val enabled: Boolean = false,
        val url: String = "http://localhost:8191",
        @SerialName("timeout_seconds")
        val timeoutSeconds: Int = 45,
        @SerialName("response_fallback")
        val responseFallback: Boolean = true,
        @SerialName("session_name")
        val sessionName: String? = null,
        @SerialName("session_ttl_minutes")
        val sessionTtlMinutes: Int? = null,
    )

    @Serializable
    data class InstalledExtension(
        @SerialName("pkg")
        val packageName: String,
        val name: String = "",
        val version: String = "",
        val lang: String = "",
        val nsfw: Boolean = false,
        @SerialName("jar_name")
        val jarName: String? = null,
        @SerialName("source_class_name")
        val sourceClassName: String? = null,
        @SerialName("factory_class_name")
        val factoryClassName: String? = null,
        @SerialName("use_proxy")
        val useProxy: Boolean = false,
        val sources: List<SourceInfo> = emptyList(),
    )

    @Serializable
    data class SourceInfo(
        val id: Long,
        val name: String,
        val lang: String,
        @SerialName("supports_latest")
        val supportsLatest: Boolean = true,
    )
}

/**
 * Preference value - can be string, boolean, int, long, float, or string set
 */
@Serializable(with = PreferenceValueSerializer::class)
sealed class PreferenceValue {
    data class StringValue(
        val value: String,
    ) : PreferenceValue()

    data class BooleanValue(
        val value: Boolean,
    ) : PreferenceValue()

    data class IntValue(
        val value: Int,
    ) : PreferenceValue()

    data class LongValue(
        val value: Long,
    ) : PreferenceValue()

    data class FloatValue(
        val value: Float,
    ) : PreferenceValue()

    data class StringSetValue(
        val value: Set<String>,
    ) : PreferenceValue()
}

// Helper extensions
fun BridgeConfig.sourcePreferencesFor(sourceId: Long): Map<String, PreferenceValue> = sourcePreferences[sourceId.toString()] ?: emptyMap()

fun BridgeConfig.findExtension(packageName: String): BridgeConfig.InstalledExtension? = extensions.find { it.packageName == packageName }

fun BridgeConfig.findBySourceId(sourceId: Long): BridgeConfig.InstalledExtension? =
    extensions.find { ext -> ext.sources.any { it.id == sourceId } }
