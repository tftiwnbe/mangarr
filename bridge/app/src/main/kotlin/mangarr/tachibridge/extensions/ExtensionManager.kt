package mangarr.tachibridge.extensions

import android.app.Application
import androidx.preference.PreferenceScreen
import eu.kanade.tachiyomi.network.BridgeProxyContext
import eu.kanade.tachiyomi.network.BridgeProxySettings
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.ConfigurableSource
import eu.kanade.tachiyomi.source.Source
import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import mangarr.tachibridge.config.BridgeConfig
import mangarr.tachibridge.config.ConfigManager
import mangarr.tachibridge.config.PreferenceValue
import mangarr.tachibridge.config.findExtension
import mangarr.tachibridge.config.sourcePreferencesFor
import mangarr.tachibridge.loader.ExtensionLoader
import mangarr.tachibridge.repo.ExtensionRepoService
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.URLEncoder
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import kotlin.io.path.exists
import kotlin.io.path.pathString

private val logger = KotlinLogging.logger {}
@kotlinx.serialization.ExperimentalSerializationApi
class ExtensionManager(
    private val extensionsDir: Path,
    private val loader: ExtensionLoader,
    private val repoService: ExtensionRepoService,
    private val networkHelper: NetworkHelper,
) {
    private val chapterPagesCache = ConcurrentHashMap<String, CachedChapterPages>()
    companion object {
        const val DELETE_PREFERENCE_MARKER = "__mangarr_delete_preference__"
    }

    private val libGroupRetryDelaysMs = listOf(0L, 2_000L, 6_000L)

    private val sourceMap = ConcurrentHashMap<Long, Source>()
    private val sourceToPackage = ConcurrentHashMap<Long, String>()
    private val appliedPreferenceHashes = ConcurrentHashMap<Long, Int>()
    private val libGroupSupport = ExtensionManagerLibGroupSupport(networkHelper, sourceToPackage, libGroupRetryDelaysMs)
    private val pageCacheSupport = ExtensionManagerPageCacheSupport(networkHelper, chapterPagesCache, libGroupSupport)
    private val initialization = CompletableDeferred<Unit>()
    private val initLock = Mutex()

    @Volatile
    private var initializationError: Throwable? = null

    init {
        if (!Files.exists(extensionsDir)) {
            Files.createDirectories(extensionsDir)
        }
    }

    suspend fun init() {
        if (initialization.isCompleted) {
            awaitReady()
            return
        }

        initLock.withLock {
            if (initialization.isCompleted) {
                return@withLock
            }

            try {
                logger.debug { "Initializing extension manager..." }

                // Sync filesystem
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

                val config = ConfigManager.config
                val validPackages =
                    config.extensions
                        .filter { ext ->
                            val jarName = ext.jarName ?: "${ext.packageName}-v${ext.version}.jar"
                            jarName in jarFiles
                        }.map { it.packageName }
                        .toSet()

                ConfigManager.syncExtensions(validPackages)

                // Auto-load all extensions
                var loadedCount = 0
                ConfigManager.config.extensions.forEach { ext ->
                    try {
                        loadExtension(ext)
                        loadedCount++
                    } catch (e: Exception) {
                        logger.error(e) { "Failed to auto-load: ${ext.packageName}" }
                    }
                }

                logger.info { "Loaded $loadedCount extensions with ${sourceMap.size} sources" }
                initialization.complete(Unit)
            } catch (e: Exception) {
                initializationError = e
                initialization.complete(Unit)
                throw e
            }
        }
    }

    suspend fun awaitReady() {
        initialization.await()
        initializationError?.let {
            throw IllegalStateException("Extension manager initialization failed", it)
        }
    }

    fun isReady(): Boolean = initialization.isCompleted && initializationError == null

    fun initializationFailure(): Throwable? = initializationError

    suspend fun listExtensions(): List<BridgeConfig.InstalledExtension> = ConfigManager.config.extensions

    suspend fun listRepoExtensions(): List<ExtensionInfo> {
        val repoExtensions = repoService.fetchIndex(forceRefresh = false)
        return repoExtensions.map { entry ->
            ExtensionInfo
                .newBuilder()
                .setPkgName(entry.pkg)
                .setName(entry.name)
                .setVersion(entry.version)
                .setLang(entry.lang)
                .setNsfw((entry.nsfw ?: 0) == 1)
                .addAllSources(
                    entry.sources.map { source ->
                        SourceInfo
                            .newBuilder()
                            .setId(source.id)
                            .setName(source.name)
                            .setLang(source.lang)
                            .setIsNsfw(false)
                            .setSupportsLatest(source.supportsLatest ?: true)
                            .build()
                    },
                ).build()
        }
    }

    suspend fun installFromRepo(packageName: String): BridgeConfig.InstalledExtension {
        val repoUrl = ConfigManager.config.repoUrl
        if (repoUrl.isBlank()) {
            throw IllegalStateException("Repository URL not configured")
        }

        logger.info { "Installing: $packageName" }

        val entry =
            repoService.findByPackage(packageName)
                ?: throw IllegalArgumentException("Extension not found in repo: $packageName")

        if (ConfigManager.config.findExtension(packageName) != null) {
            throw IllegalStateException("Already installed: $packageName")
        }

        val targetFile = extensionsDir.resolve(entry.apk)
        if (targetFile.exists()) {
            throw IllegalStateException("APK already exists: ${targetFile.pathString}")
        }

        val downloadUrl = buildDownloadUrl(repoUrl, entry.apk)
        val tmpFile = Files.createTempFile(extensionsDir, packageName.replace('.', '_'), ".tmp")

        val loaded =
            try {
                // Download
                val request = GET(downloadUrl)
                networkHelper.client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw IOException("Download failed: HTTP ${response.code}")
                    }
                    response.body!!.byteStream().use { input ->
                        Files.newOutputStream(tmpFile).use { output ->
                            input.copyTo(output)
                        }
                    }
                }

                // Convert and load
                Files.move(tmpFile, targetFile, StandardCopyOption.REPLACE_EXISTING)
                val result = loader.load(targetFile.pathString)
                Files.deleteIfExists(targetFile) // Clean up APK
                result
            } catch (e: Exception) {
                Files.deleteIfExists(targetFile)
                Files.deleteIfExists(tmpFile)
                throw e
            }

        // Clean up
        val jarPath = Path.of(loaded.jarPath)
        loader.unloadJar(jarPath)
        purgeOldJars(packageName, jarPath)

        // Create extension record with supports_latest info from repo
        val extension =
            BridgeConfig.InstalledExtension(
                packageName = packageName,
                name = entry.name,
                version = entry.version,
                lang = entry.lang,
                nsfw = (entry.nsfw ?: 0) == 1,
                jarName = jarPath.fileName.toString(),
                sourceClassName = loaded.metadata.sourceClassName,
                factoryClassName = loaded.metadata.factoryClassName,
                useProxy = false,
                sources =
                    loaded.sources.map { source ->
                        val repoSource = entry.sources.find { it.id == source.id }
                        val supportsLatest =
                            repoSource?.supportsLatest
                                ?: (source as? CatalogueSource)?.supportsLatest
                                ?: true

                        BridgeConfig.SourceInfo(
                            id = source.id,
                            name = source.name,
                            lang = source.lang,
                            supportsLatest = supportsLatest,
                            enabled = true,
                        )
                    },
            )

        // Save and load
        ConfigManager.upsertExtension(extension)
        loadExtension(extension)

        logger.info { "Installed: $packageName" }
        return extension
    }

    suspend fun uninstall(packageName: String) {
        logger.info { "Uninstalling: $packageName" }

        val ext =
            ConfigManager.config.findExtension(packageName)
                ?: throw IllegalArgumentException("Not installed: $packageName")

        // Unregister sources
        ext.sources.forEach { source ->
            sourceMap.remove(source.id)
            sourceToPackage.remove(source.id)
            appliedPreferenceHashes.remove(source.id)
        }

        // Delete jar
        val jarPath =
            ext.jarName?.let { extensionsDir.resolve(it) }
                ?: extensionsDir.resolve("${ext.packageName}-v${ext.version}.jar")

        loader.unloadJar(jarPath)
        Files.deleteIfExists(jarPath)

        // Update config
        ConfigManager.removeExtension(packageName)

        logger.info { "Uninstalled: $packageName" }
    }

    suspend fun update(packageName: String): BridgeConfig.InstalledExtension {
        logger.info { "Updating: $packageName" }

        val installed =
            ConfigManager.config.findExtension(packageName)
                ?: throw IllegalArgumentException("Not installed: $packageName")
        val previousSourceEnabled =
            installed.sources.associate { source -> source.id to source.enabled }

        val repoEntry =
            repoService.findByPackage(packageName, forceRefresh = true)
                ?: throw IllegalArgumentException("Not found in repo: $packageName")

        check(repoEntry.version != installed.version) { "Already up to date: $packageName" }

        uninstall(packageName)
        val updated = installFromRepo(packageName)
        if (previousSourceEnabled.isEmpty()) {
            return updated
        }

        val patched =
            updated.copy(
                sources =
                    updated.sources.map { source ->
                        source.copy(enabled = previousSourceEnabled[source.id] ?: source.enabled)
                    },
            )
        ConfigManager.upsertExtension(patched)
        return patched
    }

    fun listSources(): List<BridgeConfig.SourceInfo> {
        val config = ConfigManager.config
        return sourceMap.values.mapNotNull { source ->
            val packageName = sourceToPackage[source.id] ?: return@mapNotNull null
            val ext = config.findExtension(packageName) ?: return@mapNotNull null
            ext.sources.find { it.id == source.id }
        }
    }

    suspend fun searchTitle(
        sourceId: Long,
        query: String,
        page: Int,
        searchFilters: Map<String, String> = emptyMap(),
    ): TitlesPageResponse =
        withSource<CatalogueSource, TitlesPageResponse>(sourceId) { source ->
            val filterList = source.getFilterList()
            applySearchFiltersToList(filterList, searchFilters)
            val result = source.getSearchManga(page, query, filterList)
            convertTitlesPage(result)
        }

    suspend fun getPopularTitles(
        sourceId: Long,
        page: Int,
    ): TitlesPageResponse =
        withSource<CatalogueSource, TitlesPageResponse>(sourceId) { source ->
            val result = source.getPopularManga(page)
            convertTitlesPage(result)
        }

    suspend fun getLatestTitles(
        sourceId: Long,
        page: Int,
    ): TitlesPageResponse =
        withSource<CatalogueSource, TitlesPageResponse>(sourceId) { source ->
            val result = source.getLatestUpdates(page)
            convertTitlesPage(result)
        }

    suspend fun getTitleDetails(
        sourceId: Long,
        mangaUrl: String,
    ): TitleResponse =
        withSource<Source, TitleResponse>(sourceId) { source ->
            var normalizedUrl = libGroupSupport.normalizeSourceUrl(source, mangaUrl)
            if (libGroupSupport.isLibGroupSource(source)) {
                val fallback = libGroupSupport.fetchLibGroupMangaDetailsFallback(source, normalizedUrl)
                if (fallback != null) {
                    return@withSource TitleResponse
                        .newBuilder()
                        .setTitle(convertManga(fallback, fallbackUrl = normalizedUrl))
                        .build()
                }
            }
            var manga = SManga.create().apply { url = normalizedUrl }
            val result =
                try {
                    source.getMangaDetails(manga)
                } catch (error: Exception) {
                    logger.warn(error) {
                        "LibGroup getMangaDetails failed for source=${source.id} url=$normalizedUrl"
                    }
                    val resolvedUrl = libGroupSupport.resolveLibGroupCanonicalUrl(source, normalizedUrl, error)
                    if (resolvedUrl != null) {
                        normalizedUrl = resolvedUrl
                        manga = SManga.create().apply { url = normalizedUrl }
                        logger.info {
                            "Retrying LibGroup details with canonical url source=${source.id} url=$normalizedUrl"
                        }
                        source.getMangaDetails(manga)
                    } else {
                        val fallback = libGroupSupport.fetchLibGroupMangaDetailsFallback(source, normalizedUrl)
                        if (fallback != null) {
                            logger.info {
                                "Using LibGroup details fallback for source=${source.id} url=$normalizedUrl"
                            }
                            fallback
                        } else {
                            throw libGroupSupport.decorateLibGroupError(source, error)
                        }
                    }
                }
            TitleResponse
                .newBuilder()
                .setTitle(convertManga(result, fallbackUrl = normalizedUrl))
                .build()
        }

    suspend fun getChaptersList(
        sourceId: Long,
        mangaUrl: String,
    ): ChaptersListResponse =
        withSource<Source, ChaptersListResponse>(sourceId) { source ->
            var normalizedUrl = libGroupSupport.normalizeSourceUrl(source, mangaUrl)
            if (libGroupSupport.isLibGroupSource(source)) {
                val fallback = libGroupSupport.fetchLibGroupChapterListFallback(source, normalizedUrl)
                if (!fallback.isNullOrEmpty()) {
                    return@withSource ChaptersListResponse
                        .newBuilder()
                        .addAllChapters(fallback.map { convertChapter(it) })
                        .build()
                }
            }
            var manga = SManga.create().apply { url = normalizedUrl }
            val chapters =
                try {
                    source.getChapterList(manga).reversed()
                } catch (error: Exception) {
                    val resolvedUrl = libGroupSupport.resolveLibGroupCanonicalUrl(source, normalizedUrl, error)
                    if (resolvedUrl != null) {
                        normalizedUrl = resolvedUrl
                        manga = SManga.create().apply { url = normalizedUrl }
                        try {
                            source.getChapterList(manga).reversed()
                        } catch (resolvedError: Exception) {
                            libGroupSupport.fetchLibGroupChapterListFallback(source, normalizedUrl)
                                ?: throw libGroupSupport.decorateLibGroupError(source, resolvedError)
                        }
                    } else {
                        libGroupSupport.fetchLibGroupChapterListFallback(source, normalizedUrl)
                            ?: throw libGroupSupport.decorateLibGroupError(source, error)
                    }
                }
            ChaptersListResponse
                .newBuilder()
                .addAllChapters(chapters.map { convertChapter(it) })
                .build()
        }

    suspend fun getPagesList(
        sourceId: Long,
        chapterUrl: String,
    ): PagesListResponse =
        withSource<Source, PagesListResponse>(sourceId) { source ->
            val normalizedUrl = libGroupSupport.normalizeSourceUrl(source, chapterUrl)
            val pages = pageCacheSupport.loadPagesForChapter(source, normalizedUrl)
            val resolvedPages = mutableListOf<Page>()
            for ((index, page) in pages.withIndex()) {
                val pageUrl = safeString { page.url }
                val pageImageUrl = pageCacheSupport.resolvePageImageUrl(source, page)
                resolvedPages +=
                    Page
                        .newBuilder()
                        .setIndex(index)
                        .setUrl(pageUrl)
                        .setImageUrl(pageImageUrl)
                        .build()
            }
            PagesListResponse
                .newBuilder()
                .addAllPages(resolvedPages)
                .build()
        }

    suspend fun getPageImage(
        sourceId: Long,
        chapterUrl: String,
        index: Int,
    ): PageImagePayload =
        withSource<Source, PageImagePayload>(sourceId) { source ->
            val normalizedUrl = libGroupSupport.normalizeSourceUrl(source, chapterUrl)
            try {
                pageCacheSupport.fetchPageImagePayload(source, normalizedUrl, index, bypassPageCache = false)
            } catch (error: Exception) {
                if (!pageCacheSupport.shouldRefreshChapterPagesCache(error)) {
                    throw error
                }
                logger.debug(error) {
                    "Refreshing cached chapter pages for source=${source.id} chapter=$normalizedUrl index=$index"
                }
                pageCacheSupport.invalidateChapterPagesCache(source.id, normalizedUrl)
                pageCacheSupport.fetchPageImagePayload(source, normalizedUrl, index, bypassPageCache = true)
            }
        }

    suspend fun getFilters(sourceId: Long): FiltersResponse {
        val source = sourceMap[sourceId]

        val (screenFilters, knownKeys) =
            if (source is ConfigurableSource) {
                applyPreferences(source)

                val screen = PreferenceScreen(Injekt.get<Application>())
                screen.setSharedPreferences(source.getSourcePreferences())
                source.setupPreferenceScreen(screen)

                val filters =
                    screen.preferences.mapNotNull { preference ->
                        runCatching {
                            val type = extensionPreferenceType(preference)
                            val data = encodeExtensionPreference(preference, type)

                            Filter
                                .newBuilder()
                                .setName(preference.title?.toString() ?: preference.key ?: "Preference")
                                .setType(type)
                                .setData(data)
                                .build()
                        }.getOrElse {
                            logger.warn(it) {
                                "Failed to serialize preference for source $sourceId: ${preference.key}"
                            }
                            null
                        }
                    }

                val keys =
                    screen.preferences
                        .mapNotNull { preference ->
                            preference.key?.trim()?.takeIf { it.isNotEmpty() }
                        }.toSet()

                filters to keys
            } else {
                emptyList<Filter>() to emptySet()
            }

        val storedFilters =
            ConfigManager.config
                .sourcePreferencesFor(sourceId)
                .asSequence()
                .filter { (key, _) -> key.isNotBlank() && key !in knownKeys }
                .map { (key, value) -> encodeStoredPreferenceFilter(key, value) }
                .toList()

        if (screenFilters.isEmpty() && storedFilters.isEmpty()) {
            return FiltersResponse.getDefaultInstance()
        }

        return FiltersResponse
            .newBuilder()
            .addAllFilters(screenFilters + storedFilters)
            .build()
    }

    suspend fun getSearchFilters(sourceId: Long): FiltersResponse =
        withSource<CatalogueSource, FiltersResponse>(sourceId) { source ->
            val filters =
                source
                    .getFilterList()
                    .mapIndexedNotNull { index, filter ->
                        runCatching { encodeSearchFilterDefinition(index, filter) }.getOrElse {
                            logger.warn(it) { "Failed to serialize search filter $index for source $sourceId" }
                            null
                        }
                    }

            FiltersResponse
                .newBuilder()
                .addAllFilters(filters)
                .build()
        }

    suspend fun setPreference(
        sourceId: Long,
        key: String,
        value: String,
    ) {
        if (isDeletePreferencePayload(value)) {
            ConfigManager.removeSourcePreference(sourceId, key)

            val source = sourceMap[sourceId]
            if (source is ConfigurableSource) {
                source
                    .getSourcePreferences()
                    .edit()
                    .remove(key)
                    .apply()
            }
            appliedPreferenceHashes[sourceId] = ConfigManager.config.sourcePreferencesFor(sourceId).hashCode()

            logger.debug { "Removed preference: source=$sourceId key=$key" }
            return
        }

        val prefValue = parseStoredPreferenceValue(value)
        ConfigManager.setSourcePreference(sourceId, key, prefValue)

        // Apply immediately
        val source = sourceMap[sourceId]
        if (source is ConfigurableSource) {
            val editor = source.getSourcePreferences().edit()
            when (prefValue) {
                is PreferenceValue.BooleanValue -> editor.putBoolean(key, prefValue.value)
                is PreferenceValue.IntValue -> editor.putInt(key, prefValue.value)
                is PreferenceValue.LongValue -> editor.putLong(key, prefValue.value)
                is PreferenceValue.FloatValue -> editor.putFloat(key, prefValue.value)
                is PreferenceValue.StringSetValue -> editor.putStringSet(key, prefValue.value)
                is PreferenceValue.StringValue -> editor.putString(key, prefValue.value)
            }
            editor.apply()
        }
        appliedPreferenceHashes[sourceId] = ConfigManager.config.sourcePreferencesFor(sourceId).hashCode()

        logger.debug { "Set preference: source=$sourceId key=$key" }
    }

    private fun isDeletePreferencePayload(raw: String): Boolean {
        val parsed = runCatching { Json.parseToJsonElement(raw) }.getOrNull() as? JsonObject ?: return false
        val marker = parsed[DELETE_PREFERENCE_MARKER] as? JsonPrimitive ?: return false
        return marker.booleanOrNull == true
    }

    suspend fun cleanup() {
        logger.info { "Cleaning up..." }
        ConfigManager.config.extensions.forEach { ext ->
            ext.jarName?.let { jarName ->
                loader.unloadJar(extensionsDir.resolve(jarName))
            }
        }
        sourceMap.clear()
        sourceToPackage.clear()
        appliedPreferenceHashes.clear()
    }

    private suspend fun loadExtension(ext: BridgeConfig.InstalledExtension) {
        val jarName = ext.jarName ?: "${ext.packageName}-v${ext.version}.jar"
        val jarPath = extensionsDir.resolve(jarName)

        require(jarPath.exists()) { "Jar not found: $jarPath" }

        val metadata =
            ExtensionLoader.ExtensionMetadata(
                packageName = ext.packageName,
                sourceClassName = ext.sourceClassName,
                factoryClassName = ext.factoryClassName,
            )

        val sources = loader.instantiate(metadata, jarPath)

        sources.forEach { source ->
            sourceMap[source.id] = source
            sourceToPackage[source.id] = ext.packageName

            if (source is ConfigurableSource) {
                applyPreferences(source)
            }
        }
    }

    private suspend inline fun <reified T : Source, R> withSource(
        sourceId: Long,
        crossinline block: suspend (T) -> R,
    ): R {
        val source =
            sourceMap[sourceId] as? T
                ?: throw IllegalArgumentException("Source $sourceId not found or wrong type")

        if (source is ConfigurableSource) {
            applyPreferences(source)
            syncRuntimePreferences(source)
        }

        val packageName = sourceToPackage[sourceId]
        val useProxy =
            packageName?.let {
                ConfigManager.config.findExtension(it)?.useProxy
            } ?: false

        return if (useProxy) {
            val proxy = ConfigManager.config.proxy
            val proxySettings =
                BridgeProxySettings(
                    hostname = proxy.hostname,
                    port = proxy.port,
                    username = proxy.username,
                    password = proxy.password,
                    ignoredAddresses = proxy.ignoredAddresses,
                    bypassLocalAddresses = proxy.bypassLocalAddresses,
                )
            if (proxySettings.isConfigured()) {
                BridgeProxyContext.withProxy(proxySettings) {
                    block(source)
                }
            } else {
                block(source)
            }
        } else {
            block(source)
        }
    }

    private suspend fun applyPreferences(source: ConfigurableSource) {
        val prefs = ConfigManager.config.sourcePreferencesFor(source.id)
        val prefsHash = prefs.hashCode()
        if (appliedPreferenceHashes[source.id] == prefsHash) {
            return
        }
        if (prefs.isEmpty()) {
            appliedPreferenceHashes[source.id] = prefsHash
            return
        }

        val editor = source.getSourcePreferences().edit()
        prefs.forEach { (key, value) ->
            when (value) {
                is PreferenceValue.BooleanValue -> editor.putBoolean(key, value.value)
                is PreferenceValue.IntValue -> editor.putInt(key, value.value)
                is PreferenceValue.LongValue -> editor.putLong(key, value.value)
                is PreferenceValue.FloatValue -> editor.putFloat(key, value.value)
                is PreferenceValue.StringSetValue -> editor.putStringSet(key, value.value)
                is PreferenceValue.StringValue -> editor.putString(key, value.value)
            }
        }
        editor.apply()
        appliedPreferenceHashes[source.id] = prefsHash
    }

    private fun syncRuntimePreferences(source: ConfigurableSource) {
        if (!libGroupSupport.isLibGroupSource(source)) return

        val sourcePrefs = source.getSourcePreferences()
        val apiDomain = sourcePrefs.getString("MangaLibApiDomain", null)?.trim().orEmpty()
        if (apiDomain.isNotBlank()) {
            setSourceField(source, "apiDomain", apiDomain)
        }

        val siteDomain = sourcePrefs.getString("Домен", null)?.trim().orEmpty()
        if (siteDomain.isNotBlank()) {
            setSourceField(source, "domain", siteDomain)
            setSourceField(source, "baseUrl", siteDomain)
        }
    }

    private fun setSourceField(
        source: Source,
        fieldName: String,
        value: String,
    ) {
        var currentClass: Class<*>? = source.javaClass
        while (currentClass != null) {
            val field =
                runCatching { currentClass.getDeclaredField(fieldName) }
                    .getOrNull()
            if (field != null) {
                runCatching {
                    field.isAccessible = true
                    field.set(source, value)
                }.onFailure {
                    logger.debug(it) {
                        "Failed to sync field '$fieldName' for ${source.javaClass.name}"
                    }
                }
                return
            }
            currentClass = currentClass.superclass
        }
    }

    private suspend fun buildDownloadUrl(
        repoUrl: String,
        apkName: String,
    ): String =
        runCatching {
            val uri = java.net.URI(repoUrl)
            val parent = uri.resolve(".")
            parent.resolve("apk/$apkName").toString()
        }.getOrElse {
            val base = repoUrl.substringBeforeLast('/')
            "$base/apk/$apkName"
        }

    private suspend fun purgeOldJars(
        packageName: String,
        currentJar: Path,
    ) {
        if (!Files.exists(extensionsDir)) return

        val currentName = currentJar.fileName.toString()
        Files
            .newDirectoryStream(extensionsDir) { path ->
                Files.isRegularFile(path) &&
                    path.fileName.toString().startsWith(packageName) &&
                    path.fileName.toString().endsWith(".jar") &&
                    path.fileName.toString() != currentName
            }.use { stream ->
                stream.forEach { path ->
                    runCatching { Files.deleteIfExists(path) }
                        .onFailure { logger.warn(it) { "Failed to delete old jar: ${path.fileName}" } }
                }
            }
    }

    private suspend fun convertTitlesPage(page: MangasPage) =
        TitlesPageResponse
            .newBuilder()
            .addAllTitles(page.mangas.map { convertManga(it) })
            .setHasNextPage(page.hasNextPage)
            .build()

    private suspend fun convertManga(
        manga: SManga,
        fallbackUrl: String = "",
    ) =
        Title
            .newBuilder()
            .setUrl(safeMangaUrl(manga, fallbackUrl))
            .setTitle(safeMangaTitle(manga, fallbackUrl))
            .setArtist(safeString { manga.artist })
            .setAuthor(safeString { manga.author })
            .setDescription(safeString { manga.description })
            .setGenre(safeString { manga.genre })
            .setStatus(safeInt { manga.status })
            .setThumbnailUrl(safeString { manga.thumbnail_url })
            .setInitialized(safeBoolean { manga.initialized })
            .build()

    private suspend fun convertChapter(chapter: SChapter) =
        Chapter
            .newBuilder()
            .setUrl(safeString { chapter.url })
            .setName(safeString { chapter.name })
            .setDateUpload(safeLong { chapter.date_upload })
            .setChapterNumber(safeFloat { chapter.chapter_number })
            .setScanlator(safeString { chapter.scanlator })
            .build()

    private fun safeMangaUrl(manga: SManga, fallbackUrl: String): String =
        safeString { manga.url }.ifBlank { fallbackUrl }

    private fun safeMangaTitle(manga: SManga, fallbackUrl: String): String =
        safeString { manga.title }.ifBlank {
            val raw = safeMangaUrl(manga, fallbackUrl).substringAfterLast('/')
            raw.split("--")
                .lastOrNull()
                ?.replace('-', ' ')
                ?.replace('_', ' ')
                ?.trim()
                ?.ifBlank { "Unknown title" }
                ?: "Unknown title"
        }

    private fun safeString(block: () -> String?): String =
        runCatching { block().orEmpty() }.getOrDefault("")

    private fun safeInt(block: () -> Int): Int =
        runCatching { block() }.getOrDefault(0)

    private fun safeLong(block: () -> Long): Long =
        runCatching { block() }.getOrDefault(0L)

    private fun safeFloat(block: () -> Float): Float =
        runCatching { block() }.getOrDefault(0f)

    private fun safeBoolean(block: () -> Boolean): Boolean =
        runCatching { block() }.getOrDefault(false)
}

data class PageImagePayload(
    val contentType: String,
    val bytes: ByteArray,
)
