package mangarr.tachibridge.runtime

import mangarr.tachibridge.config.ConfigManager
import java.nio.file.Path
import kotlin.io.path.createTempDirectory
import kotlin.io.path.exists
import kotlin.io.path.pathString
import kotlin.io.path.writeBytes
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull

class DownloadStorageTest {
    @Test
    fun `stores readable transliterated directory names`() {
        val storage = createStorage()

        val workspace =
            storage.createChapterWorkspace(
                titleId = "title-1",
                titleName = "Перезапуск Леди",
                sourceId = "4008409601887986192",
                sourcePkg = "eu.kanade.tachiyomi.extension.ru.mangabuff",
                sourceLang = "ru",
                chapterUrl = "/manga/restart-ledi/2/60",
                chapterName = "Том 2 Глава 60",
                chapterNumber = 60.0,
                downloadTaskId = "task-1",
                attemptOwner = "test",
            )

        workspace.tempDir.resolve("001.jpg").writeBytes(byteArrayOf(1, 2, 3))
        val stored = storage.finalizeChapterDownload(workspace)

        assertEquals(
            "Perezapusk Ledi/mangabuff-ru/v2-ch-60",
            stored.localRelativePath,
        )
    }

    @Test
    fun `resolves legacy stored chapters after title rename`() {
        val downloadsDir = createTempDirectory("bridge-downloads")
        val storage = createStorage(downloadsDir = downloadsDir)

        val legacyTitleDir = downloadsDir.resolve("title--52e9a2")
        val sourceDir = legacyTitleDir.resolve("mangabuff-ru--d11577")
        val chapterDir = sourceDir.resolve("ch-60-2-60--adb9dde0b964")
        java.nio.file.Files.createDirectories(chapterDir)
        chapterDir.resolve("001.jpg").writeBytes(byteArrayOf(1, 2, 3))

        val stored =
            storage.resolveStoredChapter(
                titleId = "title-1",
                titleName = "Новое имя тайтла",
                sourceId = "4008409601887986192",
                sourcePkg = "eu.kanade.tachiyomi.extension.ru.mangabuff",
                sourceLang = "ru",
                chapterUrl = "/manga/restart-ledi/2/60",
                chapterName = "Том 2 Глава 60",
                chapterNumber = 60.0,
            )

        assertNotNull(stored)
        assertEquals(
            "title--52e9a2/mangabuff-ru--d11577/ch-60-2-60--adb9dde0b964",
            stored.localRelativePath,
        )
        assertEquals(1, stored.pageCount)
    }

    @Test
    fun `finalize returns existing stored chapter instead of failing`() {
        val downloadsDir = createTempDirectory("bridge-downloads")
        val storage = createStorage(downloadsDir = downloadsDir)

        val existingDir =
            downloadsDir
                .resolve("Perezapusk Ledi")
                .resolve("mangabuff-ru")
                .resolve("v2-ch-60")
        java.nio.file.Files.createDirectories(existingDir)
        existingDir.resolve("001.jpg").writeBytes(byteArrayOf(1, 2, 3))

        val workspace =
            storage.createChapterWorkspace(
                titleId = "title-1",
                titleName = "Перезапуск Леди",
                sourceId = "4008409601887986192",
                sourcePkg = "eu.kanade.tachiyomi.extension.ru.mangabuff",
                sourceLang = "ru",
                chapterUrl = "/manga/restart-ledi/2/60",
                chapterName = "Том 2 Глава 60",
                chapterNumber = 60.0,
                downloadTaskId = "task-1",
                attemptOwner = "test",
            )
        workspace.tempDir.resolve("001.jpg").writeBytes(byteArrayOf(9, 9, 9))

        val stored = storage.finalizeChapterDownload(workspace)

        assertEquals(
            "Perezapusk Ledi/mangabuff-ru/v2-ch-60",
            stored.localRelativePath,
        )
        assertFalse(workspace.tempDir.exists())
    }

