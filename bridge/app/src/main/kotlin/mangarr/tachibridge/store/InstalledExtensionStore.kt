package mangarr.tachibridge.store

import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import mangarr.tachibridge.config.BridgeConfig
import mangarr.tachibridge.loader.ExtensionLoader
import mangarr.tachibridge.repo.ExtensionRepoEntry
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.io.path.createDirectories
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.io.path.writeText

/**
 * Manages installed extension metadata in a separate JSON index file.
 * This keeps the YAML config lightweight and provides fast metadata access.
 */
class InstalledExtensionsStore(
    private val extensionsDir: Path,
) {
    private val lock = ReentrantLock()
    private val records: MutableMap<String, InstalledExtensionRecord> = mutableMapOf()
    private val logger = KotlinLogging.logger {}
    private val json =
        Json {
            prettyPrint = true
            ignoreUnknownKeys = true
        }
    private val indexPath: Path
        get() = extensionsDir.resolve("installed-index.json")

    fun init(installed: List<BridgeConfig.InstalledExtension>) =
        lock.withLock {
            records.clear()

            // Load existing metadata from index
            loadAllMetadata().forEach { metadata ->
                records[metadata.packageName] = metadata
            }

            // Add placeholders for packages in config but not in index
            installed
                .filterNot { records.containsKey(it.packageName) }
                .forEach { entry ->
                    val placeholder = createPlaceholderRecord(entry.packageName)
                    records[entry.packageName] = placeholder
                }

            persistIndex()
        }

    fun all(): List<InstalledExtensionRecord> =
        lock.withLock {
            records.values.sortedBy { it.name.lowercase() }
        }

    operator fun get(packageName: String): InstalledExtensionRecord? =
        lock.withLock {
            records[packageName]
        }

    fun findBySourceId(sourceId: Long): InstalledExtensionRecord? =
        lock.withLock {
            records.values.firstOrNull { record ->
                record.sources.any { it.id == sourceId }
            }
        }

    fun upsert(
        loaded: ExtensionLoader.LoadedExtension,
        repoEntry: ExtensionRepoEntry? = null,
    ): InstalledExtensionRecord =
        lock.withLock {
            val existing = records[loaded.packageInfo.packageName]
            val record = createRecord(loaded, repoEntry, existing)
            records[record.packageName] = record
            persistIndex()
            record
        }

    fun remove(packageName: String) =
        lock.withLock {
            records.remove(packageName)
            persistIndex()
        }

    fun syncWithFilesystem(): List<String> =
        lock.withLock {
            val jarFiles =
                if (Files.exists(extensionsDir)) {
                    Files.list(extensionsDir).use { stream ->
                        stream
                            .filter { it.toString().endsWith(".jar") }
                            .map { it.fileName.toString() }
                            .toList()
                            .toSet()
                    }
                } else {
                    emptySet()
                }

            val removed = mutableListOf<String>()
            val iterator = records.iterator()
            while (iterator.hasNext()) {
                val (pkg, record) = iterator.next()
                val jarName = record.jarName ?: "$pkg-v${record.version}.jar"
                if (jarName !in jarFiles) {
                    logger.info { "Extension $pkg jar not found, removing from store" }
                    iterator.remove()
                    removed.add(pkg)
                }
            }

            if (removed.isNotEmpty()) {
                persistIndex()
            }

            removed
        }

    private fun createRecord(
        loaded: ExtensionLoader.LoadedExtension,
        repoEntry: ExtensionRepoEntry?,
        existing: InstalledExtensionRecord?,
    ): InstalledExtensionRecord {
        val pkg = loaded.packageInfo.packageName
        val name =
            repoEntry?.name
                ?: loaded.packageInfo.applicationInfo.nonLocalizedLabel
                    ?.toString()
                ?: existing?.name
                ?: pkg

        val sources =
            loaded.sources.map { source ->
                InstalledSourceRecord(
                    id = source.id,
                    name = source.name,
                    lang = source.lang,
                )
            }

        val lang =
            repoEntry?.lang
                ?: sources.map { it.lang }.distinct().let { langs ->
                    when {
                        langs.isEmpty() -> existing?.lang ?: "-"
                        langs.size == 1 -> langs.first()
                        else -> "all"
                    }
                }

        val version =
            repoEntry?.version
                ?: loaded.packageInfo.versionName
                ?: existing?.version
                ?: "unknown"

        val jarName = File(loaded.jarPath).name
        val nsfw = (repoEntry?.nsfw ?: 0) == 1 || existing?.nsfw == true

        return InstalledExtensionRecord(
            packageName = pkg,
            name = name,
            version = version,
            lang = lang,
            nsfw = nsfw,
            jarName = jarName,
            sources = sources,
            sourceClassName = loaded.metadata.sourceClassName,
            factoryClassName = loaded.metadata.factoryClassName,
        )
    }

    private fun loadAllMetadata(): List<InstalledExtensionRecord> {
        val index = indexPath
        return runCatching {
            if (!index.exists()) return emptyList()
            val content = index.readText()
            if (content.isBlank()) {
                emptyList()
            } else {
                json.decodeFromString(ListSerializer(InstalledExtensionRecord.serializer()), content)
            }
        }.getOrElse { throwable ->
            logger.debug(throwable) { "Metadata index missing or corrupt; starting fresh." }
            emptyList()
        }
    }

    private fun persistIndex() {
        val index = indexPath
        runCatching {
            index.parent?.createDirectories()
            val sorted = records.values.sortedBy { it.packageName.lowercase() }
            val serialized = json.encodeToString(ListSerializer(InstalledExtensionRecord.serializer()), sorted)
            index.writeText(serialized)
        }.onFailure { throwable ->
            logger.warn(throwable) { "Failed to persist extension metadata index" }
        }
    }

    private fun createPlaceholderRecord(packageName: String): InstalledExtensionRecord =
        InstalledExtensionRecord(
            packageName = packageName,
            name = packageName,
            version = "unknown",
            lang = "-",
            nsfw = false,
            jarName = findJarNameFor(packageName),
            sources = emptyList(),
            sourceClassName = null,
            factoryClassName = null,
        )

    private fun findJarNameFor(packageName: String): String? {
        if (!Files.exists(extensionsDir)) return null

        Files
            .newDirectoryStream(extensionsDir) { path ->
                Files.isRegularFile(path) &&
                    path.fileName.toString().startsWith(packageName) &&
                    path.fileName.toString().endsWith(".jar")
            }.use { stream ->
                stream.forEach { path ->
                    return path.fileName.toString()
                }
            }
        return null
    }
}

@Serializable
data class InstalledExtensionRecord(
    val name: String,
    @SerialName("pkg")
    val packageName: String,
    val version: String,
    val lang: String,
    val nsfw: Boolean,
    @SerialName("jar_name")
    val jarName: String? = null,
    val sources: List<InstalledSourceRecord>,
    @SerialName("source_class_name")
    val sourceClassName: String? = null,
    @SerialName("factory_class_name")
    val factoryClassName: String? = null,
)

@Serializable
data class InstalledSourceRecord(
    val id: Long,
    val name: String,
    val lang: String,
)
