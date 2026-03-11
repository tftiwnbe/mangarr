package mangarr.tachibridge.runtime

import mangarr.tachibridge.extensions.PageImagePayload
import mangarr.tachibridge.util.ImageUtil
import java.io.ByteArrayInputStream
import java.net.URLConnection
import java.nio.file.Files
import java.nio.file.Path
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
)

class DownloadStorage(
    dataPath: Path,
) {
    private val downloadsRoot = dataPath.resolve("downloads")
    private val coversRoot = dataPath.resolve("covers")

    init {
        Files.createDirectories(downloadsRoot)
        Files.createDirectories(coversRoot)
    }

    fun createChapterWorkspace(
        titleId: String,
        chapterUrl: String,
    ): ChapterWorkspace {
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
        val resolved = resolveRelative(downloadsRoot, relativePath)
        return when (storageKind) {
            "directory" -> readDirectoryPage(resolved, index)
            "archive" -> readArchivePage(resolved, index)
            else -> error("Unsupported storage kind: $storageKind")
        }
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
    val archiveFile: Path,
)
