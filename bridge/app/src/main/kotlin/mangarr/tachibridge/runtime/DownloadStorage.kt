package mangarr.tachibridge.runtime

import mangarr.tachibridge.config.ConfigManager
import mangarr.tachibridge.extensions.PageImagePayload
import mangarr.tachibridge.util.ImageUtil
import java.io.ByteArrayInputStream
import java.net.URLConnection
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.text.Normalizer
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.io.path.deleteIfExists
import kotlin.io.path.exists
import kotlin.io.path.getLastModifiedTime
import kotlin.io.path.inputStream
import kotlin.io.path.isDirectory
import kotlin.io.path.name
import kotlin.io.path.outputStream
import kotlin.io.path.pathString
import kotlin.io.path.readBytes
import kotlin.io.path.relativeTo
import kotlin.io.path.writeBytes

private const val CONTAINER_DEFAULT_DOWNLOADS_PATH = "/app/downloads"

data class StoredChapterPayload(
    val storageKind: String,
    val localRelativePath: String,
    val fileSizeBytes: Long,
    val pageCount: Int,
)

data class DownloadStorageSummary(
    val downloadPath: String,
    val usedSpaceBytes: Long,
    val freeSpaceBytes: Long,
    val totalSpaceBytes: Long,
)

data class StoredChapterFilePayload(
    val fileName: String,
    val contentType: String,
    val filePath: Path,
    val fileSizeBytes: Long,
    val deleteAfterSend: Boolean = false,
)

