package mangarr.tachibridge.extensions

import android.app.Application
import androidx.preference.CheckBoxPreference
import androidx.preference.DialogPreference
import androidx.preference.EditTextPreference
import androidx.preference.ListPreference
import androidx.preference.MultiSelectListPreference
import androidx.preference.Preference
import androidx.preference.PreferenceScreen
import androidx.preference.SwitchPreferenceCompat
import androidx.preference.TwoStatePreference
import eu.kanade.tachiyomi.network.BridgeProxyContext
import eu.kanade.tachiyomi.network.BridgeProxySettings
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.ConfigurableSource
import eu.kanade.tachiyomi.source.Source
import eu.kanade.tachiyomi.source.online.HttpSource
import eu.kanade.tachiyomi.source.model.Page as SourcePage
import eu.kanade.tachiyomi.source.model.Filter as SourceFilter
import eu.kanade.tachiyomi.source.model.FilterList
import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
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
    companion object {
        const val DELETE_PREFERENCE_MARKER = "__mangarr_delete_preference__"
    }

    private val libGroupRetryDelaysMs = listOf(0L, 2_000L, 6_000L)

    private val sourceMap = ConcurrentHashMap<Long, Source>()
    private val sourceToPackage = ConcurrentHashMap<Long, String>()
    private val appliedPreferenceHashes = ConcurrentHashMap<Long, Int>()
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
                logger.info { "Initializing extension manager..." }

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

        val repoEntry =
            repoService.findByPackage(packageName, forceRefresh = true)
                ?: throw IllegalArgumentException("Not found in repo: $packageName")

        check(repoEntry.version != installed.version) { "Already up to date: $packageName" }

        uninstall(packageName)
        return installFromRepo(packageName)
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
            applySearchFilters(filterList, searchFilters)
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
            var normalizedUrl = normalizeSourceUrl(source, mangaUrl)
            if (isLibGroupSource(source)) {
                val fallback = fetchLibGroupMangaDetailsFallback(source, normalizedUrl)
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
                    val resolvedUrl = resolveLibGroupCanonicalUrl(source, normalizedUrl, error)
                    if (resolvedUrl != null) {
                        normalizedUrl = resolvedUrl
                        manga = SManga.create().apply { url = normalizedUrl }
                        logger.info {
                            "Retrying LibGroup details with canonical url source=${source.id} url=$normalizedUrl"
                        }
                        source.getMangaDetails(manga)
                    } else {
                        val fallback = fetchLibGroupMangaDetailsFallback(source, normalizedUrl)
                        if (fallback != null) {
                            logger.info {
                                "Using LibGroup details fallback for source=${source.id} url=$normalizedUrl"
                            }
                            fallback
                        } else {
                            throw decorateLibGroupError(source, error)
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
            var normalizedUrl = normalizeSourceUrl(source, mangaUrl)
            if (isLibGroupSource(source)) {
                val fallback = fetchLibGroupChapterListFallback(source, normalizedUrl)
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
                    val resolvedUrl = resolveLibGroupCanonicalUrl(source, normalizedUrl, error)
                    if (resolvedUrl != null) {
                        normalizedUrl = resolvedUrl
                        manga = SManga.create().apply { url = normalizedUrl }
                        try {
                            source.getChapterList(manga).reversed()
                        } catch (resolvedError: Exception) {
                            fetchLibGroupChapterListFallback(source, normalizedUrl)
                                ?: throw decorateLibGroupError(source, resolvedError)
                        }
                    } else {
                        fetchLibGroupChapterListFallback(source, normalizedUrl) ?: throw decorateLibGroupError(source, error)
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
            val normalizedUrl = normalizeSourceUrl(source, chapterUrl)
            val pages =
                if (isLibGroupSource(source)) {
                    val fallbackPages = fetchLibGroupPagesFallback(source, normalizedUrl)
                    if (!fallbackPages.isNullOrEmpty()) {
                        fallbackPages
                    } else {
                        val chapter = SChapter.create().apply { url = normalizedUrl }
                        try {
                            source.getPageList(chapter)
                        } catch (error: Exception) {
                            fallbackPages ?: throw decorateLibGroupError(source, error)
                        }
                    }
                } else {
                    val chapter = SChapter.create().apply { url = normalizedUrl }
                    try {
                        source.getPageList(chapter)
                    } catch (error: Exception) {
                        fetchLibGroupPagesFallback(source, normalizedUrl) ?: throw decorateLibGroupError(source, error)
                    }
                }
            val resolvedPages = mutableListOf<Page>()
            for ((index, page) in pages.withIndex()) {
                val pageUrl = safeString { page.url }
                val pageImageUrl = resolvePageImageUrl(source, page)
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
                            val type = preferenceType(preference)
                            val data = encodePreference(preference, type)

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
                .map { (key, value) -> encodeStoredPreference(key, value) }
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
                        runCatching { encodeSearchFilter(index, filter) }.getOrElse {
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

        val prefValue = parsePreferenceValue(value)
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
        if (!isLibGroupSource(source)) return

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

    private fun applySearchFilters(
        filterList: FilterList,
        searchFilters: Map<String, String>,
    ) {
        if (searchFilters.isEmpty()) return

        filterList.forEachIndexed { index, filter ->
            val key = "search_$index"
            val raw = searchFilters[key] ?: return@forEachIndexed
            val parsed = runCatching { Json.parseToJsonElement(raw) }.getOrNull() ?: return@forEachIndexed

            when (filter) {
                is SourceFilter.Text -> {
                    val text = (parsed as? JsonPrimitive)?.contentOrNull ?: return@forEachIndexed
                    filter.state = text
                }

                is SourceFilter.CheckBox -> {
                    val bool = (parsed as? JsonPrimitive)?.booleanOrNull ?: return@forEachIndexed
                    filter.state = bool
                }

                is SourceFilter.TriState -> {
                    val value = parseIntValue(parsed) ?: return@forEachIndexed
                    filter.state = value.coerceIn(
                        SourceFilter.TriState.STATE_IGNORE,
                        SourceFilter.TriState.STATE_EXCLUDE,
                    )
                }

                is SourceFilter.Select<*> -> {
                    val value = parseIntValue(parsed) ?: return@forEachIndexed
                    val maxIndex = (filter.values.size - 1).coerceAtLeast(0)
                    filter.state = value.coerceIn(0, maxIndex)
                }

                is SourceFilter.Sort -> {
                    val token = (parsed as? JsonPrimitive)?.contentOrNull ?: return@forEachIndexed
                    val parts = token.split(":")
                    val selectedIndex = parts.getOrNull(0)?.toIntOrNull() ?: return@forEachIndexed
                    val ascending = parts.getOrNull(1) != "desc"
                    if (selectedIndex in filter.values.indices) {
                        filter.state = SourceFilter.Sort.Selection(selectedIndex, ascending)
                    }
                }

                is SourceFilter.Group<*> -> {
                    val selected =
                        (parsed as? JsonArray)
                            ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.toIntOrNull() }
                            ?.toSet()
                            ?: return@forEachIndexed

                    @Suppress("UNCHECKED_CAST")
                    val groupItems = filter.state as? List<Any> ?: return@forEachIndexed
                    groupItems.forEachIndexed { itemIndex, item ->
                        if (item is SourceFilter.CheckBox) {
                            item.state = selected.contains(itemIndex)
                        }
                    }
                }

                else -> Unit
            }
        }
    }

    private fun encodeSearchFilter(
        index: Int,
        filter: SourceFilter<*>,
    ): Filter {
        val key = "search_$index"
        val payload =
            buildJsonObject {
                put("key", key)
                put("title", filter.name)
                put("enabled", true)
                put("visible", true)

                when (filter) {
                    is SourceFilter.Text -> {
                        put("type", "text")
                        put("default_value", JsonPrimitive(""))
                        put("current_value", JsonPrimitive(filter.state))
                    }

                    is SourceFilter.CheckBox -> {
                        put("type", "toggle")
                        put("default_value", JsonPrimitive(false))
                        put("current_value", JsonPrimitive(filter.state))
                    }

                    is SourceFilter.TriState -> {
                        put("type", "list")
                        putJsonArray("entries") {
                            add(JsonPrimitive("Ignore"))
                            add(JsonPrimitive("Include"))
                            add(JsonPrimitive("Exclude"))
                        }
                        putJsonArray("entry_values") {
                            add(JsonPrimitive("0"))
                            add(JsonPrimitive("1"))
                            add(JsonPrimitive("2"))
                        }
                        put("default_value", JsonPrimitive("0"))
                        put("current_value", JsonPrimitive(filter.state.toString()))
                    }

                    is SourceFilter.Select<*> -> {
                        put("type", "list")
                        putJsonArray("entries") {
                            filter.values.forEach { add(JsonPrimitive(it.toString())) }
                        }
                        putJsonArray("entry_values") {
                            filter.values.indices.forEach { add(JsonPrimitive(it.toString())) }
                        }
                        put("default_value", JsonPrimitive("0"))
                        put("current_value", JsonPrimitive(filter.state.toString()))
                    }

                    is SourceFilter.Sort -> {
                        put("type", "list")
                        putJsonArray("entries") {
                            filter.values.forEach { value ->
                                add(JsonPrimitive("${value} (Asc)"))
                                add(JsonPrimitive("${value} (Desc)"))
                            }
                        }
                        putJsonArray("entry_values") {
                            filter.values.indices.forEach { idx ->
                                add(JsonPrimitive("$idx:asc"))
                                add(JsonPrimitive("$idx:desc"))
                            }
                        }
                        val current =
                            filter.state?.let { "${it.index}:${if (it.ascending) "asc" else "desc"}" } ?: "0:asc"
                        put("default_value", JsonPrimitive("0:asc"))
                        put("current_value", JsonPrimitive(current))
                    }

                    is SourceFilter.Group<*> -> {
                        @Suppress("UNCHECKED_CAST")
                        val groupItems = filter.state as? List<Any> ?: emptyList()
                        put("type", "multi_select")
                        putJsonArray("entries") {
                            groupItems.forEach { item ->
                                val label =
                                    when (item) {
                                        is SourceFilter<*> -> item.name
                                        else -> item.toString()
                                    }
                                add(JsonPrimitive(label))
                            }
                        }
                        putJsonArray("entry_values") {
                            groupItems.indices.forEach { add(JsonPrimitive(it.toString())) }
                        }
                        val selected =
                            groupItems.mapIndexedNotNull { itemIndex, item ->
                                if (item is SourceFilter.CheckBox && item.state) {
                                    itemIndex.toString()
                                } else {
                                    null
                                }
                            }
                        put("default_value", JsonArray(emptyList()))
                        put("current_value", JsonArray(selected.map { JsonPrimitive(it) }))
                    }

                    is SourceFilter.Header, is SourceFilter.Separator -> {
                        put("type", "text")
                        put("enabled", false)
                        put("visible", false)
                        put("default_value", JsonPrimitive(""))
                        put("current_value", JsonPrimitive(""))
                    }

                    else -> {
                        put("type", "text")
                        put("default_value", JsonPrimitive(""))
                        put("current_value", JsonPrimitive(filter.state?.toString() ?: ""))
                    }
                }
            }

        return Filter
            .newBuilder()
            .setName(filter.name)
            .setType(payload["type"]?.jsonPrimitive?.content ?: "text")
            .setData(Json.encodeToString(JsonElement.serializer(), payload))
            .build()
    }

    private fun parseIntValue(value: JsonElement): Int? =
        when (value) {
            is JsonPrimitive -> value.intOrNull ?: value.contentOrNull?.toIntOrNull()
            else -> null
        }

    private fun preferenceType(preference: Preference): String =
        when (preference) {
            is ListPreference -> "list"
            is MultiSelectListPreference -> "multi_select"
            is SwitchPreferenceCompat, is CheckBoxPreference, is TwoStatePreference -> "toggle"
            is EditTextPreference -> "text"
            else -> "text"
        }

    private fun encodePreference(
        preference: Preference,
        type: String,
    ): String {
        val defaultValue = runCatching { preference.defaultValue }.getOrNull()
        val currentValue = runCatching { preference.currentValue }.getOrNull()

        val payload =
            buildJsonObject {
                put("key", preference.key ?: "")
                put("title", preference.title?.toString() ?: preference.key ?: "Preference")
                put("summary", preference.summary?.toString() ?: "")
                put("type", type)
                put("enabled", preference.isEnabled)
                put("visible", preference.visible)
                put("default_value", toJsonElement(defaultValue))
                put("current_value", toJsonElement(currentValue))

                if (preference is ListPreference) {
                    putJsonArray("entries") {
                        preference.entries?.forEach { add(JsonPrimitive(it.toString())) }
                    }
                    putJsonArray("entry_values") {
                        preference.entryValues?.forEach { add(JsonPrimitive(it.toString())) }
                    }
                }

                if (preference is MultiSelectListPreference) {
                    putJsonArray("entries") {
                        preference.entries?.forEach { add(JsonPrimitive(it.toString())) }
                    }
                    putJsonArray("entry_values") {
                        preference.entryValues?.forEach { add(JsonPrimitive(it.toString())) }
                    }
                }

                if (preference is DialogPreference) {
                    put("dialog_title", preference.dialogTitle?.toString() ?: "")
                    put("dialog_message", preference.dialogMessage?.toString() ?: "")
                }
            }

        return Json.encodeToString(JsonElement.serializer(), payload)
    }

    private fun encodeStoredPreference(
        key: String,
        value: PreferenceValue,
    ): Filter {
        val payload =
            buildJsonObject {
                put("key", key)
                put("title", key)
                put("summary", "Imported storage value")
                put("type", "text")
                put("enabled", true)
                put("visible", false)
                put("default_value", JsonNull)
                put("current_value", preferenceValueToJsonElement(value))
            }

        return Filter
            .newBuilder()
            .setName(key)
            .setType("text")
            .setData(Json.encodeToString(JsonElement.serializer(), payload))
            .build()
    }

    private fun preferenceValueToJsonElement(value: PreferenceValue): JsonElement =
        when (value) {
            is PreferenceValue.BooleanValue -> JsonPrimitive(value.value)
            is PreferenceValue.IntValue -> JsonPrimitive(value.value)
            is PreferenceValue.LongValue -> JsonPrimitive(value.value)
            is PreferenceValue.FloatValue -> JsonPrimitive(value.value)
            is PreferenceValue.StringValue -> JsonPrimitive(value.value)
            is PreferenceValue.StringSetValue -> JsonArray(value.value.map { JsonPrimitive(it) })
        }

    private fun toJsonElement(value: Any?): JsonElement =
        when (value) {
            null -> {
                JsonNull
            }

            is String -> {
                JsonPrimitive(value)
            }

            is Boolean -> {
                JsonPrimitive(value)
            }

            is Number -> {
                JsonPrimitive(value)
            }

            is Set<*> -> {
                val entries = value.map { it.toString() }
                JsonArray(entries.map { JsonPrimitive(it) })
            }

            is Collection<*> -> {
                JsonArray(value.map { toJsonElement(it) })
            }

            is Array<*> -> {
                JsonArray(value.map { toJsonElement(it) })
            }

            else -> {
                JsonPrimitive(value.toString())
            }
        }

    private fun parsePreferenceValue(raw: String): PreferenceValue {
        val parsed =
            runCatching { Json.parseToJsonElement(raw) }.getOrNull()
                ?: return parsePrimitiveFallback(raw)

        return when (parsed) {
            is JsonArray -> {
                PreferenceValue.StringSetValue(
                    parsed
                        .mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
                        .toSet(),
                )
            }

            is JsonPrimitive -> {
                val content = parsed.contentOrNull ?: raw
                val boolValue = parsed.booleanOrNull
                val longValue = parsed.longOrNull
                val doubleValue = parsed.doubleOrNull
                when {
                    parsed.isString -> {
                        PreferenceValue.StringValue(content)
                    }

                    boolValue != null -> {
                        PreferenceValue.BooleanValue(boolValue)
                    }

                    longValue != null && longValue in Int.MIN_VALUE..Int.MAX_VALUE -> {
                        PreferenceValue.IntValue(longValue.toInt())
                    }

                    longValue != null -> {
                        PreferenceValue.LongValue(longValue)
                    }

                    doubleValue != null -> {
                        PreferenceValue.FloatValue(doubleValue.toFloat())
                    }

                    else -> {
                        PreferenceValue.StringValue(content)
                    }
                }
            }

            else -> {
                PreferenceValue.StringValue(raw)
            }
        }
    }

    private fun parsePrimitiveFallback(raw: String): PreferenceValue {
        val value = raw.trim()
        return when {
            value.equals("true", ignoreCase = true) -> PreferenceValue.BooleanValue(true)
            value.equals("false", ignoreCase = true) -> PreferenceValue.BooleanValue(false)
            value.toIntOrNull() != null -> PreferenceValue.IntValue(value.toInt())
            value.toLongOrNull() != null -> PreferenceValue.LongValue(value.toLong())
            value.toFloatOrNull() != null -> PreferenceValue.FloatValue(value.toFloat())
            else -> PreferenceValue.StringValue(raw)
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

    private fun decorateLibGroupError(
        source: Source,
        error: Exception,
    ): Exception {
        if (!isLibGroupSource(source)) return error

        val packageName = sourceToPackage[source.id].orEmpty()
        val message = error.message.orEmpty()
        if (packageName.contains("hentailib", ignoreCase = true)) {
            if (message.contains("HTTP error 403", ignoreCase = true)) {
                return IllegalStateException(
                    "HentaiLib API is blocked (HTTP 403). Verify selected API domain and proxy, " +
                        "then retry after WebView authorization.",
                    error,
                )
            }
            if (message.contains("HTTP error 404", ignoreCase = true)) {
                return IllegalStateException(
                    "HentaiLib title URL was rejected by API (HTTP 404). " +
                        "Check configured API domain and retry title refresh.",
                    error,
                )
            }
        }

        return error
    }

    private fun normalizeSourceUrl(
        source: Source,
        rawUrl: String,
    ): String {
        val trimmed = rawUrl.trim()
        val isLibGroupFamily = isLibGroupSource(source)
        if (!isLibGroupFamily) {
            return trimmed
        }

        val normalized = stripSchemeAndHost(trimmed).trim()
        if (normalized.isBlank()) return normalized

        // LibGroup sources expect canonical relative URLs like:
        //   /slug--name
        //   /slug--name/chapters/1-1
        // Normalizing to "manga/..." breaks their internal request builders.
        val withLeadingSlash =
            if (normalized.startsWith("/")) {
                normalized
            } else {
                "/$normalized"
            }

        return withLeadingSlash.replace(Regex("^/manga/"), "/")
    }

    private fun isLibGroupSource(source: Source): Boolean =
        generateSequence(source.javaClass as Class<*>?) { it.superclass }
            .map { it.name.lowercase() }
            .any { it.contains("multisrc.libgroup") }

    private suspend fun fetchLibGroupMangaDetailsFallback(
        source: Source,
        normalizedUrl: String,
    ): SManga? {
        if (!isLibGroupSource(source)) return null

        val slug = extractLibGroupSlug(normalizedUrl)
        if (slug.isBlank()) return null

        val baseApi = libGroupBaseApi(source)
        val fields =
            listOf(
                "eng_name",
                "otherNames",
                "summary",
                "rate",
                "genres",
                "tags",
                "teams",
                "authors",
                "publisher",
                "userRating",
                "manga_status_id",
                "status_id",
                "artists",
            ).joinToString("&") { "fields[]=${URLEncoder.encode(it, Charsets.UTF_8)}" }
        val url = "${baseApi.removeSuffix("/")}/api/manga/$slug?$fields"

        val root = fetchLibGroupJsonObject(url) ?: return null
        val data = root["data"]?.jsonObject ?: return null
        if (data["toast"] != null || data["message"] != null) {
            return null
        }

        val fallback = SManga.create()
        fallback.url = normalizedUrl
        fallback.title =
            data["rus_name"]?.jsonPrimitive?.contentOrNull
                ?: data["name"]?.jsonPrimitive?.contentOrNull
                ?: data["eng_name"]?.jsonPrimitive?.contentOrNull
                ?: slug
        fallback.description = data["summary"]?.jsonPrimitive?.contentOrNull.orEmpty()
        fallback.author = data["authors"]?.jsonArray?.firstOrNull()?.jsonObject?.get("name")?.jsonPrimitive?.contentOrNull
        fallback.artist = data["artists"]?.jsonArray?.firstOrNull()?.jsonObject?.get("name")?.jsonPrimitive?.contentOrNull
        fallback.genre =
            data["genres"]?.jsonArray
                ?.mapNotNull { item -> item.jsonObject["name"]?.jsonPrimitive?.contentOrNull }
                ?.joinToString(", ")
                .orEmpty()
        fallback.thumbnail_url = data["cover"]?.jsonObject?.get("default")?.jsonPrimitive?.contentOrNull.orEmpty()
        return fallback
    }

    private suspend fun resolveLibGroupCanonicalUrl(
        source: Source,
        normalizedUrl: String,
        error: Exception,
    ): String? {
        if (!isLibGroupSource(source)) return null
        val message = error.message.orEmpty()
        if (!message.contains("URL серии изменился", ignoreCase = true)) return null

        val slug = extractLibGroupSlug(normalizedUrl)
        if (slug.isBlank()) return null
        val baseApi = libGroupBaseApi(source)
        val url = "${baseApi.removeSuffix("/")}/api/manga/$slug"
        val root = fetchLibGroupJsonObject(url) ?: return null
        val data = root["data"]?.jsonObject ?: return null
        val canonical = data["slug_url"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().removePrefix("/")
        return canonical.ifBlank { null }
    }

    private suspend fun fetchLibGroupChapterListFallback(
        source: Source,
        normalizedUrl: String,
    ): List<SChapter>? {
        if (!isLibGroupSource(source)) return null
        val slug = resolveCanonicalSlug(source, normalizedUrl) ?: extractLibGroupSlug(normalizedUrl)
        if (slug.isBlank()) return null
        val baseApi = libGroupBaseApi(source)
        val url = "${baseApi.removeSuffix("/")}/api/manga/$slug/chapters?page=1"
        val root = fetchLibGroupJsonObject(url) ?: return null
        val rows = root["data"]?.jsonArray ?: return null
        return rows.mapNotNull { row ->
            val obj = row.jsonObject
            val volume = obj["volume"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            val number = obj["number"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            if (volume.isBlank() || number.isBlank()) return@mapNotNull null
            val branchObj = obj["branches"]?.jsonArray?.firstOrNull()?.jsonObject
            val branchId = branchObj?.get("id")?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            val chapter = SChapter.create()
            val branchPart =
                branchId
                    .takeIf { it.isNotBlank() }
                    ?.let { "&branch_id=${URLEncoder.encode(it, Charsets.UTF_8)}" }
                    .orEmpty()
            chapter.url =
                "/$slug/chapter?" +
                    "$branchPart&volume=${URLEncoder.encode(volume, Charsets.UTF_8)}" +
                    "&number=${URLEncoder.encode(number, Charsets.UTF_8)}"
            chapter.name = obj["name"]?.jsonPrimitive?.contentOrNull.orEmpty().ifBlank { "Chapter $number" }
            chapter.chapter_number = number.toFloatOrNull() ?: 0f
            chapter.date_upload =
                obj["created_at"]?.jsonPrimitive?.contentOrNull
                    ?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
                    ?: 0L
            chapter.scanlator =
                branchObj
                    ?.get("teams")
                    ?.jsonArray
                    ?.firstOrNull()
                    ?.jsonObject
                    ?.get("name")
                    ?.jsonPrimitive
                    ?.contentOrNull
            chapter
        }
    }

    private suspend fun fetchLibGroupPagesFallback(
        source: Source,
        chapterUrl: String,
    ): List<SourcePage>? {
        if (!isLibGroupSource(source)) return null
        val chapterRef = parseLibGroupChapterRef(chapterUrl) ?: return null
        val slug =
            resolveCanonicalSlug(source, "/${chapterRef.slug}")
                ?.takeIf { it.isNotBlank() }
                ?: chapterRef.slug
        val volume = chapterRef.volume
        val number = chapterRef.number
        val branchId = chapterRef.branchId
        val baseApi = libGroupBaseApi(source)
        val url =
            buildString {
                append(baseApi.removeSuffix("/"))
                append("/api/manga/")
                append(slug)
                append("/chapter?volume=")
                append(URLEncoder.encode(volume, Charsets.UTF_8))
                append("&number=")
                append(URLEncoder.encode(number, Charsets.UTF_8))
                if (branchId != null) {
                    append("&branch_id=")
                    append(URLEncoder.encode(branchId, Charsets.UTF_8))
                }
            }
        val root = fetchLibGroupJsonObject(url) ?: return null
        val chapterData = root["data"]?.jsonObject ?: return null
        val pages = chapterData["pages"]?.jsonArray ?: return null
        return pages.mapIndexedNotNull { index, page ->
            val obj = page.jsonObject
            val path = obj["url"]?.jsonPrimitive?.contentOrNull ?: return@mapIndexedNotNull null
            val normalizedPath =
                if (path.startsWith("//")) {
                    "/" + path.removePrefix("//")
                } else {
                    path
                }
            SourcePage(index, normalizedPath, "")
        }
    }

    private suspend fun resolveCanonicalSlug(
        source: Source,
        normalizedUrl: String,
    ): String? {
        val slug = extractLibGroupSlug(normalizedUrl)
        if (slug.isBlank()) return null
        val baseApi = libGroupBaseApi(source)
        val root = fetchLibGroupJsonObject("${baseApi.removeSuffix("/")}/api/manga/$slug") ?: return null
        val data = root["data"]?.jsonObject ?: return null
        return data["slug_url"]?.jsonPrimitive?.contentOrNull?.removePrefix("/")?.trim()?.ifBlank { null }
    }

    private fun extractLibGroupSlug(rawUrl: String): String =
        stripSchemeAndHost(rawUrl)
            .trim()
            .removePrefix("/")
            .removePrefix("manga/")
            .substringBefore('?')
            .trim()

    private fun stripSchemeAndHost(rawUrl: String): String {
        val trimmed = rawUrl.trim()
        if (
            trimmed.startsWith("http://", ignoreCase = true) ||
            trimmed.startsWith("https://", ignoreCase = true)
        ) {
            return trimmed.substringAfter("://", trimmed).substringAfter('/', "")
        }
        return trimmed
    }

    private fun libGroupBaseApi(source: Source): String {
        val sourceConfigured =
            (source as? ConfigurableSource)
                ?.getSourcePreferences()
                ?.getString("MangaLibApiDomain", null)
                ?.trim()
                ?.ifBlank { null }
        if (sourceConfigured != null) {
            return sourceConfigured
        }

        val configConfigured =
            (ConfigManager.config.sourcePreferencesFor(source.id)["MangaLibApiDomain"] as? PreferenceValue.StringValue)
                ?.value
                ?.trim()
                ?.ifBlank { null }
        if (configConfigured != null) {
            return configConfigured
        }

        val packageName = sourceToPackage[source.id].orEmpty()
        return if (packageName.contains("hentailib")) {
            "https://hapi.hentaicdn.org"
        } else {
            "https://api2.mangalib.me"
        }
    }

    private suspend fun fetchLibGroupJsonObject(url: String): JsonObject? {
        val responseBody = fetchLibGroupResponseBody(url) ?: return null
        return runCatching { Json.parseToJsonElement(responseBody).jsonObject }
            .onFailure { logger.warn(it) { "Failed to parse libgroup response from $url" } }
            .getOrNull()
    }

    private suspend fun fetchLibGroupResponseBody(
        url: String,
    ): String? {
        for ((attemptIndex, delayMs) in libGroupRetryDelaysMs.withIndex()) {
            if (delayMs > 0) {
                delay(delayMs)
            }

            try {
                val responseBody =
                    networkHelper.client
                        .newCall(GET(url))
                        .execute()
                        .use { response ->
                            if (!response.isSuccessful) {
                                val shouldRetry = response.code == 429 || response.code in 500..599
                                if (shouldRetry && attemptIndex < libGroupRetryDelaysMs.lastIndex) {
                                    logger.warn {
                                        "Libgroup request failed with HTTP ${response.code} for $url " +
                                            "(attempt ${attemptIndex + 1}/${libGroupRetryDelaysMs.size}), retrying"
                                    }
                                }
                                return@use null
                            }
                            response.body?.string()
                        }

                if (!responseBody.isNullOrBlank()) {
                    return responseBody
                }
            } catch (e: SocketTimeoutException) {
                if (attemptIndex < libGroupRetryDelaysMs.lastIndex) {
                    logger.warn {
                        "Libgroup request timed out for $url " +
                            "(attempt ${attemptIndex + 1}/${libGroupRetryDelaysMs.size}), retrying"
                    }
                    continue
                }
                logger.warn(e) { "Libgroup request timed out for $url after ${attemptIndex + 1} attempts" }
            } catch (e: IOException) {
                if (attemptIndex < libGroupRetryDelaysMs.lastIndex) {
                    logger.warn {
                        "Libgroup request failed for $url: ${e.message.orEmpty()} " +
                            "(attempt ${attemptIndex + 1}/${libGroupRetryDelaysMs.size}), retrying"
                    }
                    continue
                }
                logger.warn(e) { "Libgroup request failed for $url after ${attemptIndex + 1} attempts" }
            }
        }

        return null
    }

    private fun parseLibGroupChapterRef(chapterUrl: String): LibGroupChapterRef? {
        val normalizedChapterUrl = chapterUrl.trim()
        val withoutProtocol = normalizedChapterUrl.substringAfter("://", normalizedChapterUrl)
        val pathAndQuery = withoutProtocol.substringAfter('/', withoutProtocol)
        val rawPath = pathAndQuery.substringBefore('?').removePrefix("/")
        val query = normalizedChapterUrl.substringAfter('?', missingDelimiterValue = "")

        val chapterEndpointPath = rawPath.removePrefix("manga/")
        if (chapterEndpointPath.endsWith("/chapter")) {
            val slug = chapterEndpointPath.substringBefore("/chapter").trim()
            if (slug.isBlank()) return null
            val parts =
                query.split('&')
                    .mapNotNull { part ->
                        val idx = part.indexOf('=')
                        if (idx <= 0) {
                            null
                        } else {
                            part.substring(0, idx) to part.substring(idx + 1)
                        }
                    }.toMap()
            val volume =
                (parts["volume"] ?: parts["v"])
                    ?.let { java.net.URLDecoder.decode(it, Charsets.UTF_8) }
                    ?.trim()
                    .orEmpty()
            val number =
                (parts["number"] ?: parts["n"])
                    ?.let { java.net.URLDecoder.decode(it, Charsets.UTF_8) }
                    ?.trim()
                    .orEmpty()
            if (volume.isBlank() || number.isBlank()) return null
            val branchId =
                (parts["branch_id"] ?: parts["b"])
                    ?.let { java.net.URLDecoder.decode(it, Charsets.UTF_8) }
                    ?.trim()
                    ?.takeIf { it.isNotBlank() }
            return LibGroupChapterRef(slug = slug, volume = volume, number = number, branchId = branchId)
        }

        val slugPart = rawPath.substringBefore("/chapters/").removePrefix("manga/").trim()
        val chapterPart = rawPath.substringAfter("/chapters/", "").substringBefore('/').trim()
        if (slugPart.isBlank() || chapterPart.isBlank()) return null

        val separatorIndex = chapterPart.indexOf('-')
        if (separatorIndex <= 0 || separatorIndex >= chapterPart.lastIndex) return null

        val volume = chapterPart.substring(0, separatorIndex).trim()
        val number = chapterPart.substring(separatorIndex + 1).trim()
        if (volume.isBlank() || number.isBlank()) return null

        return LibGroupChapterRef(slug = slugPart, volume = volume, number = number, branchId = null)
    }

    private data class LibGroupChapterRef(
        val slug: String,
        val volume: String,
        val number: String,
        val branchId: String?,
    )

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

    private suspend fun resolvePageImageUrl(source: Source, page: SourcePage): String {
        val explicitImageUrl = safeString { page.imageUrl }
        if (explicitImageUrl.isNotBlank()) {
            return explicitImageUrl
        }

        if (source is HttpSource) {
            val computed = runCatching { source.getImageUrl(page).orEmpty() }.getOrDefault("")
            if (computed.isNotBlank()) {
                return computed
            }
        }

        return ""
    }
}
