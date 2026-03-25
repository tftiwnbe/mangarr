package mangarr.tachibridge.repo

import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.NetworkHelper
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import okhttp3.Request
import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.io.path.writeText

private val logger = KotlinLogging.logger {}

@Serializable
data class ExtensionRepoEntry(
    val name: String,
    val pkg: String,
    val apk: String,
    val lang: String,
    val version: String,
    val nsfw: Int? = null,
    val sources: List<ExtensionRepoSource> = emptyList(),
)

@Serializable
data class ExtensionRepoSource(
    val id: Long,
    val name: String,
    val lang: String,
    @SerialName("baseUrl")
    val baseUrl: String,
    @SerialName("supports_latest")
    val supportsLatest: Boolean? = null,
)

@Serializable
private data class ExtensionRepoCacheSnapshot(
    val url: String,
    val entries: List<ExtensionRepoEntry>,
)

@kotlinx.serialization.ExperimentalSerializationApi
class ExtensionRepoService(
    private val networkHelper: NetworkHelper,
    initialRepoIndexUrl: String,
    private val cachePath: Path,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {
    @Volatile
    private var repoIndexUrl: String = initialRepoIndexUrl

    @Volatile
    private var cachedIndex: List<ExtensionRepoEntry>? = null

    init {
        loadPersistedIndex()
    }

    fun fetchIndex(forceRefresh: Boolean = false): List<ExtensionRepoEntry> {
        if (!forceRefresh && cachedIndex != null) {
            return cachedIndex!!
        }

        val currentUrl = repoIndexUrl
        validateRepoIndexUrl(currentUrl)

        logger.info { "Fetching extension index from: $currentUrl" }

        val request: Request = GET(currentUrl)
        val entries =
            networkHelper.client
                .newCall(request)
                .execute()
                .use { response ->
                    if (!response.isSuccessful) {
                        throw IOException("Failed to fetch extension index: HTTP ${response.code}")
                    }
                    val body = response.body!!.string()
                    json.decodeFromString(ListSerializer(ExtensionRepoEntry.serializer()), body)
                }

        cachedIndex = entries
        persistIndex(currentUrl, entries)
        logger.info { "Fetched ${entries.size} extensions from repository" }
        return entries
    }

    fun findByPackage(
        pkg: String,
        forceRefresh: Boolean = false,
    ): ExtensionRepoEntry? = fetchIndex(forceRefresh).firstOrNull { it.pkg == pkg }

    fun updateRepoIndexUrl(url: String) {
        validateRepoIndexUrl(url)
        repoIndexUrl = url
        cachedIndex = null // Clear cache when URL changes
        clearPersistedIndex()
        logger.info { "Updated repository index URL to: $url" }
    }

    fun currentRepoIndexUrl(): String = repoIndexUrl

    private fun validateRepoIndexUrl(url: String) {
        if (url.isBlank()) {
            throw InvalidRepoIndexUrlException("Extensions index URL cannot be empty or blank.")
        }

        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            throw InvalidRepoIndexUrlException("Extensions index URL must start with http:// or https://")
        }

        if (!url.endsWith(".json")) {
            throw InvalidRepoIndexUrlException("Extensions index URL must point to a JSON file.")
        }
    }

    private fun loadPersistedIndex() {
        if (repoIndexUrl.isBlank() || !cachePath.exists()) {
            return
        }

        runCatching {
            val snapshot =
                json.decodeFromString(
                    ExtensionRepoCacheSnapshot.serializer(),
                    cachePath.readText(),
                )
            if (snapshot.url == repoIndexUrl) {
                cachedIndex = snapshot.entries
                logger.info { "Loaded ${snapshot.entries.size} cached repository entries from disk" }
            }
        }.onFailure { error ->
            logger.warn(error) { "Failed to read persisted repository cache" }
        }
    }

    private fun persistIndex(url: String, entries: List<ExtensionRepoEntry>) {
        runCatching {
            Files.createDirectories(cachePath.parent)
            cachePath.writeText(
                json.encodeToString(
                    ExtensionRepoCacheSnapshot.serializer(),
                    ExtensionRepoCacheSnapshot(url = url, entries = entries),
                ),
            )
        }.onFailure { error ->
            logger.warn(error) { "Failed to persist repository cache" }
        }
    }

    private fun clearPersistedIndex() {
        runCatching {
            Files.deleteIfExists(cachePath)
        }.onFailure { error ->
            logger.warn(error) { "Failed to clear persisted repository cache" }
        }
    }
}

class InvalidRepoIndexUrlException(
    message: String,
) : RuntimeException(message)
