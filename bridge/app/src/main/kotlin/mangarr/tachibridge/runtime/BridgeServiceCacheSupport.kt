package mangarr.tachibridge.runtime

import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.io.path.writeText

private val logger = KotlinLogging.logger {}

internal fun loadPersistedFeed(
	json: Json,
	feedCacheDir: Path,
	cacheKey: String,
	now: Long,
): JsonObject? {
	val cachePath = feedCachePath(feedCacheDir, cacheKey)
	if (!cachePath.exists()) {
		return null
	}

	return runCatching {
		val snapshot =
			json.decodeFromString(
				CachedFeedSnapshot.serializer(),
				cachePath.readText(),
			)
		if (snapshot.expiresAt <= now) {
			Files.deleteIfExists(cachePath)
			null
		} else {
			snapshot.payload
		}
	}.getOrNull()
}

internal fun persistFeed(
	json: Json,
	feedCacheDir: Path,
	cacheKey: String,
	payload: JsonObject,
	expiresAt: Long,
) {
	runCatching {
		Files.createDirectories(feedCacheDir)
		feedCachePath(feedCacheDir, cacheKey).writeText(
			json.encodeToString(
				CachedFeedSnapshot.serializer(),
				CachedFeedSnapshot(expiresAt = expiresAt, payload = payload),
			),
		)
	}.onFailure { error ->
		logger.warn(error) { "Failed to persist explore feed cache" }
	}
}

internal fun loadPersistedReaderPage(
	json: Json,
	readerPageCacheDir: Path,
	cacheKey: String,
	now: Long,
): CachedReaderPage? {
	val metaPath = readerPageMetaPath(readerPageCacheDir, cacheKey)
	val bodyPath = readerPageBodyPath(readerPageCacheDir, cacheKey)
	if (!metaPath.exists() || !bodyPath.exists()) {
		return null
	}

	return runCatching {
		val snapshot =
			json.decodeFromString(
				CachedReaderPageSnapshot.serializer(),
				metaPath.readText(),
			)
		if (snapshot.expiresAt <= now) {
			Files.deleteIfExists(metaPath)
			Files.deleteIfExists(bodyPath)
			null
		} else {
			CachedReaderPage(
				contentType = snapshot.contentType,
				bytes = Files.readAllBytes(bodyPath),
				expiresAt = snapshot.expiresAt,
			)
		}
	}.getOrElse { error ->
		logger.warn(error) { "Failed to read persisted reader page cache" }
		Files.deleteIfExists(metaPath)
		Files.deleteIfExists(bodyPath)
		null
	}
}

internal fun persistReaderPage(
	json: Json,
	readerPageCacheDir: Path,
	cacheKey: String,
	payload: CachedReaderPage,
) {
	runCatching {
		Files.createDirectories(readerPageCacheDir)
		Files.write(readerPageBodyPath(readerPageCacheDir, cacheKey), payload.bytes)
		readerPageMetaPath(readerPageCacheDir, cacheKey).writeText(
			json.encodeToString(
				CachedReaderPageSnapshot.serializer(),
				CachedReaderPageSnapshot(
					contentType = payload.contentType,
					expiresAt = payload.expiresAt,
				),
			),
		)
	}.onFailure { error ->
		logger.warn(error) { "Failed to persist reader page cache" }
	}
}

internal fun pruneFeedCacheFiles(
	json: Json,
	feedCacheDir: Path,
	now: Long,
): Int {
	if (!feedCacheDir.exists()) {
		return 0
	}
	var deleted = 0
	Files.list(feedCacheDir).use { entries ->
		entries.filter { path -> Files.isRegularFile(path) && path.fileName.toString().endsWith(".json") }.forEach { path ->
			val remove =
				runCatching {
					val snapshot =
						json.decodeFromString(
							CachedFeedSnapshot.serializer(),
							path.readText(),
						)
					snapshot.expiresAt <= now
				}.getOrElse { true }
			if (remove && Files.deleteIfExists(path)) {
				deleted += 1
			}
		}
	}
	return deleted
}

internal fun pruneReaderPageCacheFiles(
	json: Json,
	readerPageCacheDir: Path,
	now: Long,
): Int {
	if (!readerPageCacheDir.exists()) {
		return 0
	}
	var deleted = 0
	Files.list(readerPageCacheDir).use { entries ->
		entries.filter { path -> Files.isRegularFile(path) && path.fileName.toString().endsWith(".json") }.forEach { metaPath ->
			val cacheKey = metaPath.fileName.toString().removeSuffix(".json")
			val bodyPath = readerPageCacheDir.resolve("$cacheKey.bin")
			val remove =
				runCatching {
					val snapshot =
						json.decodeFromString(
							CachedReaderPageSnapshot.serializer(),
							metaPath.readText(),
						)
					snapshot.expiresAt <= now || !bodyPath.exists()
				}.getOrElse { true }
			if (remove) {
				if (Files.deleteIfExists(metaPath)) {
					deleted += 1
				}
				Files.deleteIfExists(bodyPath)
			}
		}
	}
	return deleted
}

private fun feedCachePath(feedCacheDir: Path, cacheKey: String): Path =
	feedCacheDir.resolve("${hashCacheKey(cacheKey)}.json")

private fun readerPageMetaPath(readerPageCacheDir: Path, cacheKey: String): Path =
	readerPageCacheDir.resolve("${hashCacheKey(cacheKey)}.json")

private fun readerPageBodyPath(readerPageCacheDir: Path, cacheKey: String): Path =
	readerPageCacheDir.resolve("${hashCacheKey(cacheKey)}.bin")

private fun hashCacheKey(value: String): String =
	MessageDigest
		.getInstance("SHA-1")
		.digest(value.toByteArray(Charsets.UTF_8))
		.joinToString("") { byte -> "%02x".format(byte) }

internal data class CachedReaderPage(
	val contentType: String,
	val bytes: ByteArray,
	val expiresAt: Long,
)

@Serializable
internal data class CachedReaderPageSnapshot(
	val contentType: String,
	val expiresAt: Long,
)

internal data class CachedFeedResult(
	val payload: JsonObject,
	val expiresAt: Long,
)

@Serializable
internal data class CachedFeedSnapshot(
	val expiresAt: Long,
	val payload: JsonObject,
)
