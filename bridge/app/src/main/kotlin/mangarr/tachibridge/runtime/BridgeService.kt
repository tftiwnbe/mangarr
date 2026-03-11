package mangarr.tachibridge.runtime

import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import mangarr.tachibridge.config.ConfigManager
import mangarr.tachibridge.config.findExtension
import mangarr.tachibridge.config.findBySourceId
import mangarr.tachibridge.extensions.ExtensionManager
import mangarr.tachibridge.extensions.PageImagePayload
import mangarr.tachibridge.repo.ExtensionRepoService
import java.util.Base64

private val logger = KotlinLogging.logger {}
private val json = Json { ignoreUnknownKeys = true }

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
class BridgeService(
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

    fun searchRepository(query: String, limit: Int): JsonObject {
        val normalizedQuery = query.trim().lowercase()
        val cappedLimit = limit.coerceIn(1, 100)
        val entries =
            repoService
                .fetchIndex(forceRefresh = false)
                .asSequence()
                .filter { entry ->
                    normalizedQuery.isBlank() ||
                        entry.pkg.lowercase().contains(normalizedQuery) ||
                        entry.name.lowercase().contains(normalizedQuery) ||
                        entry.lang.lowercase().contains(normalizedQuery) ||
                        entry.sources.any { source ->
                            source.name.lowercase().contains(normalizedQuery) ||
                                source.lang.lowercase().contains(normalizedQuery)
                        }
                }.take(cappedLimit)
                .map { normalizeRepoEntry(it) }
                .toList()

        return buildJsonObject {
            put("ok", true)
            put("query", query)
            put("items", JsonArray(entries))
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
            sources = extension.sources.map { it.toPayload() },
        )
    }

    suspend fun updateExtension(packageName: String): InstalledExtensionPayload {
        extensionManager.awaitReady()
        val extension = extensionManager.update(packageName)
        return InstalledExtensionPayload(
            pkg = extension.packageName,
            name = extension.name.ifBlank { extension.packageName },
            lang = extension.lang.ifBlank { "all" },
            version = extension.version.ifBlank { "unknown" },
            sources = extension.sources.map { it.toPayload() },
        )
    }

    suspend fun uninstallExtension(packageName: String): JsonObject {
        extensionManager.awaitReady()
        extensionManager.uninstall(packageName)
        return buildJsonObject {
            put("ok", true)
            put("pkg", packageName)
        }
    }

    suspend fun fetchSourcePreferences(sourceId: String): JsonObject {
        extensionManager.awaitReady()
        val parsedSourceId = sourceId.toLong()
        val source =
            extensionManager
                .listSources()
                .firstOrNull { it.id == parsedSourceId }
                ?: error("Source not found: $sourceId")
        val preferences = extensionManager.getFilters(parsedSourceId)
        val searchFilters = extensionManager.getSearchFilters(parsedSourceId)

        return buildJsonObject {
            put("ok", true)
            put(
                "source",
                buildJsonObject {
                    put("id", source.id.toString())
                    put("name", source.name)
                    put("lang", source.lang)
                    put("supportsLatest", source.supportsLatest)
                },
            )
            put("preferences", JsonArray(preferences.filtersList.map { normalizeFilter(it) }))
            put("searchFilters", JsonArray(searchFilters.filtersList.map { normalizeFilter(it) }))
        }
    }

    suspend fun saveSourcePreferences(sourceId: String, values: JsonObject): JsonObject {
        extensionManager.awaitReady()
        val parsedSourceId = sourceId.toLong()
        for ((key, value) in values) {
            extensionManager.setPreference(
                parsedSourceId,
                key,
                json.encodeToString(JsonElement.serializer(), value),
            )
        }

        return buildJsonObject {
            put("ok", true)
            put("sourceId", sourceId)
            put("updatedCount", values.size)
        }
    }

    suspend fun searchTitles(
        query: String,
        limit: Int,
        sourceId: String? = null,
        searchFilters: JsonObject? = null,
    ): JsonObject {
        extensionManager.awaitReady()
        val cappedLimit = limit.coerceIn(1, 100)
        val items = mutableListOf<JsonObject>()

        val selectedSourceId = sourceId?.trim()?.takeIf { it.isNotEmpty() }
        val sources =
            extensionManager
                .listSources()
                .filter { source ->
                    selectedSourceId == null || source.id.toString() == selectedSourceId
                }

        for (source in sources) {
            if (items.size >= cappedLimit) {
                break
            }

            val currentSourceId = source.id.toString()
            val sourcePkg = ConfigManager.config.findBySourceId(source.id)?.packageName ?: continue

            try {
                val page =
                    extensionManager.searchTitle(
                        source.id,
                        query,
                        1,
                        normalizeFilterInput(searchFilters),
                    )
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
                            put("canonicalKey", canonicalKey(currentSourceId, titleUrl))
                            put("sourceId", currentSourceId)
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

    suspend fun fetchPopular(sourceId: String, page: Int, limit: Int): JsonObject =
        fetchFeed(sourceId, page, limit, "popular")

    suspend fun fetchLatest(sourceId: String, page: Int, limit: Int): JsonObject =
        fetchFeed(sourceId, page, limit, "latest")

    suspend fun fetchChapters(sourceId: String, titleUrl: String): JsonObject {
        extensionManager.awaitReady()
        val chapters = extensionManager.getChaptersList(sourceId.toLong(), titleUrl)
        return buildJsonObject {
            put("ok", true)
            put(
                "chapters",
                JsonArray(
                    chapters.chaptersList.map { chapter ->
                        buildJsonObject {
                            put("url", chapter.url)
                            put("name", chapter.name)
                            put("dateUpload", chapter.dateUpload)
                            put("chapterNumber", chapter.chapterNumber)
                            put("scanlator", chapter.scanlator)
                        }
                    },
                ),
            )
        }
    }

    suspend fun fetchPages(sourceId: String, chapterUrl: String): JsonObject {
        extensionManager.awaitReady()
        val pages = extensionManager.getPagesList(sourceId.toLong(), chapterUrl)
        return buildJsonObject {
            put("ok", true)
            put(
                "pages",
                JsonArray(
                    pages.pagesList.map { page ->
                        buildJsonObject {
                            put("index", page.index)
                            put("url", page.url)
                            put("imageUrl", page.imageUrl)
                        }
                    },
                ),
            )
        }
    }

    suspend fun fetchPageImage(sourceId: String, chapterUrl: String, index: Int): PageImagePayload {
        extensionManager.awaitReady()
        return extensionManager.getPageImage(sourceId.toLong(), chapterUrl, index)
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
        val sources =
            extensionManager
                .listSources()
                .filter { source -> ConfigManager.config.findBySourceId(source.id)?.packageName == packageName }
                .map { it.toPayload() }

        return InstalledExtensionPayload(
            pkg = installed.packageName,
            name = installed.name.ifBlank { installed.packageName },
            lang = installed.lang.ifBlank { "all" },
            version = installed.version.ifBlank { "unknown" },
            sources = sources,
        )
    }

    private suspend fun fetchFeed(sourceId: String, page: Int, limit: Int, feed: String): JsonObject {
        extensionManager.awaitReady()
        val parsedSourceId = sourceId.toLong()
        val source =
            extensionManager
                .listSources()
                .firstOrNull { it.id == parsedSourceId }
                ?: error("Source not found: $sourceId")
        val sourcePkg = ConfigManager.config.findBySourceId(parsedSourceId)?.packageName.orEmpty()
        val response =
            when (feed) {
                "popular" -> extensionManager.getPopularTitles(parsedSourceId, page)
                "latest" -> extensionManager.getLatestTitles(parsedSourceId, page)
                else -> error("Unsupported feed: $feed")
            }
        val items =
            response.titlesList
                .take(limit.coerceIn(1, 100))
                .map { title ->
                    buildJsonObject {
                        put("canonicalKey", canonicalKey(sourceId, title.url))
                        put("sourceId", sourceId)
                        put("sourcePkg", sourcePkg)
                        put("sourceLang", source.lang)
                        put("sourceName", source.name)
                        put("titleUrl", title.url)
                        put("title", title.title)
                        put("description", title.description)
                        put("coverUrl", title.thumbnailUrl)
                    }
                }

        return buildJsonObject {
            put("ok", true)
            put("sourceId", sourceId)
            put("feed", feed)
            put("page", page)
            put("hasNextPage", response.hasNextPage)
            put("items", JsonArray(items))
        }
    }

    private fun normalizeRepoEntry(entry: mangarr.tachibridge.repo.ExtensionRepoEntry): JsonObject =
        buildJsonObject {
            put("pkg", entry.pkg)
            put("name", entry.name)
            put("version", entry.version)
            put("lang", entry.lang)
            put("nsfw", (entry.nsfw ?: 0) == 1)
            put(
                "sources",
                JsonArray(
                    entry.sources.map { source ->
                        buildJsonObject {
                            put("id", source.id.toString())
                            put("name", source.name)
                            put("lang", source.lang)
                            put("supportsLatest", source.supportsLatest ?: true)
                        }
                    },
                ),
            )
        }

    private fun normalizeFilter(filter: mangarr.tachibridge.extensions.Filter): JsonObject {
        val parsedData =
            runCatching { json.parseToJsonElement(filter.data) }
                .getOrElse { JsonPrimitive(filter.data) }
        return buildJsonObject {
            put("name", filter.name)
            put("type", filter.type)
            put("data", parsedData)
        }
    }

    private fun normalizeFilterInput(raw: JsonObject?): Map<String, String> =
        raw?.mapValues { (_, value) -> json.encodeToString(JsonElement.serializer(), value) } ?: emptyMap()
}

data class InstalledExtensionPayload(
    val pkg: String,
    val name: String,
    val lang: String,
    val version: String,
    val sources: List<SourcePayload>,
)

data class SourcePayload(
    val id: String,
    val name: String,
    val lang: String,
    val supportsLatest: Boolean,
)

private fun mangarr.tachibridge.config.BridgeConfig.SourceInfo.toPayload() =
    SourcePayload(
        id = id.toString(),
        name = name,
        lang = lang,
        supportsLatest = supportsLatest,
    )
