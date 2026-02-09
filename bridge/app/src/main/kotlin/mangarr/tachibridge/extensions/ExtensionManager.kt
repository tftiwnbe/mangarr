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
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.ConfigurableSource
import eu.kanade.tachiyomi.source.Source
import eu.kanade.tachiyomi.source.model.FilterList
import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
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
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
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
    private val sourceMap = ConcurrentHashMap<Long, Source>()
    private val sourceToPackage = ConcurrentHashMap<Long, String>()

    init {
        if (!Files.exists(extensionsDir)) {
            Files.createDirectories(extensionsDir)
        }
    }

    suspend fun init() {
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
    }

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
    ): TitlesPageResponse =
        withSource<CatalogueSource, TitlesPageResponse>(sourceId) { source ->
            val result = source.getSearchManga(page, query, FilterList())
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
            val manga = SManga.create().apply { url = mangaUrl }
            val result = source.getMangaDetails(manga)
            TitleResponse
                .newBuilder()
                .setTitle(convertManga(result))
                .build()
        }

    suspend fun getChaptersList(
        sourceId: Long,
        mangaUrl: String,
    ): ChaptersListResponse =
        withSource<Source, ChaptersListResponse>(sourceId) { source ->
            val manga = SManga.create().apply { url = mangaUrl }
            val chapters = source.getChapterList(manga).reversed()
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
            val chapter = SChapter.create().apply { url = chapterUrl }
            val pages = source.getPageList(chapter)
            PagesListResponse
                .newBuilder()
                .addAllPages(
                    pages.mapIndexed { index, page ->
                        Page
                            .newBuilder()
                            .setIndex(index)
                            .setUrl(page.url)
                            .setImageUrl(page.imageUrl ?: "")
                            .build()
                    },
                ).build()
        }

    suspend fun getFilters(sourceId: Long): FiltersResponse {
        val source =
            sourceMap[sourceId] as? ConfigurableSource
                ?: return FiltersResponse.getDefaultInstance()

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

        return FiltersResponse
            .newBuilder()
            .addAllFilters(filters)
            .build()
    }

    suspend fun setPreference(
        sourceId: Long,
        key: String,
        value: String,
    ) {
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

        logger.debug { "Set preference: source=$sourceId key=$key" }
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
        block: (T) -> R,
    ): R {
        val source =
            sourceMap[sourceId] as? T
                ?: throw IllegalArgumentException("Source $sourceId not found or wrong type")

        if (source is ConfigurableSource) {
            applyPreferences(source)
        }

        val packageName = sourceToPackage[sourceId]
        val useProxy =
            packageName?.let {
                ConfigManager.config.findExtension(it)?.useProxy
            } ?: false

        return if (useProxy) {
            // TODO: Implement proxy support via NetworkHelper
            block(source)
        } else {
            block(source)
        }
    }

    private suspend fun applyPreferences(source: ConfigurableSource) {
        val prefs = ConfigManager.config.sourcePreferencesFor(source.id)
        if (prefs.isEmpty()) return

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

    private suspend fun convertManga(manga: SManga) =
        Title
            .newBuilder()
            .setUrl(manga.url)
            .setTitle(manga.title)
            .setArtist(manga.artist ?: "")
            .setAuthor(manga.author ?: "")
            .setDescription(manga.description ?: "")
            .setGenre(manga.genre ?: "")
            .setStatus(manga.status)
            .setThumbnailUrl(manga.thumbnail_url ?: "")
            .setInitialized(manga.initialized)
            .build()

    private suspend fun convertChapter(chapter: SChapter) =
        Chapter
            .newBuilder()
            .setUrl(chapter.url)
            .setName(chapter.name)
            .setDateUpload(chapter.date_upload)
            .setChapterNumber(chapter.chapter_number)
            .setScanlator(chapter.scanlator ?: "")
            .build()
}