    @Test
    fun `finalize treats raced non empty target as existing stored chapter`() {
        val downloadsDir = createTempDirectory("bridge-downloads")
        val storage = createStorage(downloadsDir = downloadsDir)

        val workspace =
            storage.createChapterWorkspace(
                titleId = "title-1",
                titleName = "Перезапуск Леди",
                sourceId = "4008409601887986192",
                sourcePkg = "eu.kanade.tachiyomi.extension.ru.mangabuff",
                sourceLang = "ru",
                chapterUrl = "/manga/restart-ledi/2/60",
                chapterName = "Том 2 Глава 60",
                chapterNumber = 60.0,
                downloadTaskId = "task-1",
                attemptOwner = "test",
            )
        workspace.tempDir.resolve("001.jpg").writeBytes(byteArrayOf(9, 9, 9))
        java.nio.file.Files.createDirectories(workspace.finalDir)
        workspace.finalDir.resolve("001.jpg").writeBytes(byteArrayOf(1, 2, 3))

        val stored = storage.finalizeChapterDownload(workspace)

        assertEquals(
            "Perezapusk Ledi/mangabuff-ru/v2-ch-60",
            stored.localRelativePath,
        )
        assertFalse(workspace.tempDir.exists())
    }

    @Test
    fun `new chapters target normalized title and source directories immediately`() {
        val downloadsDir = createTempDirectory("bridge-downloads")
        val storage = createStorage(downloadsDir = downloadsDir)

        val legacySourceDir = downloadsDir.resolve("title--52e9a2").resolve("mangabuff-ru--d11577")
        java.nio.file.Files.createDirectories(legacySourceDir)

        val workspace =
            storage.createChapterWorkspace(
                titleId = "title-1",
                titleName = "Перезапуск Леди",
                sourceId = "4008409601887986192",
                sourcePkg = "eu.kanade.tachiyomi.extension.ru.mangabuff",
                sourceLang = "ru",
                chapterUrl = "/manga/restart-ledi/2/61",
                chapterName = "Том 2 Глава 61",
                chapterNumber = 61.0,
                downloadTaskId = "task-2",
                attemptOwner = "test",
            )

        assertEquals(
            downloadsDir.resolve("Perezapusk Ledi").resolve("mangabuff-ru").resolve("v2-ch-61").pathString,
            workspace.finalDir.pathString,
        )
    }

    @Test
    fun `normalize moves legacy hashed chapter directory to readable chapter path`() {
        val downloadsDir = createTempDirectory("bridge-downloads")
        val storage = createStorage(downloadsDir = downloadsDir)

        val sourceDir = downloadsDir.resolve("title--52e9a2").resolve("mangabuff-ru--d11577")
        val legacyChapterDir = sourceDir.resolve("ch-60-2-60--adb9dde0b964")
        java.nio.file.Files.createDirectories(legacyChapterDir)
        legacyChapterDir.resolve("001.jpg").writeBytes(byteArrayOf(1, 2, 3))

        val normalized =
            storage.normalizeStoredChapter(
                titleId = "title-1",
                titleName = "Перезапуск Леди",
                sourceId = "4008409601887986192",
                sourcePkg = "eu.kanade.tachiyomi.extension.ru.mangabuff",
                sourceLang = "ru",
                chapterUrl = "/manga/restart-ledi/2/60",
                chapterName = "Том 2 Глава 60",
                chapterNumber = 60.0,
                relativePath = "title--52e9a2/mangabuff-ru--d11577/ch-60-2-60--adb9dde0b964",
            )

        assertNotNull(normalized.stored)
        assertEquals(true, normalized.moved)
        assertEquals(false, normalized.conflict)
        assertEquals(
            "Perezapusk Ledi/mangabuff-ru/v2-ch-60",
            normalized.stored.localRelativePath,
        )
        assertFalse(legacyChapterDir.exists())
        assertFalse(sourceDir.exists())
    }

    @Test
    fun `transliterates cyrillic titles to filesystem safe paths`() {
        val downloadsDir = createTempDirectory("bridge-downloads")
        val storage = createStorage(downloadsDir = downloadsDir)

        val workspace =
            storage.createChapterWorkspace(
                titleId = "title-2",
                titleName = "Способ защитить тебя, дорогой",
                sourceId = "source-2",
                sourcePkg = "eu.kanade.tachiyomi.extension.ru.mangalib",
                sourceLang = "ru",
                chapterUrl = "/manga/sposob-zashchitit-tebya-dorogoi/3/123",
                chapterName = "Том 3 Глава 123",
                chapterNumber = 123.0,
                downloadTaskId = "task-3",
                attemptOwner = "test",
            )

        assertEquals(
            "Sposob zashchitit tebya, dorogoy/mangalib-ru/v3-ch-123",
            downloadsDir.relativize(workspace.finalDir).pathString,
        )
    }

