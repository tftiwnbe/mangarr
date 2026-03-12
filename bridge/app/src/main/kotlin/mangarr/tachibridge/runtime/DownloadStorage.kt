package mangarr.tachibridge.runtime

import mangarr.tachibridge.extensions.PageImagePayload
import mangarr.tachibridge.config.ConfigManager
import mangarr.tachibridge.util.ImageUtil
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.URLConnection
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream
import kotlin.io.path.deleteIfExists
import kotlin.io.path.exists
import kotlin.io.path.inputStream
import kotlin.io.path.isDirectory
import kotlin.io.path.name
import kotlin.io.path.outputStream
import kotlin.io.path.pathString
import kotlin.io.path.readBytes
import kotlin.io.path.relativeTo
import kotlin.io.path.writeBytes

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
    val bytes: ByteArray,
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
        chapterUrl: String,
    ): ChapterWorkspace {
        val downloadsRoot = downloadsRoot()
        val titleDir = downloadsRoot.resolve(titleId)
        Files.createDirectories(titleDir)

        val chapterKey = hashKey(chapterUrl)
        val tempDir = titleDir.resolve("$chapterKey.tmp")
        val finalDir = titleDir.resolve(chapterKey)
        val archiveFile = titleDir.resolve("$chapterKey.cbz")

        finalDir.toFile().deleteRecursively()
        archiveFile.deleteIfExists()
        tempDir.toFile().deleteRecursively()
        Files.createDirectories(tempDir)

        return ChapterWorkspace(
            tempDir = tempDir,
            finalDir = finalDir,
            archiveFile = archiveFile,
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

    fun finalizeChapterDownload(
        workspace: ChapterWorkspace,
        archive: Boolean,
    ): StoredChapterPayload {
        val downloadsRoot = downloadsRoot()
        val target =
            if (archive) {
                writeArchive(workspace.tempDir, workspace.archiveFile)
                workspace.tempDir.toFile().deleteRecursively()
                workspace.archiveFile
            } else {
                Files.move(workspace.tempDir, workspace.finalDir)
                workspace.finalDir
            }

        return StoredChapterPayload(
            storageKind = if (archive) "archive" else "directory",
            localRelativePath = target.relativeTo(downloadsRoot).pathString.replace('\\', '/'),
            fileSizeBytes = pathSize(target),
            pageCount = countStoredPages(target, if (archive) "archive" else "directory"),
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
        storageKind: String,
        index: Int,
    ): PageImagePayload {
        require(index >= 0) { "Page index must be non-negative" }
        val resolved = resolveRelative(downloadsRoot(), relativePath)
        return when (storageKind) {
            "directory" -> readDirectoryPage(resolved, index)
            "archive" -> readArchivePage(resolved, index)
            else -> error("Unsupported storage kind: $storageKind")
        }
    }

    fun readStoredChapterFile(
        relativePath: String,
        storageKind: String,
    ): StoredChapterFilePayload {
        val resolved = resolveRelative(downloadsRoot(), relativePath)
        return when (storageKind) {
            "archive" ->
                StoredChapterFilePayload(
                    fileName = resolved.fileName.toString(),
                    contentType = "application/vnd.comicbook+zip",
                    bytes = resolved.readBytes(),
                )
            "directory" -> {
                val archiveName = "${resolved.fileName}.cbz"
                StoredChapterFilePayload(
                    fileName = archiveName,
                    contentType = "application/vnd.comicbook+zip",
                    bytes = zipDirectoryToBytes(resolved),
                )
            }
            else -> error("Unsupported storage kind: $storageKind")
        }
    }

    fun resolveStoredChapter(
        titleId: String,
        chapterUrl: String,
    ): StoredChapterPayload? {
        val downloadsRoot = downloadsRoot()
        val titleDir = downloadsRoot.resolve(titleId)
        val chapterKey = hashKey(chapterUrl)
        val archive = titleDir.resolve("$chapterKey.cbz")
        if (archive.exists()) {
            return StoredChapterPayload(
                storageKind = "archive",
                localRelativePath = archive.relativeTo(downloadsRoot).pathString.replace('\\', '/'),
                fileSizeBytes = pathSize(archive),
                pageCount = countStoredPages(archive, "archive"),
            )
        }

        val directory = titleDir.resolve(chapterKey)
        if (directory.exists() && directory.isDirectory()) {
            return StoredChapterPayload(
                storageKind = "directory",
                localRelativePath = directory.relativeTo(downloadsRoot).pathString.replace('\\', '/'),
                fileSizeBytes = pathSize(directory),
                pageCount = countStoredPages(directory, "directory"),
            )
        }

        return null
    }

    fun deleteStoredChapter(
        titleId: String,
        chapterUrl: String,
        relativePath: String?,
        storageKind: String?,
    ): Boolean {
        val downloadsRoot = downloadsRoot()
        var deleted = false

        if (!relativePath.isNullOrBlank() && !storageKind.isNullOrBlank()) {
            val resolved = resolveRelative(downloadsRoot, relativePath)
            deleted = deleteResolvedStoredChapter(resolved, storageKind)
        }

        val chapterKey = hashKey(chapterUrl)
        val titleDir = downloadsRoot.resolve(titleId)
        val archive = titleDir.resolve("$chapterKey.cbz")
        val directory = titleDir.resolve(chapterKey)
        deleted = deleteResolvedStoredChapter(archive, "archive") || deleted
        deleted = deleteResolvedStoredChapter(directory, "directory") || deleted

        return deleted
    }

    fun summary(): DownloadStorageSummary {
        val downloadsRoot = downloadsRoot()
        Files.createDirectories(downloadsRoot)
        val store = Files.getFileStore(downloadsRoot)
        val totalSpaceBytes = store.totalSpace
        val freeSpaceBytes = store.usableSpace
        return DownloadStorageSummary(
            downloadPath = downloadsRoot.toAbsolutePath().normalize().pathString,
            usedSpaceBytes = totalStoredSize(downloadsRoot),
            freeSpaceBytes = freeSpaceBytes,
            totalSpaceBytes = totalSpaceBytes,
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

    private fun readArchivePage(
        archive: Path,
        index: Int,
    ): PageImagePayload {
        require(archive.exists()) { "Downloaded archive is unavailable" }
        ZipFile(archive.toFile()).use { zip ->
            val entries =
                zip.entries()
                    .toList()
                    .filter { entry -> !entry.isDirectory && isImage(entry.name) }
                    .sortedBy { it.name }
            val entry = entries.getOrNull(index) ?: error("Archived page index out of bounds")
            val bytes = zip.getInputStream(entry).use { stream -> stream.readBytes() }
            val contentType =
                URLConnection.guessContentTypeFromName(entry.name)
                    ?: ImageUtil.findImageType(ByteArrayInputStream(bytes))?.mime
                    ?: "application/octet-stream"
            return PageImagePayload(contentType = contentType, bytes = bytes)
        }
    }

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
        val root =
            if (configured.isEmpty()) {
                dataRoot.resolve("downloads")
            } else {
                Paths.get(configured)
            }.toAbsolutePath().normalize()
        Files.createDirectories(root)
        return root
    }

    private fun deleteResolvedStoredChapter(
        path: Path,
        storageKind: String,
    ): Boolean =
        when (storageKind) {
            "archive" -> path.deleteIfExists()
            "directory" ->
                if (path.exists() && path.isDirectory()) {
                    path.toFile().deleteRecursively()
                } else {
                    false
                }
            else -> false
        }

    private fun countStoredPages(
        path: Path,
        storageKind: String,
    ): Int =
        when (storageKind) {
            "directory" ->
                Files.list(path).use { stream ->
                    stream.filter { candidate -> Files.isRegularFile(candidate) && isImage(candidate.name) }.count().toInt()
                }
            "archive" ->
                ZipFile(path.toFile()).use { zip ->
                    zip.entries().toList().count { entry -> !entry.isDirectory && isImage(entry.name) }
                }
            else -> 0
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

    private fun zipDirectoryToBytes(sourceDir: Path): ByteArray {
        require(sourceDir.exists() && sourceDir.isDirectory()) { "Downloaded chapter directory is unavailable" }
        val buffer = ByteArrayOutputStream()
        ZipOutputStream(buffer).use { output ->
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
        return buffer.toByteArray()
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
    val archiveFile: Path,
)
