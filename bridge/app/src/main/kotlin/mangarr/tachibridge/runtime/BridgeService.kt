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
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap

private val logger = KotlinLogging.logger {}
private val json = Json { ignoreUnknownKeys = true }
private const val FEED_CACHE_TTL_MS = 5 * 60 * 1000L
private const val MANGADEX_PACKAGE = "eu.kanade.tachiyomi.extension.all.mangadex"

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
class BridgeService(
    private val extensionManager: ExtensionManager,
    private val repoService: ExtensionRepoService,
    private val downloadStorage: DownloadStorage,
) {
    private val httpClient = OkHttpClient()
    private val feedCache = ConcurrentHashMap<String, CachedFeedResult>()

    fun syncRepository(url: String): JsonObject {
        repoService.updateRepoIndexUrl(url)
        ConfigManager.setRepoUrl(url)
        val entries = repoService.fetchIndex(forceRefresh = true)
        val languages =
            entries
                .asSequence()
                .flatMap { entry -> sequenceOf(entry.lang) + entry.sources.asSequence().map { source -> source.lang } }
                .map { normalizeLangCode(it) }
                .filter { it.isNotBlank() }
                .distinct()
                .sorted()
                .map { JsonPrimitive(it) }
                .toList()
        return buildJsonObject {
            put("ok", true)
            put("url", url)
            put("extensionCount", entries.size)
            put("languages", JsonArray(languages))
        }
    }

    fun searchRepository(query: String, limit: Int): JsonObject {
        val normalizedQuery = query.trim().lowercase()
        val cappedLimit = limit.coerceIn(1, 5000)
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

    suspend fun listInstalledExtensions(): JsonObject {
        extensionManager.awaitReady()
        val repoIndexUrl = repoService.currentRepoIndexUrl()
        val items =
            ConfigManager.config.extensions.map { extension ->
                buildJsonObject {
                    put("pkg", extension.packageName)
                    put("name", normalizeExtensionName(extension.name.ifBlank { extension.packageName }))
                    put("lang", normalizeLangCode(extension.lang))
                    put("version", extension.version.ifBlank { "unknown" })
                    put("nsfw", extension.nsfw)
                    put("use_proxy", extension.useProxy)
                    iconUrl(repoIndexUrl, extension.packageName)?.let { put("icon", it) }
                    put(
                        "sources",
                        JsonArray(
                            extension.sources.map { source ->
                                buildJsonObject {
                                    put("id", source.id.toString())
                                    put("name", source.name)
                                    put("lang", normalizeLangCode(source.lang))
                                    put("supportsLatest", source.supportsLatest)
                                    put("enabled", source.enabled)
                                }
                            },
                        ),
                    )
                }
            }

        return buildJsonObject {
            put("ok", true)
            put("items", JsonArray(items))
        }
    }

    suspend fun setExtensionProxy(packageName: String, useProxy: Boolean): JsonObject {
        extensionManager.awaitReady()
        val installed =
            ConfigManager.config.findExtension(packageName)
                ?: error("Installed extension not found in config: $packageName")
        ConfigManager.setExtensionProxy(packageName, useProxy)
        return buildJsonObject {
            put("ok", true)
            put("pkg", installed.packageName)
            put("use_proxy", useProxy)
        }
    }

    suspend fun setSourceEnabled(sourceId: String, enabled: Boolean): JsonObject {
        extensionManager.awaitReady()
        val parsedSourceId = sourceId.toLong()
        val source =
            extensionManager
                .listSources()
                .firstOrNull { it.id == parsedSourceId }
                ?: error("Source not found: $sourceId")
        ConfigManager.setSourceEnabled(parsedSourceId, enabled)
        feedCache.keys.removeIf { key -> key.contains(":$sourceId:") }
        return buildJsonObject {
            put("ok", true)
            put("sourceId", source.id.toString())
            put("enabled", enabled)
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
            name = normalizeExtensionName(extension.name.ifBlank { extension.packageName }),
            lang = normalizeLangCode(extension.lang),
            version = extension.version.ifBlank { "unknown" },
            nsfw = extension.nsfw,
            useProxy = false,
            icon = iconUrl(repoService.currentRepoIndexUrl(), extension.packageName),
            sources = extension.sources.map { it.toPayload() },
        )
    }

    suspend fun updateExtension(packageName: String): InstalledExtensionPayload {
        extensionManager.awaitReady()
        val extension = extensionManager.update(packageName)
        return InstalledExtensionPayload(
            pkg = extension.packageName,
            name = normalizeExtensionName(extension.name.ifBlank { extension.packageName }),
            lang = normalizeLangCode(extension.lang),
            version = extension.version.ifBlank { "unknown" },
            nsfw = extension.nsfw,
            useProxy = ConfigManager.config.findExtension(packageName)?.useProxy ?: false,
            icon = iconUrl(repoService.currentRepoIndexUrl(), extension.packageName),
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
                    put("enabled", ConfigManager.isSourceEnabled(source.id))
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
                    ConfigManager.isSourceEnabled(source.id) &&
                        (selectedSourceId == null || source.id.toString() == selectedSourceId)
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
                            put("genre", title.genre)
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
        if (!ConfigManager.isSourceEnabled(sourceId.toLong())) {
            error("Source is disabled: $sourceId")
        }
        val response = extensionManager.getTitleDetails(sourceId.toLong(), titleUrl)
        val title = response.title
        val source =
            extensionManager
                .listSources()
                .firstOrNull { it.id.toString() == sourceId && ConfigManager.isSourceEnabled(it.id) }
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
        if (!ConfigManager.isSourceEnabled(sourceId.toLong())) {
            error("Source is disabled: $sourceId")
        }
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
        if (!ConfigManager.isSourceEnabled(sourceId.toLong())) {
            error("Source is disabled: $sourceId")
        }
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

    suspend fun downloadChapter(
        titleId: String,
        sourceId: String,
        chapterUrl: String,
        onProgress: (downloadedPages: Int, totalPages: Int) -> Unit,
    ): JsonObject {
        extensionManager.awaitReady()
        val pages = extensionManager.getPagesList(sourceId.toLong(), chapterUrl)
        val totalPages = pages.pagesList.size
        val workspace = downloadStorage.createChapterWorkspace(titleId, chapterUrl)

        for ((index, _) in pages.pagesList.withIndex()) {
            val image = extensionManager.getPageImage(sourceId.toLong(), chapterUrl, index)
            downloadStorage.writePage(workspace, index, image)
            onProgress(index + 1, totalPages)
        }

        val stored =
            downloadStorage.finalizeChapterDownload(
                workspace,
                archive = ConfigManager.config.downloads.compressionEnabled,
            )
        return buildJsonObject {
            put("ok", true)
            put("totalPages", totalPages)
            put("downloadedPages", totalPages)
            put("storageKind", stored.storageKind)
            put("localRelativePath", stored.localRelativePath)
            put("fileSizeBytes", stored.fileSizeBytes)
        }
    }

    fun fetchStoredPage(
        localRelativePath: String,
        storageKind: String,
        index: Int,
    ): PageImagePayload = downloadStorage.readStoredPage(localRelativePath, storageKind, index)

    fun fetchStoredCover(localCoverPath: String): PageImagePayload = downloadStorage.readCover(localCoverPath)

    fun fetchStoredChapterFile(
        localRelativePath: String,
        storageKind: String,
    ): StoredChapterFilePayload = downloadStorage.readStoredChapterFile(localRelativePath, storageKind)

    fun downloadSettings(): JsonObject {
        val settings = ConfigManager.config.downloads
        val storage = downloadStorage.summary()
        return buildJsonObject {
            put("downloadPath", storage.downloadPath)
            put("compressionEnabled", settings.compressionEnabled)
            put("failedRetryDelaySeconds", settings.failedRetryDelaySeconds)
            put("totalSpaceBytes", storage.totalSpaceBytes)
            put("usedSpaceBytes", storage.usedSpaceBytes)
            put("freeSpaceBytes", storage.freeSpaceBytes)
        }
    }

    fun proxySettings(): JsonObject {
        val proxy = ConfigManager.config.proxy
        return buildJsonObject {
            put("hostname", proxy.hostname)
            put("port", proxy.port)
            put("username", proxy.username ?: "")
            put("password", proxy.password ?: "")
            put("ignoredAddresses", proxy.ignoredAddresses)
            put("bypassLocalAddresses", proxy.bypassLocalAddresses)
        }
    }

    fun updateProxySettings(
        hostname: String?,
        port: Int?,
        username: String?,
        password: String?,
        ignoredAddresses: String?,
        bypassLocalAddresses: Boolean?,
    ): JsonObject {
        val current = ConfigManager.config.proxy
        ConfigManager.setProxyConfig(
            current.copy(
                hostname = hostname?.trim() ?: current.hostname,
                port = port?.coerceIn(0, 65535) ?: current.port,
                username = username?.trim()?.takeIf { it.isNotEmpty() },
                password = password?.takeIf { !it.isNullOrBlank() },
                ignoredAddresses = ignoredAddresses?.trim() ?: current.ignoredAddresses,
                bypassLocalAddresses = bypassLocalAddresses ?: current.bypassLocalAddresses,
            ),
        )
        return proxySettings()
    }

    fun flareSolverrSettings(): JsonObject {
        val flare = ConfigManager.config.flareSolverr
        return buildJsonObject {
            put("enabled", flare.enabled)
            put("url", flare.url)
            put("timeoutSeconds", flare.timeoutSeconds)
            put("responseFallback", flare.responseFallback)
            put("sessionName", flare.sessionName ?: "")
            if (flare.sessionTtlMinutes != null) {
                put("sessionTtlMinutes", flare.sessionTtlMinutes)
            }
        }
    }

    fun updateFlareSolverrSettings(
        enabled: Boolean?,
        url: String?,
        timeoutSeconds: Int?,
        responseFallback: Boolean?,
        sessionName: String?,
        sessionTtlMinutes: Int?,
    ): JsonObject {
        ConfigManager.updateFlareSolverr { current ->
            current.copy(
                enabled = enabled ?: current.enabled,
                url = url?.trim()?.ifEmpty { current.url } ?: current.url,
                timeoutSeconds = timeoutSeconds?.coerceIn(5, 300) ?: current.timeoutSeconds,
                responseFallback = responseFallback ?: current.responseFallback,
                sessionName = sessionName?.trim()?.takeIf { it.isNotEmpty() },
                sessionTtlMinutes = sessionTtlMinutes?.coerceIn(1, 1_440),
            )
        }
        return flareSolverrSettings()
    }

    fun updateDownloadSettings(
        downloadPath: String?,
        compressionEnabled: Boolean?,
        failedRetryDelaySeconds: Int?,
    ): JsonObject {
        ConfigManager.updateDownloads { current ->
            current.copy(
                downloadPath = downloadPath?.trim() ?: current.downloadPath,
                compressionEnabled = compressionEnabled ?: current.compressionEnabled,
                failedRetryDelaySeconds =
                    failedRetryDelaySeconds?.coerceIn(60, 604_800) ?: current.failedRetryDelaySeconds,
            )
        }
        return downloadSettings()
    }

    fun deleteDownloadedChapter(
        titleId: String,
        chapterUrl: String,
        localRelativePath: String?,
        storageKind: String?,
    ): Boolean = downloadStorage.deleteStoredChapter(titleId, chapterUrl, localRelativePath, storageKind)

    fun resolveStoredChapter(
        titleId: String,
        chapterUrl: String,
    ): StoredChapterPayload? = downloadStorage.resolveStoredChapter(titleId, chapterUrl)

    fun cacheCover(
        titleId: String,
        coverUrl: String?,
    ): String? {
        val normalizedUrl = coverUrl?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val request = Request.Builder().url(normalizedUrl).get().build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                logger.warn { "Failed to cache cover for title=$titleId from $normalizedUrl (${response.code})" }
                return null
            }
            val body = response.body ?: return null
            return downloadStorage.cacheCover(
                titleId = titleId,
                image =
                    PageImagePayload(
                        contentType = body.contentType()?.toString() ?: "application/octet-stream",
                        bytes = body.bytes(),
                    ),
            )
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
            put("author", title.author)
            put("artist", title.artist)
            put("description", title.description)
            put("coverUrl", title.thumbnailUrl)
            put("genre", title.genre)
            put("status", title.status)
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
            installed.sources.map { it.toPayload() }

        return InstalledExtensionPayload(
            pkg = installed.packageName,
            name = normalizeExtensionName(installed.name.ifBlank { installed.packageName }),
            lang = normalizeLangCode(installed.lang),
            version = installed.version.ifBlank { "unknown" },
            nsfw = installed.nsfw,
            useProxy = installed.useProxy,
            icon = iconUrl(repoService.currentRepoIndexUrl(), installed.packageName),
            sources = sources,
        )
    }

    private suspend fun fetchFeed(sourceId: String, page: Int, limit: Int, feed: String): JsonObject {
        extensionManager.awaitReady()
        val normalizedLimit = limit.coerceIn(1, 100)
        val cacheKey = "$feed:$sourceId:$page:$normalizedLimit"
        val now = System.currentTimeMillis()
        feedCache[cacheKey]?.takeIf { it.expiresAt > now }?.let { return it.payload }
        val parsedSourceId = sourceId.toLong()
        if (!ConfigManager.isSourceEnabled(parsedSourceId)) {
            error("Source is disabled: $sourceId")
        }
        val source =
            extensionManager
                .listSources()
                .firstOrNull { it.id == parsedSourceId }
                ?: error("Source not found: $sourceId")
        val sourcePkg = ConfigManager.config.findBySourceId(parsedSourceId)?.packageName.orEmpty()
        if (sourcePkg == MANGADEX_PACKAGE && feed == "popular") {
            val payload = fetchMangaDexPopularFeed(sourceId, source, normalizedLimit, page, sourcePkg)
            feedCache[cacheKey] = CachedFeedResult(payload = payload, expiresAt = now + FEED_CACHE_TTL_MS)
            return payload
        }
        val response =
            when (feed) {
                "popular" -> extensionManager.getPopularTitles(parsedSourceId, page)
                "latest" -> extensionManager.getLatestTitles(parsedSourceId, page)
                else -> error("Unsupported feed: $feed")
            }
        val items =
            response.titlesList
                .take(normalizedLimit)
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
                        put("genre", title.genre)
                    }
                }

        val payload = buildJsonObject {
            put("ok", true)
            put("sourceId", sourceId)
            put("feed", feed)
            put("page", page)
            put("hasNextPage", response.hasNextPage)
            put("items", JsonArray(items))
        }
        feedCache[cacheKey] = CachedFeedResult(payload = payload, expiresAt = now + FEED_CACHE_TTL_MS)
        return payload
    }

    private fun fetchMangaDexPopularFeed(
        sourceId: String,
        source: mangarr.tachibridge.config.BridgeConfig.SourceInfo,
        limit: Int,
        page: Int,
        sourcePkg: String,
    ): JsonObject {
        val offset = ((page - 1).coerceAtLeast(0)) * limit
        val url =
            "https://api.mangadex.org/manga"
                .toHttpUrl()
                .newBuilder()
                .addQueryParameter("order[followedCount]", "desc")
                .addQueryParameter("availableTranslatedLanguage[]", source.lang)
                .addQueryParameter("limit", limit.toString())
                .addQueryParameter("offset", offset.toString())
                .addQueryParameter("includes[]", "cover_art")
                .build()
        val request = Request.Builder().url(url).get().build()
        val body =
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    error("MangaDex popular request failed with HTTP ${response.code}")
                }
                response.body?.string() ?: error("MangaDex popular request returned an empty body")
            }
        val payload = json.parseToJsonElement(body).jsonObject
        val total = payload["total"]?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 0
        val items =
            payload["data"]
                ?.jsonArray
                ?.mapNotNull { element ->
                    val item = element.jsonObject
                    val mangaId = item["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                    val attributes = item["attributes"]?.jsonObject ?: return@mapNotNull null
                    val title = firstLocalizedValue(attributes["title"]) ?: return@mapNotNull null
                    val description = firstLocalizedValue(attributes["description"])
                    val genre =
                        item["attributes"]
                            ?.jsonObject
                            ?.get("tags")
                            ?.jsonArray
                            ?.mapNotNull { tag ->
                                firstLocalizedValue(tag.jsonObject["attributes"]?.jsonObject?.get("name"))
                            }?.distinct()
                            ?.takeIf { it.isNotEmpty() }
                            ?.joinToString(", ")
                    val coverFileName =
                        item["relationships"]
                            ?.jsonArray
                            ?.firstOrNull { relationship ->
                                relationship.jsonObject["type"]?.jsonPrimitive?.contentOrNull == "cover_art"
                            }?.jsonObject
                            ?.get("attributes")
                            ?.jsonObject
                            ?.get("fileName")
                            ?.jsonPrimitive
                            ?.contentOrNull
                    val coverUrl =
                        coverFileName?.let { fileName ->
                            "https://uploads.mangadex.org/covers/$mangaId/$fileName"
                        }

                    buildJsonObject {
                        put("canonicalKey", canonicalKey(sourceId, "/manga/$mangaId"))
                        put("sourceId", sourceId)
                        put("sourcePkg", sourcePkg)
                        put("sourceLang", source.lang)
                        put("sourceName", source.name)
                        put("titleUrl", "/manga/$mangaId")
                        put("title", title)
                        description?.let { put("description", it) }
                        coverUrl?.let { put("coverUrl", it) }
                        genre?.let { put("genre", it) }
                    }
                } ?: emptyList()

        return buildJsonObject {
            put("ok", true)
            put("sourceId", sourceId)
            put("feed", "popular")
            put("page", page)
            put("hasNextPage", total > offset + items.size)
            put("items", JsonArray(items))
        }
    }

    private fun firstLocalizedValue(element: JsonElement?): String? {
        val values =
            element
                ?.jsonObject
                ?.values
                ?.mapNotNull { value -> value.jsonPrimitive.contentOrNull?.trim()?.takeIf { it.isNotEmpty() } }
                ?: return null
        return values.firstOrNull()
    }

    private fun normalizeRepoEntry(entry: mangarr.tachibridge.repo.ExtensionRepoEntry): JsonObject =
        buildJsonObject {
            put("pkg", entry.pkg)
            put("name", normalizeExtensionName(entry.name))
            put("version", entry.version)
            put("lang", normalizeLangCode(entry.lang))
            put("nsfw", (entry.nsfw ?: 0) == 1)
            iconUrl(repoService.currentRepoIndexUrl(), entry.pkg)?.let { put("icon", it) }
            put(
                "sources",
                JsonArray(
                    entry.sources.map { source ->
                        buildJsonObject {
                            put("id", source.id.toString())
                            put("name", source.name)
                            put("lang", normalizeLangCode(source.lang))
                            put("supportsLatest", source.supportsLatest ?: true)
                        }
                    },
                ),
            )
        }

    private fun normalizeExtensionName(name: String): String = name.removePrefix("Tachiyomi: ").trim()

    private fun normalizeLangCode(lang: String): String {
        val normalized = lang.trim().ifBlank { "all" }
        return if (normalized == "all") "multi" else normalized
    }

    private fun iconUrl(repoIndexUrl: String, pkg: String): String? {
        val normalizedRepoUrl = repoIndexUrl.trim()
        if (normalizedRepoUrl.isBlank()) return null
        return "${normalizedRepoUrl.substringBeforeLast("/")}/icon/$pkg.png"
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

data class DownloadReconcileChapter(
    val chapterId: String,
    val titleId: String,
    val chapterUrl: String,
    val currentStatus: String,
    val localRelativePath: String? = null,
    val storageKind: String? = null,
)

data class InstalledExtensionPayload(
    val pkg: String,
    val name: String,
    val lang: String,
    val version: String,
    val nsfw: Boolean,
    val useProxy: Boolean,
    val icon: String? = null,
    val sources: List<SourcePayload>,
)

data class SourcePayload(
    val id: String,
    val name: String,
    val lang: String,
    val supportsLatest: Boolean,
    val enabled: Boolean,
)

private fun mangarr.tachibridge.config.BridgeConfig.SourceInfo.toPayload() =
    SourcePayload(
        id = id.toString(),
        name = name,
        lang = lang,
        supportsLatest = supportsLatest,
        enabled = enabled,
    )

private data class CachedFeedResult(
    val payload: JsonObject,
    val expiresAt: Long,
)
