package mangarr.tachibridge.runtime

import io.github.oshai.kotlinlogging.KotlinLogging
import eu.kanade.tachiyomi.network.HttpException
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
import java.nio.file.Files
import java.nio.file.Path
import java.util.Base64
import java.util.regex.Pattern
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.io.path.exists

private val logger = KotlinLogging.logger {}
private val json = Json { ignoreUnknownKeys = true }
private const val FEED_CACHE_TTL_MS = 5 * 60 * 1000L
private const val READER_PAGE_CACHE_TTL_MS = 15 * 60 * 1000L
private const val MANGADEX_PACKAGE = "eu.kanade.tachiyomi.extension.all.mangadex"
private val DOWNLOAD_PAGE_RETRY_DELAYS_MS = listOf(0L, 2_000L, 5_000L, 15_000L)
private val SOURCE_REQUEST_RETRY_DELAYS_MS = listOf(0L, 1_500L, 4_000L)
private const val DOWNLOAD_PAGE_CONCURRENCY = 2
private val HTTP_ERROR_PATTERN = Pattern.compile("HTTP error\\s+(\\d{3})")

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
class BridgeService(
    private val extensionManager: ExtensionManager,
    private val repoService: ExtensionRepoService,
    private val downloadStorage: DownloadStorage,
    private val feedCacheDir: Path,
    private val readerPageCacheDir: Path,
) {
    private val httpClient = OkHttpClient()
    private val feedCache = ConcurrentHashMap<String, CachedFeedResult>()
    private val readerPageCache = ConcurrentHashMap<String, CachedReaderPage>()
    private val readerPageLocks = ConcurrentHashMap<String, Mutex>()

    fun pruneCaches(now: Long = System.currentTimeMillis()): CachePruneSummary {
        feedCache.entries.removeIf { (_, cached) -> cached.expiresAt <= now }
        readerPageCache.entries.removeIf { (_, cached) -> cached.expiresAt <= now }

        val deletedFeedFiles = pruneFeedCacheFiles(json, feedCacheDir, now)
        val deletedReaderPageFiles = pruneReaderPageCacheFiles(json, readerPageCacheDir, now)
        val storage = downloadStorage.pruneCachedArtifacts(now = now)

        return CachePruneSummary(
            deletedFeedFiles = deletedFeedFiles,
            deletedReaderPageFiles = deletedReaderPageFiles,
            deletedCoverFiles = storage.deletedCoverFiles,
            deletedTempWorkspaces = storage.deletedTempWorkspaces,
            deletedTempExports = storage.deletedTempExports,
        )
    }

    fun repositorySnapshot(forceRefresh: Boolean = false): JsonObject {
        val url = repoService.currentRepoIndexUrl().trim()
        if (url.isBlank()) {
            return buildJsonObject {
                put("ok", true)
                put("configured", false)
                put("url", "")
                put("extensionCount", 0)
                put("languages", JsonArray(emptyList()))
            }
        }

        val entries = repoService.fetchIndex(forceRefresh = forceRefresh)
        return buildJsonObject {
            put("ok", true)
            put("configured", true)
            put("url", url)
            put("extensionCount", entries.size)
            put("languages", JsonArray(repositoryLanguages(entries)))
        }
    }

    fun syncRepository(url: String): JsonObject {
        repoService.updateRepoIndexUrl(url)
        ConfigManager.setRepoUrl(url)
        val entries = repoService.fetchIndex(forceRefresh = true)
        return buildJsonObject {
            put("ok", true)
            put("url", url)
            put("extensionCount", entries.size)
            put("languages", JsonArray(repositoryLanguages(entries)))
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
                .map { normalizeRepoEntry(it, repoService.currentRepoIndexUrl()) }
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

    suspend fun saveSourcePreferences(sourceId: String, entries: List<Pair<String, JsonElement>>): JsonObject {
        extensionManager.awaitReady()
        val parsedSourceId = sourceId.toLong()
        extensionManager.setPreferences(
            parsedSourceId,
            entries.map { (key, value) ->
                key to json.encodeToString(JsonElement.serializer(), value)
            },
        )

        return buildJsonObject {
            put("ok", true)
            put("sourceId", sourceId)
            put("updatedCount", entries.size)
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
                    withSourceRequestRetry(
                        sourceId = source.id,
                        requestKind = "search",
                        requestKey = currentSourceId,
                    ) {
                        extensionManager.searchTitle(
                            source.id,
                            query,
                            1,
                            normalizeFilterInput(searchFilters),
                        )
                    }
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
                if (selectedSourceId != null) {
                    throw error
                }
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
        val parsedSourceId = sourceId.toLong()
        val response =
            withSourceRequestRetry(
                sourceId = parsedSourceId,
                requestKind = "title",
                requestKey = titleUrl,
            ) {
                extensionManager.getTitleDetails(parsedSourceId, titleUrl)
            }
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
        val parsedSourceId = sourceId.toLong()
        val chapters =
            withSourceRequestRetry(
                sourceId = parsedSourceId,
                requestKind = "chapters",
                requestKey = titleUrl,
            ) {
                extensionManager.getChaptersList(parsedSourceId, titleUrl)
            }
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

    suspend fun fetchPages(sourceId: String, chapterUrl: String, chapterName: String? = null): JsonObject {
        extensionManager.awaitReady()
        if (!ConfigManager.isSourceEnabled(sourceId.toLong())) {
            error("Source is disabled: $sourceId")
        }
        val parsedSourceId = sourceId.toLong()
        val pages =
            withSourceRequestRetry(
                sourceId = parsedSourceId,
                requestKind = "pages",
                requestKey = chapterUrl,
            ) {
                extensionManager.getPagesList(parsedSourceId, chapterUrl, chapterName)
            }
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

    suspend fun fetchPageImage(
        sourceId: String,
        chapterUrl: String,
        chapterName: String? = null,
        index: Int,
    ): PageImagePayload {
        extensionManager.awaitReady()
        val cacheKey = "$sourceId::$chapterUrl::$index"
        val now = System.currentTimeMillis()

        readerPageCache[cacheKey]?.takeIf { it.expiresAt > now }?.let { cached ->
            return PageImagePayload(contentType = cached.contentType, bytes = cached.bytes)
        }
        loadPersistedReaderPage(json, readerPageCacheDir, cacheKey, now)?.let { cached ->
            readerPageCache[cacheKey] = cached
            return PageImagePayload(contentType = cached.contentType, bytes = cached.bytes)
        }

        val lock = readerPageLocks.computeIfAbsent(cacheKey) { Mutex() }
        return lock.withLock {
            val currentTime = System.currentTimeMillis()
            readerPageCache[cacheKey]?.takeIf { it.expiresAt > currentTime }?.let { cached ->
                return@withLock PageImagePayload(contentType = cached.contentType, bytes = cached.bytes)
            }
            loadPersistedReaderPage(json, readerPageCacheDir, cacheKey, currentTime)?.let { cached ->
                readerPageCache[cacheKey] = cached
                return@withLock PageImagePayload(contentType = cached.contentType, bytes = cached.bytes)
            }

            val payload = fetchPageImageWithRetry(sourceId.toLong(), chapterUrl, chapterName, index)
            val cached =
                CachedReaderPage(
                    contentType = payload.contentType,
                    bytes = payload.bytes,
                    expiresAt = System.currentTimeMillis() + READER_PAGE_CACHE_TTL_MS,
                )
            readerPageCache[cacheKey] = cached
            persistReaderPage(json, readerPageCacheDir, cacheKey, cached)
            PageImagePayload(contentType = cached.contentType, bytes = cached.bytes)
        }
    }

    suspend fun downloadChapter(
        titleId: String,
        titleName: String,
        sourceId: String,
        sourcePkg: String,
        sourceLang: String,
        chapterUrl: String,
        chapterName: String,
        chapterNumber: Double?,
        onProgress: (downloadedPages: Int, totalPages: Int) -> Unit,
    ): JsonObject {
        extensionManager.awaitReady()
        val parsedSourceId = sourceId.toLong()
        val pages =
            withSourceRequestRetry(
                sourceId = parsedSourceId,
                requestKind = "pages",
                requestKey = chapterUrl,
            ) {
                extensionManager.getPagesList(parsedSourceId, chapterUrl, chapterName)
            }
        val totalPages = pages.pagesList.size
        val workspace =
            downloadStorage.createChapterWorkspace(
                titleId = titleId,
                titleName = titleName,
                sourceId = sourceId,
                sourcePkg = sourcePkg,
                sourceLang = sourceLang,
                chapterUrl = chapterUrl,
                chapterName = chapterName,
                chapterNumber = chapterNumber,
            )

        if (totalPages > 0) {
            val nextIndex = AtomicInteger(0)
            val completedPages = AtomicInteger(0)
            coroutineScope {
                repeat(minOf(DOWNLOAD_PAGE_CONCURRENCY, totalPages)) {
                    launch(Dispatchers.IO) {
                        while (true) {
                            val index = nextIndex.getAndIncrement()
                            if (index >= totalPages) {
                                return@launch
                            }
                            val image = fetchPageImageWithRetry(sourceId.toLong(), chapterUrl, chapterName, index)
                            downloadStorage.writePage(workspace, index, image)
                            onProgress(completedPages.incrementAndGet(), totalPages)
                        }
                    }
                }
            }
        }

        val stored = downloadStorage.finalizeChapterDownload(workspace)
        return buildJsonObject {
            put("ok", true)
            put("totalPages", totalPages)
            put("downloadedPages", totalPages)
            put("storageKind", stored.storageKind)
            put("localRelativePath", stored.localRelativePath)
            put("fileSizeBytes", stored.fileSizeBytes)
        }
    }

    private suspend fun fetchPageImageWithRetry(
        sourceId: Long,
        chapterUrl: String,
        chapterName: String?,
        index: Int,
    ): PageImagePayload {
        var lastError: Exception? = null

        for ((attemptIndex, baseDelayMs) in DOWNLOAD_PAGE_RETRY_DELAYS_MS.withIndex()) {
            val delayMs =
                if (lastError is HttpException) {
                    maxOf(baseDelayMs, ((lastError as HttpException).retryAfterSeconds ?: 0L) * 1_000L)
                } else {
                    baseDelayMs
                }
            if (delayMs > 0) {
                kotlinx.coroutines.delay(delayMs)
            }

            try {
                return extensionManager.getPageImage(sourceId, chapterUrl, chapterName, index)
            } catch (error: Exception) {
                lastError = error
                if (!shouldRetryPageFetch(error) || attemptIndex == DOWNLOAD_PAGE_RETRY_DELAYS_MS.lastIndex) {
                    throw error
                }

                logger.warn(error) {
                    "Page fetch failed for chapter $chapterUrl page ${index + 1} " +
                        "(attempt ${attemptIndex + 1}/${DOWNLOAD_PAGE_RETRY_DELAYS_MS.size}), retrying"
                }
            }
        }

        throw lastError ?: IllegalStateException("Failed to fetch page $index for $chapterUrl")
    }

    private fun shouldRetryPageFetch(error: Exception): Boolean =
        when (error) {
            is HttpException -> error.code == 429 || error.code in 500..599
            is java.io.IOException -> true
            else -> false
        }

    fun fetchStoredPage(
        localRelativePath: String,
        index: Int,
    ): PageImagePayload = downloadStorage.readStoredPage(localRelativePath, index)

    fun fetchStoredCover(localCoverPath: String): PageImagePayload = downloadStorage.readCover(localCoverPath)

    fun fetchStoredChapterFile(
        localRelativePath: String,
    ): StoredChapterFilePayload = downloadStorage.readStoredChapterFile(localRelativePath)

    fun downloadSettings(): JsonObject {
        val settings = ConfigManager.config.downloads
        val storage = downloadStorage.summary()
        return buildJsonObject {
            put("downloadPath", storage.downloadPath)
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
        failedRetryDelaySeconds: Int?,
    ): JsonObject {
        ConfigManager.updateDownloads { current ->
            current.copy(
                downloadPath = downloadPath?.trim() ?: current.downloadPath,
                failedRetryDelaySeconds =
                    failedRetryDelaySeconds?.coerceIn(60, 604_800) ?: current.failedRetryDelaySeconds,
            )
        }
        return downloadSettings()
    }

    fun deleteDownloadedChapter(
        titleId: String,
        titleName: String,
        sourceId: String,
        sourcePkg: String,
        sourceLang: String,
        chapterUrl: String,
        chapterName: String,
        chapterNumber: Double?,
        localRelativePath: String?,
    ): Boolean =
        downloadStorage.deleteStoredChapter(
            titleId = titleId,
            titleName = titleName,
            sourceId = sourceId,
            sourcePkg = sourcePkg,
            sourceLang = sourceLang,
            chapterUrl = chapterUrl,
            chapterName = chapterName,
            chapterNumber = chapterNumber,
            relativePath = localRelativePath,
        )

    fun resolveStoredChapter(
        titleId: String,
        titleName: String,
        sourceId: String,
        sourcePkg: String,
        sourceLang: String,
        chapterUrl: String,
        chapterName: String,
        chapterNumber: Double?,
    ): StoredChapterPayload? =
        downloadStorage.resolveStoredChapter(
            titleId = titleId,
            titleName = titleName,
            sourceId = sourceId,
            sourcePkg = sourcePkg,
            sourceLang = sourceLang,
            chapterUrl = chapterUrl,
            chapterName = chapterName,
            chapterNumber = chapterNumber,
        )

    suspend fun cacheCover(
        titleId: String,
        sourceId: String?,
        coverUrl: String?,
    ): String? {
        val normalizedUrl = coverUrl?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val image =
            runCatching {
                sourceId
                    ?.trim()
                    ?.takeIf { it.isNotEmpty() }
                    ?.toLongOrNull()
                    ?.let { parsedSourceId -> extensionManager.fetchBinary(parsedSourceId, normalizedUrl) }
                    ?: run {
                        val request = Request.Builder().url(normalizedUrl).get().build()
                        httpClient.newCall(request).execute().use { response ->
                            if (!response.isSuccessful) {
                                logger.warn { "Failed to cache cover for title=$titleId from $normalizedUrl (${response.code})" }
                                return null
                            }
                            val body = response.body ?: return null
                            PageImagePayload(
                                contentType = body.contentType()?.toString() ?: "application/octet-stream",
                                bytes = body.bytes(),
                            )
                        }
                    }
            }.getOrElse { error ->
                logger.warn(error) { "Failed to cache cover for title=$titleId from $normalizedUrl" }
                return null
            }

        return downloadStorage.cacheCover(
            titleId = titleId,
            image = image,
        )
    }

    suspend fun resolveImport(
        sourceId: String,
        sourcePkg: String,
        sourceLang: String,
        titleUrl: String,
    ): JsonObject {
        extensionManager.awaitReady()
        val parsedSourceId = sourceId.toLong()
        val response =
            withSourceRequestRetry(
                sourceId = parsedSourceId,
                requestKind = "title",
                requestKey = titleUrl,
            ) {
                extensionManager.getTitleDetails(parsedSourceId, titleUrl)
            }
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
        loadPersistedFeed(json, feedCacheDir, cacheKey, now)?.let { payload ->
            feedCache[cacheKey] = CachedFeedResult(payload = payload, expiresAt = now + FEED_CACHE_TTL_MS)
            return payload
        }
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
            storeFeedCache(cacheKey, payload, now + FEED_CACHE_TTL_MS)
            return payload
        }
        val response =
            withSourceRequestRetry(
                sourceId = parsedSourceId,
                requestKind = feed,
                requestKey = "$sourceId:$page:$normalizedLimit",
            ) {
                when (feed) {
                    "popular" -> extensionManager.getPopularTitles(parsedSourceId, page)
                    "latest" -> extensionManager.getLatestTitles(parsedSourceId, page)
                    else -> error("Unsupported feed: $feed")
                }
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
        storeFeedCache(cacheKey, payload, now + FEED_CACHE_TTL_MS)
        return payload
    }

    private fun storeFeedCache(cacheKey: String, payload: JsonObject, expiresAt: Long) {
        feedCache[cacheKey] = CachedFeedResult(payload = payload, expiresAt = expiresAt)
        persistFeed(json, feedCacheDir, cacheKey, payload, expiresAt)
    }

    private suspend fun <T> withSourceRequestRetry(
        sourceId: Long,
        requestKind: String,
        requestKey: String,
        block: suspend () -> T,
    ): T {
        var lastError: Exception? = null

        for ((attemptIndex, baseDelayMs) in SOURCE_REQUEST_RETRY_DELAYS_MS.withIndex()) {
            val delayMs =
                if (lastError is HttpException) {
                    maxOf(baseDelayMs, ((lastError as HttpException).retryAfterSeconds ?: 0L) * 1_000L)
                } else {
                    baseDelayMs
                }
            if (delayMs > 0) {
                delay(delayMs)
            }

            try {
                return block()
            } catch (error: Exception) {
                lastError = error
                if (!shouldRetrySourceRequest(error) || attemptIndex == SOURCE_REQUEST_RETRY_DELAYS_MS.lastIndex) {
                    throw error
                }

                logger.warn(error) {
                    "Source $requestKind request failed for $sourceId ($requestKey) " +
                        "attempt ${attemptIndex + 1}/${SOURCE_REQUEST_RETRY_DELAYS_MS.size}, retrying"
                }
            }
        }

        throw lastError ?: IllegalStateException("Failed source $requestKind request for $sourceId")
    }

    private fun shouldRetrySourceRequest(error: Exception): Boolean =
        when (error) {
            is HttpException -> error.code == 429 || error.code in 500..599
            is java.io.IOException -> true
            else -> {
                val statusCode = parseHttpStatusCode(error)
                when {
                    statusCode == null -> false
                    statusCode == 429 || statusCode in 500..599 -> true
                    else -> false
                }
            }
        }

    private fun parseHttpStatusCode(error: Throwable): Int? {
        var current: Throwable? = error
        while (current != null) {
            val message = current.message
            if (!message.isNullOrBlank()) {
                val match = HTTP_ERROR_PATTERN.matcher(message)
                if (match.find()) {
                    return match.group(1)?.toIntOrNull()
                }
            }
            current = current.cause
        }
        return null
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
    val titleName: String,
    val sourceId: String,
    val sourcePkg: String,
    val sourceLang: String,
    val chapterUrl: String,
    val chapterName: String,
    val chapterNumber: Double? = null,
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

data class CachePruneSummary(
    val deletedFeedFiles: Int,
    val deletedReaderPageFiles: Int,
    val deletedCoverFiles: Int,
    val deletedTempWorkspaces: Int,
    val deletedTempExports: Int,
)

private fun mangarr.tachibridge.config.BridgeConfig.SourceInfo.toPayload() =
    SourcePayload(
        id = id.toString(),
        name = name,
        lang = lang,
        supportsLatest = supportsLatest,
        enabled = enabled,
    )