class DownloadStorage(
    dataPath: Path,
) {
    private val dataRoot = dataPath
    private val coversRoot = dataPath.resolve("covers")

    init {
        Files.createDirectories(coversRoot)
    }

    fun createChapterWorkspace(
        titleId: String,
        titleName: String,
        sourceId: String,
        sourcePkg: String,
        sourceLang: String,
        chapterUrl: String,
        chapterName: String,
        chapterNumber: Double?,
    ): ChapterWorkspace {
        val finalDir =
            storedChapterPath(
                titleId = titleId,
                titleName = titleName,
                sourceId = sourceId,
                sourcePkg = sourcePkg,
                sourceLang = sourceLang,
                chapterUrl = chapterUrl,
                chapterName = chapterName,
                chapterNumber = chapterNumber,
            )
        val tempDir = finalDir.parent.resolve("${finalDir.fileName}.tmp")

        finalDir.toFile().deleteRecursively()
        tempDir.toFile().deleteRecursively()
        Files.createDirectories(tempDir)

        return ChapterWorkspace(
            tempDir = tempDir,
            finalDir = finalDir,
        )
    }

    fun writePage(
        workspace: ChapterWorkspace,
        index: Int,
        image: PageImagePayload,
    ) {
        val imageType =
            ImageUtil.findImageType(ByteArrayInputStream(image.bytes))
                ?: image.contentType
                    .substringAfter('/')
                    .substringBefore(';')
                    .trim()
                    .takeIf { it.isNotEmpty() }
                    ?.let { ext ->
                        ImageUtil.ImageType.entries.firstOrNull { type ->
                            type.extension.equals(ext, ignoreCase = true)
                        }
                    }

        val extension = imageType?.extension ?: "bin"
        val fileName = "${(index + 1).toString().padStart(3, '0')}.$extension"
        workspace.tempDir.resolve(fileName).writeBytes(image.bytes)
    }

    fun finalizeChapterDownload(workspace: ChapterWorkspace): StoredChapterPayload {
        val downloadsRoot = downloadsRoot()
        Files.createDirectories(workspace.finalDir.parent)
        Files.move(
            workspace.tempDir,
            workspace.finalDir,
            StandardCopyOption.REPLACE_EXISTING,
            StandardCopyOption.ATOMIC_MOVE,
        )

        return StoredChapterPayload(
            storageKind = "directory",
            localRelativePath = workspace.finalDir.relativeTo(downloadsRoot).pathString.replace('\\', '/'),
            fileSizeBytes = pathSize(workspace.finalDir),
            pageCount = countStoredPages(workspace.finalDir),
        )
    }

    fun cacheCover(
        titleId: String,
        image: PageImagePayload,
    ): String {
        val imageType = ImageUtil.findImageType(ByteArrayInputStream(image.bytes)) ?: ImageUtil.ImageType.JPEG
        val target = coversRoot.resolve("$titleId.${imageType.extension}")

        coversRoot.toFile().listFiles()?.forEach { existing ->
            if (existing.name.startsWith("$titleId.")) {
                existing.delete()
            }
        }

        target.writeBytes(image.bytes)
        return target.relativeTo(coversRoot).pathString.replace('\\', '/')
    }

    fun readStoredPage(
        relativePath: String,
        index: Int,
    ): PageImagePayload {
        require(index >= 0) { "Page index must be non-negative" }
        return readDirectoryPage(resolveRelative(downloadsRoot(), relativePath), index)
    }

    fun readStoredChapterFile(relativePath: String): StoredChapterFilePayload {
        val resolved = resolveRelative(downloadsRoot(), relativePath)
        require(resolved.exists() && resolved.isDirectory()) { "Downloaded chapter directory is unavailable" }

        val exportFile = Files.createTempFile(resolved.parent, "${resolved.fileName}.", ".export.zip")
        try {
            writeArchive(resolved, exportFile)
        } catch (error: Exception) {
            exportFile.deleteIfExists()
            throw error
        }

        return StoredChapterFilePayload(
            fileName = "${resolved.fileName}.zip",
            contentType = "application/zip",
            filePath = exportFile,
            fileSizeBytes = Files.size(exportFile),
            deleteAfterSend = true,
        )
    }

    fun resolveStoredChapter(
        titleId: String,
        titleName: String,
        sourceId: String,
        sourcePkg: String,
        sourceLang: String,
        chapterUrl: String,
        chapterName: String,
        chapterNumber: Double?,
    ): StoredChapterPayload? {
        val directory =
            storedChapterPath(
                titleId = titleId,
                titleName = titleName,
                sourceId = sourceId,
                sourcePkg = sourcePkg,
                sourceLang = sourceLang,
                chapterUrl = chapterUrl,
                chapterName = chapterName,
                chapterNumber = chapterNumber,
            )
        if (!directory.exists() || !directory.isDirectory()) {
            return null
        }

        return StoredChapterPayload(
            storageKind = "directory",
            localRelativePath = directory.relativeTo(downloadsRoot()).pathString.replace('\\', '/'),
            fileSizeBytes = pathSize(directory),
            pageCount = countStoredPages(directory),
        )
    }

    fun deleteStoredChapter(
        titleId: String,
        titleName: String,
        sourceId: String,
        sourcePkg: String,
        sourceLang: String,
        chapterUrl: String,
        chapterName: String,
        chapterNumber: Double?,
        relativePath: String?,
    ): Boolean {
        if (!relativePath.isNullOrBlank()) {
            return deleteResolvedStoredChapter(resolveRelative(downloadsRoot(), relativePath))
        }

        val directory =
            storedChapterPath(
                titleId = titleId,
                titleName = titleName,
                sourceId = sourceId,
                sourcePkg = sourcePkg,
                sourceLang = sourceLang,
                chapterUrl = chapterUrl,
                chapterName = chapterName,
                chapterNumber = chapterNumber,
            )
        return deleteResolvedStoredChapter(directory)
    }

    fun summary(): DownloadStorageSummary {
        val downloadsRoot = downloadsRoot()
        Files.createDirectories(downloadsRoot)
        val store = Files.getFileStore(downloadsRoot)
        return DownloadStorageSummary(
            downloadPath = downloadsRoot.toAbsolutePath().normalize().pathString,
            usedSpaceBytes = totalStoredSize(downloadsRoot),
            freeSpaceBytes = store.usableSpace,
            totalSpaceBytes = store.totalSpace,
        )
    }

    fun readCover(relativePath: String): PageImagePayload {
        val resolved = resolveRelative(coversRoot, relativePath)
        val bytes = resolved.readBytes()
        val contentType =
            URLConnection.guessContentTypeFromName(resolved.name)
                ?: ImageUtil.findImageType(ByteArrayInputStream(bytes))?.mime
                ?: "application/octet-stream"

        return PageImagePayload(contentType = contentType, bytes = bytes)
    }

    fun pruneCachedArtifacts(
        now: Long = System.currentTimeMillis(),
        coverMaxAgeMs: Long = 30L * 24 * 60 * 60 * 1000,
        tempWorkspaceMaxAgeMs: Long = 6L * 60 * 60 * 1000,
        tempExportMaxAgeMs: Long = 6L * 60 * 60 * 1000,
    ): DownloadStoragePruneSummary {
        var deletedCoverFiles = 0
        var deletedTempWorkspaces = 0
        var deletedTempExports = 0

        coversRoot.toFile().listFiles()?.forEach { file ->
            val ageMs = now - file.toPath().getLastModifiedTime().toMillis()
            if (ageMs > coverMaxAgeMs && file.delete()) {
                deletedCoverFiles += 1
            }
        }

        val downloadsRoot = downloadsRoot()
        if (downloadsRoot.exists()) {
            Files.walk(downloadsRoot).use { entries ->
                entries
                    .sorted(Comparator.reverseOrder())
                    .forEach { entry ->
                        val ageMs = now - entry.getLastModifiedTime().toMillis()
                        val fileName = entry.fileName.toString()
                        when {
                            fileName.endsWith(".tmp") && Files.isDirectory(entry) && ageMs > tempWorkspaceMaxAgeMs -> {
                                if (entry.toFile().deleteRecursively()) {
                                    deletedTempWorkspaces += 1
                                }
                            }

                            fileName.endsWith(".export.zip") &&
                                Files.isRegularFile(entry) &&
                                ageMs > tempExportMaxAgeMs &&
                                entry.deleteIfExists() -> {
                                deletedTempExports += 1
                            }
                        }
                    }
            }
        }

        return DownloadStoragePruneSummary(
            deletedCoverFiles = deletedCoverFiles,
            deletedTempWorkspaces = deletedTempWorkspaces,
            deletedTempExports = deletedTempExports,
        )
    }

    private fun readDirectoryPage(
        directory: Path,
        index: Int,
    ): PageImagePayload {
        require(directory.exists() && directory.isDirectory()) { "Downloaded chapter directory is unavailable" }
        val imageFiles =
            Files.list(directory).use { stream ->
                stream
                    .filter { path -> Files.isRegularFile(path) }
                    .sorted(compareBy { it.fileName.toString() })
                    .toList()
            }
        val file = imageFiles.getOrNull(index) ?: error("Downloaded page index out of bounds")
        val bytes = file.readBytes()
        val contentType =
            URLConnection.guessContentTypeFromName(file.name)
                ?: ImageUtil.findImageType(file::inputStream)?.mime
                ?: "application/octet-stream"
        return PageImagePayload(contentType = contentType, bytes = bytes)
    }

    private fun storedChapterPath(
        titleId: String,
        titleName: String,
        sourceId: String,
        sourcePkg: String,
        sourceLang: String,
        chapterUrl: String,
        chapterName: String,
        chapterNumber: Double?,
    ): Path =
        downloadsRoot()
            .resolve(titleDirectoryName(titleName, titleId))
            .resolve(sourceDirectoryName(sourcePkg, sourceLang, sourceId))
            .resolve(chapterDirectoryName(chapterName, chapterNumber, chapterUrl))

    private fun titleDirectoryName(
        titleName: String,
        titleId: String,
    ): String = "${slugSegment(titleName, 72, "title")}--${shortSuffix(titleId)}"

    private fun sourceDirectoryName(
        sourcePkg: String,
        sourceLang: String,
        sourceId: String,
    ): String {
        val baseName =
            buildString {
                append(sourcePkg.substringAfterLast('.').ifBlank { "source" })
                if (sourceLang.isNotBlank()) {
                    append("-")
                    append(sourceLang)
                }
            }
        return "${slugSegment(baseName, 48, "source")}--${shortSuffix(sourceId)}"
    }

    private fun chapterDirectoryName(
        chapterName: String,
        chapterNumber: Double?,
        chapterUrl: String,
    ): String {
        val numberPrefix = formatChapterNumber(chapterNumber)
        val raw =
            listOfNotNull(numberPrefix, chapterName.trim().takeIf { it.isNotEmpty() })
                .joinToString(" ")
                .ifBlank { "chapter" }
        return "${slugSegment(raw, 88, "chapter")}--${hashKey(chapterUrl)}"
    }

    private fun formatChapterNumber(chapterNumber: Double?): String? {
        val value = chapterNumber ?: return null
        if (!value.isFinite()) return null
        val normalized = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
        return "ch-$normalized"
    }

    private fun slugSegment(
        value: String,
        maxLength: Int,
        fallback: String,
    ): String {
        val normalized =
            Normalizer
                .normalize(value.lowercase(), Normalizer.Form.NFKD)
                .replace("\\p{M}+".toRegex(), "")
                .replace("[^a-z0-9]+".toRegex(), "-")
                .trim('-')
                .take(maxLength)
                .trim('-')
        return normalized.ifBlank { fallback }
    }

    private fun shortSuffix(value: String): String = hashKey(value).take(6)

    private fun resolveRelative(
        root: Path,
        relativePath: String,
    ): Path {
        val resolved = root.resolve(relativePath).normalize()
        require(resolved.startsWith(root)) { "Resolved path escapes storage root" }
        return resolved
    }

    private fun downloadsRoot(): Path {
        val configured = ConfigManager.config.downloads.downloadPath.trim()
        val envDefault = System.getenv("MANGARR_DOWNLOADS_DIR")?.trim().orEmpty()
        val root =
            if (configured.isNotEmpty()) {
                Paths.get(configured)
            } else if (envDefault.isNotEmpty()) {
                Paths.get(envDefault)
            } else {
                Paths.get(CONTAINER_DEFAULT_DOWNLOADS_PATH)
            }.toAbsolutePath().normalize()
        Files.createDirectories(root)
        return root
    }

    private fun deleteResolvedStoredChapter(path: Path): Boolean =
        if (path.exists() && path.isDirectory()) {
            path.toFile().deleteRecursively()
        } else {
            false
        }

    private fun countStoredPages(path: Path): Int =
        Files.list(path).use { stream ->
            stream.filter { candidate -> Files.isRegularFile(candidate) && isImage(candidate.name) }.count().toInt()
        }

    private fun totalStoredSize(root: Path): Long =
        if (!root.exists()) {
            0L
        } else {
            pathSize(root)
        }

    private fun writeArchive(
        sourceDir: Path,
        target: Path,
    ) {
        ZipOutputStream(target.outputStream()).use { output ->
            Files.walk(sourceDir).use { stream ->
                stream
                    .filter { path -> Files.isRegularFile(path) }
                    .sorted(compareBy { it.relativeTo(sourceDir).pathString })
                    .forEach { path ->
                        val entryName = path.relativeTo(sourceDir).pathString.replace('\\', '/')
                        output.putNextEntry(ZipEntry(entryName))
                        path.inputStream().use { input -> input.copyTo(output) }
                        output.closeEntry()
                    }
            }
        }
    }

    private fun pathSize(path: Path): Long =
        if (Files.isDirectory(path)) {
            Files.walk(path).use { stream ->
                stream.filter { candidate -> Files.isRegularFile(candidate) }.mapToLong { candidate ->
                    Files.size(candidate)
                }.sum()
            }
        } else {
            Files.size(path)
        }

    private fun hashKey(value: String): String =
        MessageDigest
            .getInstance("SHA-1")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { byte -> "%02x".format(byte) }
            .take(12)

    private fun isImage(name: String): Boolean =
        URLConnection.guessContentTypeFromName(name)?.startsWith("image/") == true
}

data class ChapterWorkspace(
    val tempDir: Path,
    val finalDir: Path,
)

data class DownloadStoragePruneSummary(
    val deletedCoverFiles: Int,
    val deletedTempWorkspaces: Int,
    val deletedTempExports: Int,
)
