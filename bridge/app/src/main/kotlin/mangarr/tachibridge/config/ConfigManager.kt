package mangarr.tachibridge.config

import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.locks.ReentrantReadWriteLock
import kotlin.concurrent.read
import kotlin.concurrent.write

private val logger = KotlinLogging.logger {}

class ConfigLoadException(
    message: String,
    cause: Throwable,
) : RuntimeException(message, cause)

/**
 * Manages bridge configuration in a single JSON file.
 * Thread-safe with read-write locking.
 */
object ConfigManager {
    private lateinit var configPath: Path
    private val json =
        Json {
            prettyPrint = true
            ignoreUnknownKeys = true
            encodeDefaults = false
        }

    private val current = AtomicReference<BridgeConfig>()
    private val lock = ReentrantReadWriteLock()

    fun init(dataDir: Path) {
        if (!Files.exists(dataDir)) {
            Files.createDirectories(dataDir)
        }

        configPath = dataDir.resolve("bridge.json")

        if (!Files.exists(configPath)) {
            val defaultConfig = BridgeConfig()
            saveInternal(defaultConfig)
            current.set(defaultConfig)
            logger.info { "Created default config at $configPath" }
        } else {
            current.set(loadInternal())
            logger.info { "Loaded config from $configPath" }
        }
    }

    val config: BridgeConfig
        get() =
            lock.read {
                current.get() ?: throw IllegalStateException("ConfigManager not initialized")
            }

    fun update(updater: (BridgeConfig) -> BridgeConfig) {
        lock.write {
            val old = current.get()
            val new = updater(old)

            if (new != old) {
                saveInternal(new)
                current.set(new)
                logger.debug { "Config updated" }
            }
        }
    }

    // Quick accessors

    fun setRepoUrl(url: String) {
        update { it.copy(repoUrl = url) }
    }

    fun upsertExtension(extension: BridgeConfig.InstalledExtension) {
        update { config ->
            val existing = config.extensions.indexOfFirst { it.packageName == extension.packageName }
            if (existing >= 0) {
                config.copy(
                    extensions =
                        config.extensions.toMutableList().apply {
                            set(existing, extension)
                        },
                )
            } else {
                config.copy(
                    extensions = config.extensions + extension,
                )
            }
        }
    }

    fun removeExtension(packageName: String) {
        update { config ->
            config.copy(
                extensions = config.extensions.filter { it.packageName != packageName },
            )
        }
    }

    fun setExtensionProxy(
        packageName: String,
        useProxy: Boolean,
    ) {
        update { config ->
            val existing =
                config.extensions.find { it.packageName == packageName }
                    ?: return@update config

            val updated = existing.copy(useProxy = useProxy)
            config.copy(
                extensions =
                    config.extensions.map {
                        if (it.packageName == packageName) updated else it
                    },
            )
        }
    }

    fun setSourcePreference(
        sourceId: Long,
        key: String,
        value: PreferenceValue,
    ) {
        update { config ->
            val sourceIdStr = sourceId.toString()
            val currentPrefs = config.sourcePreferences[sourceIdStr] ?: emptyMap()
            val updatedPrefs = currentPrefs + (key to value)

            config.copy(
                sourcePreferences = config.sourcePreferences + (sourceIdStr to updatedPrefs),
            )
        }
    }

    fun updateFlareSolverr(updater: (BridgeConfig.FlareSolverr) -> BridgeConfig.FlareSolverr) {
        update { config ->
            val updated = updater(config.flareSolverr)
            FlareSolverrConfigProvider.update(updated)
            config.copy(flareSolverr = updated)
        }
    }

    fun setFlareSolverrEnabled(enabled: Boolean) {
        updateFlareSolverr { it.copy(enabled = enabled) }
    }

    fun setFlareSolverrUrl(url: String) {
        updateFlareSolverr { it.copy(url = url) }
    }

    fun setFlareSolverrTimeout(timeoutSeconds: Int) {
        updateFlareSolverr { it.copy(timeoutSeconds = timeoutSeconds) }
    }

    fun syncExtensions(validPackages: Set<String>) {
        update { config ->
            val cleaned = config.extensions.filter { it.packageName in validPackages }
            if (cleaned.size != config.extensions.size) {
                logger.info { "Synced extensions: removed ${config.extensions.size - cleaned.size} entries" }
                config.copy(extensions = cleaned)
            } else {
                config
            }
        }
    }

    private fun loadInternal(): BridgeConfig {
        if (!Files.exists(configPath)) return BridgeConfig()

        val raw =
            try {
                Files.readString(configPath, StandardCharsets.UTF_8)
            } catch (ioe: IOException) {
                throw ConfigLoadException("Failed to read config at $configPath", ioe)
            }

        if (raw.isBlank()) return BridgeConfig()

        return try {
            json.decodeFromString<BridgeConfig>(raw)
        } catch (e: Exception) {
            logger.error(e) { "Failed to parse config, using defaults" }
            BridgeConfig()
        }
    }

    private fun saveInternal(config: BridgeConfig) {
        try {
            val jsonString = json.encodeToString(config)
            Files.writeString(configPath, jsonString, StandardCharsets.UTF_8)
        } catch (e: Exception) {
            logger.error(e) { "Failed to save config" }
            throw ConfigLoadException("Failed to save config at $configPath", e)
        }
    }
}
