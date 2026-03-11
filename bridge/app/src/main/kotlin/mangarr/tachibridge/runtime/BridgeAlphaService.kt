package mangarr.tachibridge.runtime

import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mangarr.tachibridge.config.ConfigManager
import mangarr.tachibridge.config.findExtension
import mangarr.tachibridge.config.findBySourceId
import mangarr.tachibridge.extensions.ExtensionManager
import mangarr.tachibridge.repo.ExtensionRepoService
import java.util.Base64

private val logger = KotlinLogging.logger {}

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
class BridgeAlphaService(
    private val extensionManager: ExtensionManager,
    private val repoService: ExtensionRepoService,
) {
    fun syncRepository(url: String): JsonObject {
        repoService.updateRepoIndexUrl(url)
        ConfigManager.setRepoUrl(url)
        val entries = repoService.fetchIndex(forceRefresh = true)
        return buildJsonObject {
            put("ok", true)
            put("url", url)
            put("extensionCount", entries.size)
        }
    }

    suspend fun installExtension(packageName: String): InstalledExtensionPayload {
        extensionManager.awaitReady()
        val extension =
            try {
                extensionManager.installFromRepo(packageName)
            } catch (error: IllegalStateException) {
                if (error.message?.startsWith("Already installed:") == true) {
                    return installedExtensionPayload(packageName)
                }
                throw error
            }

        return InstalledExtensionPayload(
            pkg = extension.packageName,
            name = extension.name.ifBlank { extension.packageName },
            lang = extension.lang.ifBlank { "all" },
            version = extension.version.ifBlank { "unknown" },
            sourceIds = extension.sources.map { it.id.toString() },
        )
    }

    suspend fun searchTitles(query: String, limit: Int): JsonObject {
        extensionManager.awaitReady()
        val cappedLimit = limit.coerceIn(1, 100)
        val items = mutableListOf<JsonObject>()

        for (source in extensionManager.listSources()) {
            if (items.size >= cappedLimit) {
                break
            }

            val sourceId = source.id.toString()
            val sourcePkg = ConfigManager.config.findBySourceId(source.id)?.packageName ?: continue

            try {
                val page = extensionManager.searchTitle(source.id, query, 1, emptyMap())
                for (title in page.titlesList) {
                    if (items.size >= cappedLimit) {
                        break
                    }
                    val titleUrl = title.url
                    if (titleUrl.isBlank()) {
                        continue
                    }

                    items +=
                        buildJsonObject {
                            put("canonicalKey", canonicalKey(sourceId, titleUrl))
                            put("sourceId", sourceId)
                            put("sourcePkg", sourcePkg)
                            put("sourceLang", source.lang)
                            put("sourceName", source.name)
                            put("titleUrl", titleUrl)
                            put("title", title.title)
                            put("description", title.description)
                            put("coverUrl", title.thumbnailUrl)
                        }
                }
            } catch (error: Exception) {
                logger.warn(error) { "Search failed for source ${source.id}" }
            }
        }

        return buildJsonObject {
            put("ok", true)
            put("items", JsonArray(items))
        }
    }

    suspend fun fetchTitle(sourceId: String, titleUrl: String): JsonObject {
        extensionManager.awaitReady()
        val response = extensionManager.getTitleDetails(sourceId.toLong(), titleUrl)
        val title = response.title
        val source = extensionManager.listSources().firstOrNull { it.id.toString() == sourceId }
        val sourcePkg = source?.let { ConfigManager.config.findBySourceId(it.id)?.packageName }.orEmpty()

        return buildJsonObject {
            put("ok", true)
            put("title", normalizeTitle(sourceId, sourcePkg, source?.lang.orEmpty(), title))
        }
    }

    suspend fun resolveImport(
        sourceId: String,
        sourcePkg: String,
        sourceLang: String,
        titleUrl: String,
    ): JsonObject {
        extensionManager.awaitReady()
        val response = extensionManager.getTitleDetails(sourceId.toLong(), titleUrl)
        return normalizeTitle(sourceId, sourcePkg, sourceLang, response.title)
    }

    private fun normalizeTitle(
        sourceId: String,
        sourcePkg: String,
        sourceLang: String,
        title: mangarr.tachibridge.extensions.Title,
    ): JsonObject =
        buildJsonObject {
            put("canonicalKey", canonicalKey(sourceId, title.url))
            put("sourceId", sourceId)
            put("sourcePkg", sourcePkg)
            put("sourceLang", sourceLang)
            put("titleUrl", title.url)
            put("title", title.title)
            put("description", title.description)
            put("coverUrl", title.thumbnailUrl)
        }

    private fun canonicalKey(sourceId: String, titleUrl: String): String {
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(titleUrl.toByteArray(Charsets.UTF_8))
        return "$sourceId::$encoded"
    }

    private suspend fun installedExtensionPayload(packageName: String): InstalledExtensionPayload {
        val installed =
            ConfigManager.config.findExtension(packageName)
                ?: error("Installed extension not found in config: $packageName")
        val sourceIds =
            extensionManager
                .listSources()
                .filter { source -> ConfigManager.config.findBySourceId(source.id)?.packageName == packageName }
                .map { it.id.toString() }

        return InstalledExtensionPayload(
            pkg = installed.packageName,
            name = installed.name.ifBlank { installed.packageName },
            lang = installed.lang.ifBlank { "all" },
            version = installed.version.ifBlank { "unknown" },
            sourceIds = sourceIds,
        )
    }
}

data class InstalledExtensionPayload(
    val pkg: String,
    val name: String,
    val lang: String,
    val version: String,
    val sourceIds: List<String>,
)
