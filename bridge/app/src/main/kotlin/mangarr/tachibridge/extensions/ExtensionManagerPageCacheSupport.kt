package mangarr.tachibridge.extensions

import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.HttpException
import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.network.awaitSuccess
import eu.kanade.tachiyomi.source.Source
import eu.kanade.tachiyomi.source.online.HttpSource
import eu.kanade.tachiyomi.source.model.Page as SourcePage
import eu.kanade.tachiyomi.source.model.SChapter
import io.github.oshai.kotlinlogging.KotlinLogging
import java.io.IOException
import java.net.URI
import java.util.concurrent.ConcurrentHashMap

private val logger = KotlinLogging.logger {}
private const val PAGE_LIST_CACHE_TTL_MS = 10 * 60 * 1000L

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
internal class ExtensionManagerPageCacheSupport(
	private val networkHelper: NetworkHelper,
	private val chapterPagesCache: ConcurrentHashMap<String, CachedChapterPages>,
) {
	suspend fun resolvePageImageUrl(source: Source, page: SourcePage): String {
		val explicitImageUrl = safeString { page.imageUrl }
		if (explicitImageUrl.isNotBlank()) {
			return normalizePageImageUrl(source, page.url, explicitImageUrl)
		}

		if (source is HttpSource) {
			val computed = runCatching { source.getImageUrl(page).orEmpty() }.getOrDefault("")
			if (computed.isNotBlank()) {
				return normalizePageImageUrl(source, page.url, computed)
			}
		}

		return ""
	}

	suspend fun loadPagesForChapter(
		source: Source,
		normalizedUrl: String,
		chapterName: String? = null,
	): List<SourcePage> = loadPagesForChapter(source, normalizedUrl, chapterName, bypassCache = false)

	fun invalidateChapterPagesCache(sourceId: Long, chapterUrl: String) {
		chapterPagesCache.remove(chapterPagesCacheKey(sourceId, chapterUrl))
	}

	suspend fun fetchPageImagePayload(
		source: Source,
		normalizedUrl: String,
		chapterName: String?,
		index: Int,
		bypassPageCache: Boolean,
	): PageImagePayload {
		val pages = loadPagesForChapter(source, normalizedUrl, chapterName, bypassPageCache)
		val page = pages.getOrNull(index) ?: error("Page index out of bounds: $index")

		val resolvedPageImageUrl = resolvePageImageUrl(source, page)
		val response =
			if (source is HttpSource) {
				runCatching { source.getImage(page) }.getOrElse { error ->
					if (resolvedPageImageUrl.isBlank()) {
						throw error
					}
					logger.debug(error) {
						"Falling back to resolved page image URL for source=${source.id} chapter=$normalizedUrl index=$index"
					}
					networkHelper.client.newCall(GET(resolvedPageImageUrl, source.headers)).awaitSuccess()
				}
			} else {
				if (resolvedPageImageUrl.isBlank()) {
					error("Page image URL is unavailable for source ${source.id}")
				}
				networkHelper.client.newCall(GET(resolvedPageImageUrl)).awaitSuccess()
			}

		response.use { imageResponse ->
			val body = imageResponse.body ?: error("Image response body is empty")
			return PageImagePayload(
				contentType = body.contentType()?.toString() ?: "application/octet-stream",
				bytes = body.bytes(),
			)
		}
	}

	fun shouldRefreshChapterPagesCache(error: Exception): Boolean =
		when (error) {
			is HttpException -> error.code == 403 || error.code == 404 || error.code == 410
			is IOException -> true
			else -> false
		}

	private fun normalizePageImageUrl(
		source: Source,
		pageUrl: String,
		rawImageUrl: String,
	): String {
		val trimmedImageUrl = rawImageUrl.trim()
		if (trimmedImageUrl.isBlank()) {
			return ""
		}
		if (trimmedImageUrl.startsWith("http://") || trimmedImageUrl.startsWith("https://")) {
			return trimmedImageUrl
		}
		if (trimmedImageUrl.startsWith("//")) {
			return "https:$trimmedImageUrl"
		}

		val baseCandidates =
			buildList {
				val normalizedPageUrl = pageUrl.trim()
				if (normalizedPageUrl.isNotBlank()) {
					add(normalizedPageUrl)
					normalizedPageUrl
						.split(',')
						.map(String::trim)
						.filter(String::isNotBlank)
						.forEach(::add)
				}
				if (source is HttpSource) {
					val baseUrl = source.baseUrl.trim()
					if (baseUrl.isNotBlank()) {
						add(baseUrl)
					}
				}
			}

		for (base in baseCandidates) {
			val resolved = resolveRelativeUrl(base, trimmedImageUrl)
			if (resolved != null) {
				return resolved
			}
		}

		return trimmedImageUrl
	}

	private fun resolveRelativeUrl(base: String, path: String): String? {
		val uri = runCatching { URI(base) }.getOrNull() ?: return null
		if (uri.scheme.isNullOrBlank() || uri.host.isNullOrBlank()) {
			return null
		}
		return runCatching { uri.resolve(path).toString() }.getOrNull()
	}

	private suspend fun loadPagesForChapter(
		source: Source,
		normalizedUrl: String,
		chapterName: String?,
		bypassCache: Boolean,
	): List<SourcePage> =
		chapterPagesCache[chapterPagesCacheKey(source.id, normalizedUrl)]
			?.takeIf { it.expiresAt > System.currentTimeMillis() }
			?.takeUnless { bypassCache }
			?.pages
			?: run {
				val chapter =
					SChapter.create().apply {
						url = normalizedUrl
						name = chapterName?.trim()?.ifBlank { normalizedUrl } ?: normalizedUrl
					}
				val pages = source.getPageList(chapter)

				chapterPagesCache[chapterPagesCacheKey(source.id, normalizedUrl)] =
					CachedChapterPages(
						pages = pages,
						expiresAt = System.currentTimeMillis() + PAGE_LIST_CACHE_TTL_MS,
					)
				pages
			}

	private fun chapterPagesCacheKey(sourceId: Long, chapterUrl: String): String = "$sourceId::$chapterUrl"
}

internal data class CachedChapterPages(
	val pages: List<SourcePage>,
	val expiresAt: Long,
)

private fun safeString(block: () -> String?): String =
	runCatching { block().orEmpty() }.getOrDefault("")
