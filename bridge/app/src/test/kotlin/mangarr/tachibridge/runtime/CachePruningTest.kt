package mangarr.tachibridge.runtime

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mangarr.tachibridge.config.ConfigManager
import java.nio.file.Files
import kotlin.io.path.createDirectories
import kotlin.io.path.createTempDirectory
import kotlin.io.path.exists
import kotlin.io.path.pathString
import kotlin.io.path.setLastModifiedTime
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.hours

class CachePruningTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `reader page cache prune removes expired entries and keeps fresh ones`() {
        val cacheDir = createTempDirectory("reader-page-cache")
        val now = System.currentTimeMillis()

        persistReaderPage(
            json = json,
            readerPageCacheDir = cacheDir,
            cacheKey = "expired",
            payload = CachedReaderPage(contentType = "image/webp", bytes = byteArrayOf(1, 2, 3), expiresAt = now - 1),
        )
        persistReaderPage(
            json = json,
            readerPageCacheDir = cacheDir,
            cacheKey = "fresh",
            payload = CachedReaderPage(contentType = "image/webp", bytes = byteArrayOf(4, 5, 6), expiresAt = now + 60_000),
        )

        val deleted = pruneReaderPageCacheFiles(json, cacheDir, now)

        assertEquals(1, deleted)
        assertFalse(loadPersistedReaderPage(json, cacheDir, "expired", now) != null)
        assertTrue(loadPersistedReaderPage(json, cacheDir, "fresh", now) != null)
    }

    @Test
    fun `download storage prune removes stale temp artifacts`() {
        val configDir = createTempDirectory("bridge-config")
        val downloadsDir = createTempDirectory("bridge-downloads")
        ConfigManager.init(configDir)
        ConfigManager.update { config ->
            config.copy(downloads = config.downloads.copy(downloadPath = downloadsDir.pathString))
        }

        val storage = DownloadStorage(configDir)
        val staleWorkspace = downloadsDir.resolve("chapter.tmp").createDirectories()
        staleWorkspace.resolve("page-1.txt").writeText("page")
        val staleExport = Files.createTempFile(downloadsDir, "chapter", ".export.zip")
        Files.writeString(staleExport, "zip")

        val staleAt = java.nio.file.attribute.FileTime.fromMillis(System.currentTimeMillis() - 8.hours.inWholeMilliseconds)
        staleWorkspace.setLastModifiedTime(staleAt)
        staleWorkspace.resolve("page-1.txt").setLastModifiedTime(staleAt)
        staleExport.setLastModifiedTime(staleAt)

        val summary = storage.pruneCachedArtifacts(now = System.currentTimeMillis())

        assertEquals(1, summary.deletedTempWorkspaces)
        assertEquals(1, summary.deletedTempExports)
        assertFalse(staleWorkspace.exists())
        assertFalse(staleExport.exists())
    }
}