    @Test
    fun `normalization merges into clean title when only other sources already exist`() {
        val downloadsDir = createTempDirectory("bridge-downloads")
        val storage = createStorage(downloadsDir = downloadsDir)

        val conflictingCleanDir = downloadsDir.resolve("Perezapusk Ledi").resolve("other-source")
        java.nio.file.Files.createDirectories(conflictingCleanDir)
        conflictingCleanDir.resolve("001.jpg").writeBytes(byteArrayOf(8, 8, 8))

        val legacySourceDir = downloadsDir.resolve("title--52e9a2").resolve("mangabuff-ru--d11577")
        val legacyChapterDir = legacySourceDir.resolve("ch-60-2-60--adb9dde0b964")
        java.nio.file.Files.createDirectories(legacyChapterDir)
        legacyChapterDir.resolve("001.jpg").writeBytes(byteArrayOf(1, 2, 3))

        val normalized =
            storage.normalizeStoredChapter(
                titleId = "title-1",
                titleName = "Перезапуск Леди",
                sourceId = "4008409601887986192",
                sourcePkg = "eu.kanade.tachiyomi.extension.ru.mangabuff",
                sourceLang = "ru",
                chapterUrl = "/manga/restart-ledi/2/60",
                chapterName = "Том 2 Глава 60",
                chapterNumber = 60.0,
                relativePath = "title--52e9a2/mangabuff-ru--d11577/ch-60-2-60--adb9dde0b964",
            )

        assertNotNull(normalized.stored)
        assertEquals(
            "Perezapusk Ledi/mangabuff-ru/v2-ch-60",
            normalized.stored.localRelativePath,
        )
    }

    @Test
    fun `normalization merges same source into clean title and drops duplicate chapter`() {
        val downloadsDir = createTempDirectory("bridge-downloads")
        val storage = createStorage(downloadsDir = downloadsDir)

        val conflictingCleanDir = downloadsDir.resolve("Perezapusk Ledi").resolve("mangabuff-ru")
        java.nio.file.Files.createDirectories(conflictingCleanDir)
        conflictingCleanDir.resolve("001.jpg").writeBytes(byteArrayOf(8, 8, 8))

        val legacySourceDir = downloadsDir.resolve("title--52e9a2").resolve("mangabuff-ru--d11577")
        val legacyChapterDir = legacySourceDir.resolve("ch-60-2-60--adb9dde0b964")
        java.nio.file.Files.createDirectories(legacyChapterDir)
        legacyChapterDir.resolve("001.jpg").writeBytes(byteArrayOf(1, 2, 3))

        val normalized =
            storage.normalizeStoredChapter(
                titleId = "title-1",
                titleName = "Перезапуск Леди",
                sourceId = "4008409601887986192",
                sourcePkg = "eu.kanade.tachiyomi.extension.ru.mangabuff",
                sourceLang = "ru",
                chapterUrl = "/manga/restart-ledi/2/60",
                chapterName = "Том 2 Глава 60",
                chapterNumber = 60.0,
                relativePath = "title--52e9a2/mangabuff-ru--d11577/ch-60-2-60--adb9dde0b964",
            )

        assertNotNull(normalized.stored)
        assertEquals(
            "Perezapusk Ledi/mangabuff-ru/v2-ch-60",
            normalized.stored.localRelativePath,
        )
        assertFalse(legacyChapterDir.exists())
        assertFalse(legacySourceDir.exists())
    }

    private fun createStorage(downloadsDir: Path = createTempDirectory("bridge-downloads")): DownloadStorage {
        val configDir = createTempDirectory("bridge-config")
        ConfigManager.init(configDir)
        ConfigManager.update { config ->
            config.copy(downloads = config.downloads.copy(downloadPath = downloadsDir.pathString))
        }
        return DownloadStorage(configDir)
    }
}
