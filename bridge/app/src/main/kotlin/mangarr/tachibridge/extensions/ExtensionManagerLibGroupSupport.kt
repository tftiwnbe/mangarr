package mangarr.tachibridge.extensions

import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.source.ConfigurableSource
import eu.kanade.tachiyomi.source.Source
import eu.kanade.tachiyomi.source.online.HttpSource
import eu.kanade.tachiyomi.source.model.Page as SourcePage
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mangarr.tachibridge.config.ConfigManager
import mangarr.tachibridge.config.PreferenceValue
import mangarr.tachibridge.config.sourcePreferencesFor
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URLEncoder
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

private val logger = KotlinLogging.logger {}

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
internal class ExtensionManagerLibGroupSupport(
	private val networkHelper: NetworkHelper,
	private val sourceToPackage: ConcurrentHashMap<Long, String>,
	private val retryDelaysMs: List<Long>,
) {
	fun decorateLibGroupError(
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

	fun normalizeSourceUrl(
		source: Source,
		rawUrl: String,
	): String {
		val trimmed = rawUrl.trim()
		if (!isLibGroupSource(source)) {
			return trimmed
		}

		val normalized = stripSchemeAndHost(trimmed).trim()
		if (normalized.isBlank()) return normalized

		val withLeadingSlash =
			if (normalized.startsWith("/")) {
				normalized
			} else {
				"/$normalized"
			}

		return withLeadingSlash.replace(Regex("^/manga/"), "/")
	}

	fun isLibGroupSource(source: Source): Boolean =
		generateSequence(source.javaClass as Class<*>?) { it.superclass }
			.map { it.name.lowercase() }
			.any { it.contains("multisrc.libgroup") }

	suspend fun fetchLibGroupMangaDetailsFallback(
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

	suspend fun resolveLibGroupCanonicalUrl(
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

	suspend fun fetchLibGroupChapterListFallback(
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

	suspend fun fetchLibGroupPagesFallback(
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
			val normalizedPath = normalizeLibGroupAssetUrl(source, path)
			if (normalizedPath.isBlank()) {
				return@mapIndexedNotNull null
			}
			SourcePage(index, normalizedPath, normalizedPath)
		}
	}

	fun normalizeLibGroupAssetUrl(source: Source, rawPath: String): String {
		val trimmed = rawPath.trim()
		if (trimmed.isBlank()) {
			return ""
		}
		if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
			return trimmed
		}
		if (trimmed.startsWith("//")) {
			return "https:$trimmed"
		}

		val baseCandidates =
			buildList {
				if (source is HttpSource) {
					add(source.baseUrl)
				}
				add(libGroupBaseApi(source))
			}

		for (base in baseCandidates) {
			val resolved = resolveRelativeUrl(base, trimmed)
			if (resolved != null) {
				return resolved
			}
		}

		return trimmed
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

	private suspend fun fetchLibGroupResponseBody(url: String): String? {
		for ((attemptIndex, delayMs) in retryDelaysMs.withIndex()) {
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
								if (shouldRetry && attemptIndex < retryDelaysMs.lastIndex) {
									logger.warn {
										"Libgroup request failed with HTTP ${response.code} for $url " +
											"(attempt ${attemptIndex + 1}/${retryDelaysMs.size}), retrying"
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
				if (attemptIndex < retryDelaysMs.lastIndex) {
					logger.warn {
						"Libgroup request timed out for $url " +
							"(attempt ${attemptIndex + 1}/${retryDelaysMs.size}), retrying"
					}
					continue
				}
				logger.warn(e) { "Libgroup request timed out for $url after ${attemptIndex + 1} attempts" }
			} catch (e: IOException) {
				if (attemptIndex < retryDelaysMs.lastIndex) {
					logger.warn {
						"Libgroup request failed for $url: ${e.message.orEmpty()} " +
							"(attempt ${attemptIndex + 1}/${retryDelaysMs.size}), retrying"
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

	private fun resolveRelativeUrl(base: String, path: String): String? {
		val uri = runCatching { URI(base) }.getOrNull() ?: return null
		if (uri.scheme.isNullOrBlank() || uri.host.isNullOrBlank()) {
			return null
		}
		return runCatching { uri.resolve(path).toString() }.getOrNull()
	}
}

private data class LibGroupChapterRef(
	val slug: String,
	val volume: String,
	val number: String,
	val branchId: String?,
)
