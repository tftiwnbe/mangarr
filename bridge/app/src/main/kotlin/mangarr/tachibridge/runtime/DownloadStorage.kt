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
import java.nio.file.DirectoryNotEmptyException
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

data class StoredChapterNormalizationPayload(
    val stored: StoredChapterPayload?,
    val moved: Boolean,
    val conflict: Boolean,
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
        downloadTaskId: String,
        attemptOwner: String,
    ): ChapterWorkspace {
        val finalDir =
            normalizedStoredChapterPath(
                titleId = titleId,
                titleName = titleName,
                sourceId = sourceId,
                sourcePkg = sourcePkg,
                sourceLang = sourceLang,
                chapterName = chapterName,
                chapterNumber = chapterNumber,
            )
        val tempRootDir = finalDir.parent.resolve("${finalDir.fileName}.tmp")
        val tempDir = tempRootDir.resolve(attemptWorkspaceName(downloadTaskId, attemptOwner))

        tempDir.toFile().deleteRecursively()
        Files.createDirectories(tempDir)

        return ChapterWorkspace(
            tempRootDir = tempRootDir,
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
        val existing = existingStoredChapterPayload(workspace.finalDir, downloadsRoot)
        if (existing != null) {
            cleanupChapterWorkspace(workspace)
            return existing
        }
        if (shouldReplaceIncompleteStoredChapterDirectory(workspace.finalDir)) {
            workspace.finalDir.toFile().deleteRecursively()
        }
        Files.createDirectories(workspace.finalDir.parent)
        try {
            Files.move(
                workspace.tempDir,
                workspace.finalDir,
                StandardCopyOption.REPLACE_EXISTING,
                StandardCopyOption.ATOMIC_MOVE,
            )
        } catch (error: DirectoryNotEmptyException) {
            val racedExisting = existingStoredChapterPayload(workspace.finalDir, downloadsRoot)
            if (racedExisting != null) {
                cleanupChapterWorkspace(workspace)
                return racedExisting
            }
            if (shouldReplaceIncompleteStoredChapterDirectory(workspace.finalDir)) {
                workspace.finalDir.toFile().deleteRecursively()
                Files.move(
                    workspace.tempDir,
                    workspace.finalDir,
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE,
                )
            } else {
                throw error
            }
        }
        deleteEmptyTempRoot(workspace.tempRootDir)

        return StoredChapterPayload(
            storageKind = "directory",
            localRelativePath = workspace.finalDir.relativeTo(downloadsRoot).pathString.replace('\\', '/'),
            fileSizeBytes = pathSize(workspace.finalDir),
            pageCount = countStoredPages(workspace.finalDir),
        )
    }

    fun cleanupChapterWorkspace(workspace: ChapterWorkspace) {
        workspace.tempDir.toFile().deleteRecursively()
        deleteEmptyTempRoot(workspace.tempRootDir)
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
            resolveStoredChapterDirectory(
                titleId = titleId,
                titleName = titleName,
                sourceId = sourceId,
                sourcePkg = sourcePkg,
                sourceLang = sourceLang,
                chapterUrl = chapterUrl,
                chapterName = chapterName,
                chapterNumber = chapterNumber,
            ) ?: return null

        return existingStoredChapterPayload(directory, downloadsRoot())
    }

    fun normalizeStoredChapter(
        titleId: String,
        titleName: String,
        sourceId: String,
        sourcePkg: String,
        sourceLang: String,
        chapterUrl: String,
        chapterName: String,
        chapterNumber: Double?,
        relativePath: String?,
    ): StoredChapterNormalizationPayload {
        val downloadsRoot = downloadsRoot()
        val currentDirectory =
            if (!relativePath.isNullOrBlank()) {
                resolveRelative(downloadsRoot, relativePath).takeIf { it.exists() && it.isDirectory() }
            } else {
                resolveStoredChapterDirectory(
                    titleId = titleId,
                    titleName = titleName,
                    sourceId = sourceId,
                    sourcePkg = sourcePkg,
                    sourceLang = sourceLang,
                    chapterUrl = chapterUrl,
                    chapterName = chapterName,
                    chapterNumber = chapterNumber,
                )
            } ?: return StoredChapterNormalizationPayload(stored = null, moved = false, conflict = false)

        val targetDirectory =
            normalizedStoredChapterPath(
                titleId = titleId,
                titleName = titleName,
                sourceId = sourceId,
                sourcePkg = sourcePkg,
                sourceLang = sourceLang,
                chapterName = chapterName,
                chapterNumber = chapterNumber,
                currentDirectory = currentDirectory,
            )

        if (currentDirectory == targetDirectory) {
            return StoredChapterNormalizationPayload(
                stored = existingStoredChapterPayload(currentDirectory, downloadsRoot),
                moved = false,
                conflict = false,
            )
        }

        if (targetDirectory.exists()) {
            val targetStored = existingStoredChapterPayload(targetDirectory, downloadsRoot)
            if (targetStored != null) {
                currentDirectory.toFile().deleteRecursively()
                cleanupEmptyAncestors(currentDirectory.parent, downloadsRoot)
                return StoredChapterNormalizationPayload(
                    stored = targetStored,
                    moved = true,
                    conflict = false,
                )
            }
            return StoredChapterNormalizationPayload(
                stored = existingStoredChapterPayload(currentDirectory, downloadsRoot),
                moved = false,
                conflict = true,
            )
        }

        Files.createDirectories(targetDirectory.parent)
        Files.move(currentDirectory, targetDirectory, StandardCopyOption.ATOMIC_MOVE)
        cleanupEmptyAncestors(currentDirectory.parent, downloadsRoot)

        return StoredChapterNormalizationPayload(
            stored = existingStoredChapterPayload(targetDirectory, downloadsRoot),
            moved = true,
            conflict = false,
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
            resolveStoredChapterDirectory(
                titleId = titleId,
                titleName = titleName,
                sourceId = sourceId,
                sourcePkg = sourcePkg,
                sourceLang = sourceLang,
                chapterUrl = chapterUrl,
                chapterName = chapterName,
                chapterNumber = chapterNumber,
            ) ?: return false
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
    ): Path {
        val downloadsRoot = downloadsRoot()
        val titleDir =
            resolveContainerDirectory(
                parent = downloadsRoot,
                preferredName = titleDirectoryName(titleName),
                stableSuffix = "--${shortSuffix(titleId)}",
            )
        val sourceDir =
            resolveContainerDirectory(
                parent = titleDir,
                preferredName = sourceDirectoryName(sourcePkg, sourceLang),
                stableSuffix = "--${shortSuffix(sourceId)}",
            )
        return sourceDir.resolve(chapterDirectoryName(chapterName, chapterNumber, chapterUrl))
    }

    private fun normalizedStoredChapterPath(
        titleId: String,
        titleName: String,
        sourceId: String,
        sourcePkg: String,
        sourceLang: String,
        chapterName: String,
        chapterNumber: Double?,
        currentDirectory: Path? = null,
    ): Path {
        val downloadsRoot = downloadsRoot()
        val currentSourceDir = currentDirectory?.parent
        val currentTitleDir = currentSourceDir?.parent
        val preferredTitleDir = downloadsRoot.resolve(titleDirectoryName(titleName))
        val preferredSourceDir = preferredTitleDir.resolve(sourceDirectoryName(sourcePkg, sourceLang))
        val titleDir =
            when {
                !preferredTitleDir.exists() || !preferredTitleDir.isDirectory() -> preferredTitleDir
                currentTitleDir == null -> preferredTitleDir
                currentTitleDir.fileName.toString() == preferredTitleDir.fileName.toString() -> preferredTitleDir
                currentTitleDir.fileName.toString().endsWith("--${shortSuffix(titleId)}") -> preferredTitleDir
                else -> downloadsRoot.resolve(collidingTitleDirectoryName(titleName, titleId))
            }
        val sourceDir =
            normalizedContainerDirectory(
                parent = titleDir,
                preferredName = sourceDirectoryName(sourcePkg, sourceLang),
                collisionName = collidingSourceDirectoryName(sourcePkg, sourceLang, sourceId),
                stableSuffix = "--${shortSuffix(sourceId)}",
                currentDirectory = currentSourceDir,
            )
        return sourceDir.resolve(normalizedChapterDirectoryName(chapterName, chapterNumber))
    }

    private fun legacyStoredChapterPath(
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
            .resolve(legacyTitleDirectoryName(titleName, titleId))
            .resolve(legacySourceDirectoryName(sourcePkg, sourceLang, sourceId))
            .resolve(legacyChapterDirectoryName(chapterName, chapterNumber, chapterUrl))

    private fun titleDirectoryName(titleName: String): String = pathSegment(titleName, 72, "title")

    private fun collidingTitleDirectoryName(
        titleName: String,
        titleId: String,
    ): String = "${titleDirectoryName(titleName)}--${shortSuffix(titleId)}"

    private fun legacyTitleDirectoryName(
        titleName: String,
        titleId: String,
    ): String = "${slugSegment(titleName, 72, "title")}--${shortSuffix(titleId)}"

    private fun sourceDirectoryName(
        sourcePkg: String,
        sourceLang: String,
    ): String {
        val baseName =
            buildString {
                append(sourcePkg.substringAfterLast('.').ifBlank { "source" })
                if (sourceLang.isNotBlank()) {
                    append("-")
                    append(sourceLang)
                }
            }
        return pathSegment(baseName, 48, "source")
    }

    private fun collidingSourceDirectoryName(
        sourcePkg: String,
        sourceLang: String,
        sourceId: String,
    ): String = "${sourceDirectoryName(sourcePkg, sourceLang)}--${shortSuffix(sourceId)}"

    private fun legacySourceDirectoryName(
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
        val normalized = normalizedChapterDirectoryName(chapterName, chapterNumber)
        return if (normalizedChapterNumber(chapterNumber) != null) {
            normalized
        } else {
            "$normalized--${hashKey(chapterUrl)}"
        }
    }

    private fun normalizedChapterDirectoryName(
        chapterName: String,
        chapterNumber: Double?,
    ): String {
        val normalizedChapter = normalizedChapterNumber(chapterNumber)
        if (normalizedChapter != null) {
            val normalizedVolume = extractVolumeNumber(chapterName)
            return if (normalizedVolume != null) {
                "v$normalizedVolume-ch-$normalizedChapter"
            } else {
                "ch-$normalizedChapter"
            }
        }
        return pathSegment(chapterLabel(chapterName, chapterNumber), 88, "chapter")
    }

    private fun legacyChapterDirectoryName(
        chapterName: String,
        chapterNumber: Double?,
        chapterUrl: String,
    ): String {
        val numberPrefix = legacyFormatChapterNumber(chapterNumber)
        val raw =
            listOfNotNull(numberPrefix, chapterName.trim().takeIf { it.isNotEmpty() })
                .joinToString(" ")
                .ifBlank { "chapter" }
        return "${slugSegment(raw, 88, "chapter")}--${hashKey(chapterUrl)}"
    }

    private fun attemptWorkspaceName(
        downloadTaskId: String,
        attemptOwner: String,
    ): String {
        val taskSegment = slugSegment(downloadTaskId, 48, "task")
        val ownerSegment = slugSegment(attemptOwner, 64, "attempt")
        return "$taskSegment-$ownerSegment"
    }

    private fun chapterLabel(
        chapterName: String,
        chapterNumber: Double?,
    ): String {
        val trimmedName = chapterName.trim()
        val numberLabel = formatChapterNumberLabel(chapterNumber)
        if (trimmedName.isBlank()) {
            return numberLabel ?: "Chapter"
        }
        if (numberLabel == null || chapterNumberAppearsInName(trimmedName, chapterNumber)) {
            return trimmedName
        }
        return "$numberLabel $trimmedName"
    }

    private fun extractVolumeNumber(chapterName: String): String? {
        val match =
            Regex("(?iu)(?:^|[^\\p{L}\\p{N}])(?:vol(?:ume)?|том)\\.?\\s*([0-9]+(?:[.,][0-9]+)?)")
                .find(chapterName)
                ?: return null
        return normalizeNumberString(match.groupValues.getOrNull(1))
    }

    private fun formatChapterNumberLabel(chapterNumber: Double?): String? {
        val normalized = normalizedChapterNumber(chapterNumber) ?: return null
        return "Chapter $normalized"
    }

    private fun legacyFormatChapterNumber(chapterNumber: Double?): String? {
        val normalized = normalizedChapterNumber(chapterNumber) ?: return null
        return "ch-$normalized"
    }

    private fun normalizedChapterNumber(chapterNumber: Double?): String? {
        val value = chapterNumber ?: return null
        if (!value.isFinite()) return null
        return if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
    }

    private fun normalizeNumberString(value: String?): String? {
        val raw = value?.trim()?.replace(',', '.') ?: return null
        val parsed = raw.toDoubleOrNull() ?: return raw.ifBlank { null }
        return if (parsed % 1.0 == 0.0) parsed.toLong().toString() else parsed.toString()
    }

    private fun chapterNumberAppearsInName(
        chapterName: String,
        chapterNumber: Double?,
    ): Boolean {
        val normalized = normalizedChapterNumber(chapterNumber) ?: return false
        val variants = buildList {
            add(Regex.escape(normalized))
            if (normalized.contains('.')) {
                add(Regex.escape(normalized.replace('.', ',')))
            }
        }
        return variants.any { variant ->
            Regex("(^|[^\\p{L}\\p{N}])$variant([^\\p{L}\\p{N}]|$)", RegexOption.IGNORE_CASE)
                .containsMatchIn(chapterName)
        }
    }

    private fun pathSegment(
        value: String,
        maxLength: Int,
        fallback: String,
    ): String {
        val cleaned =
            Normalizer
                .normalize(transliterateForPath(value), Normalizer.Form.NFKD)
                .replace("\\p{M}+".toRegex(), "")
                .replace("[\\p{Cntrl}]".toRegex(), " ")
                .replace("[/\\\\:*?\"<>|]+".toRegex(), " ")
                .replace("[^\\x20-\\x7E]+".toRegex(), " ")
                .replace("\\s+".toRegex(), " ")
                .trim()
                .trim('.')
                .take(maxLength)
                .trim()
                .trim('.')
        return cleaned.ifBlank { fallback }
    }

    private fun transliterateForPath(value: String): String =
        buildString(value.length) {
            value.forEach { char ->
                append(CYRILLIC_PATH_TRANSLITERATION[char] ?: char)
            }
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

    private fun resolveStoredChapterDirectory(
        titleId: String,
        titleName: String,
        sourceId: String,
        sourcePkg: String,
        sourceLang: String,
        chapterUrl: String,
        chapterName: String,
        chapterNumber: Double?,
    ): Path? {
        val exactCandidates =
            listOf(
                normalizedStoredChapterPath(
                    titleId = titleId,
                    titleName = titleName,
                    sourceId = sourceId,
                    sourcePkg = sourcePkg,
                    sourceLang = sourceLang,
                    chapterName = chapterName,
                    chapterNumber = chapterNumber,
                ),
                storedChapterPath(
                    titleId = titleId,
                    titleName = titleName,
                    sourceId = sourceId,
                    sourcePkg = sourcePkg,
                    sourceLang = sourceLang,
                    chapterUrl = chapterUrl,
                    chapterName = chapterName,
                    chapterNumber = chapterNumber,
                ),
                legacyStoredChapterPath(
                    titleId = titleId,
                    titleName = titleName,
                    sourceId = sourceId,
                    sourcePkg = sourcePkg,
                    sourceLang = sourceLang,
                    chapterUrl = chapterUrl,
                    chapterName = chapterName,
                    chapterNumber = chapterNumber,
                ),
            ).distinct()
        exactCandidates.firstOrNull { it.exists() && it.isDirectory() }?.let { return it }

        val downloadsRoot = downloadsRoot()
        val titleDir = findChildBySuffix(downloadsRoot, "--${shortSuffix(titleId)}") ?: return null
        val sourceDir = findChildBySuffix(titleDir, "--${shortSuffix(sourceId)}") ?: return null
        sourceDir.resolve(normalizedChapterDirectoryName(chapterName, chapterNumber))
            .takeIf { it.exists() && it.isDirectory() }
            ?.let { return it }
        return findChildBySuffix(sourceDir, "--${hashKey(chapterUrl)}")
    }

    private fun findChildBySuffix(
        parent: Path,
        suffix: String,
    ): Path? {
        if (!parent.exists() || !parent.isDirectory()) {
            return null
        }
        Files.list(parent).use { stream ->
            return stream
                .filter { Files.isDirectory(it) && it.fileName.toString().endsWith(suffix) }
                .findFirst()
                .orElse(null)
        }
    }

    private fun resolveContainerDirectory(
        parent: Path,
        preferredName: String,
        stableSuffix: String,
    ): Path {
        val preferred = parent.resolve(preferredName)
        if (preferred.exists() && preferred.isDirectory()) {
            return preferred
        }
        return findChildBySuffix(parent, stableSuffix) ?: preferred
    }

    private fun normalizedContainerDirectory(
        parent: Path,
        preferredName: String,
        collisionName: String,
        stableSuffix: String,
        currentDirectory: Path?,
    ): Path {
        val preferred = parent.resolve(preferredName)
        if (!preferred.exists() || !preferred.isDirectory()) {
            return preferred
        }
        val currentName = currentDirectory?.fileName?.toString()
        return if (currentName == null || currentName == preferredName || currentName.endsWith(stableSuffix)) {
            preferred
        } else {
            parent.resolve(collisionName)
        }
    }

    private fun existingStoredChapterPayload(
        directory: Path,
        downloadsRoot: Path,
    ): StoredChapterPayload? {
        if (!directory.exists() || !directory.isDirectory()) {
            return null
        }
        val pageCount = countStoredPages(directory)
        if (pageCount <= 0) {
            return null
        }
        return StoredChapterPayload(
            storageKind = "directory",
            localRelativePath = directory.relativeTo(downloadsRoot).pathString.replace('\\', '/'),
            fileSizeBytes = pathSize(directory),
            pageCount = pageCount,
        )
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

    private fun deleteEmptyTempRoot(path: Path) {
        if (!path.exists() || !path.isDirectory()) {
            return
        }
        Files.list(path).use { stream ->
            if (!stream.findAny().isPresent) {
                path.deleteIfExists()
            }
        }
    }

    private fun cleanupEmptyAncestors(
        start: Path,
        stopExclusive: Path,
    ) {
        var current: Path? = start
        while (current != null && current.startsWith(stopExclusive) && current != stopExclusive) {
            if (!current.exists() || !current.isDirectory()) {
                current = current.parent
                continue
            }
            val isEmpty =
                Files.list(current).use { stream ->
                    !stream.findAny().isPresent
                }
            if (!isEmpty) {
                return
            }
            current.deleteIfExists()
            current = current.parent
        }
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

    private fun shouldReplaceIncompleteStoredChapterDirectory(path: Path): Boolean {
        if (!path.exists() || !path.isDirectory()) {
            return false
        }
        if (countStoredPages(path) > 0) {
            return false
        }
        return Files.list(path).use { stream ->
            stream.anyMatch { candidate -> Files.isRegularFile(candidate) || Files.isDirectory(candidate) }
        }
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

    private companion object {
        val CYRILLIC_PATH_TRANSLITERATION =
            mapOf(
                'А' to "A",
                'Б' to "B",
                'В' to "V",
                'Г' to "G",
                'Д' to "D",
                'Е' to "E",
                'Ё' to "E",
                'Ж' to "Zh",
                'З' to "Z",
                'И' to "I",
                'Й' to "Y",
                'К' to "K",
                'Л' to "L",
                'М' to "M",
                'Н' to "N",
                'О' to "O",
                'П' to "P",
                'Р' to "R",
                'С' to "S",
                'Т' to "T",
                'У' to "U",
                'Ф' to "F",
                'Х' to "Kh",
                'Ц' to "Ts",
                'Ч' to "Ch",
                'Ш' to "Sh",
                'Щ' to "Shch",
                'Ъ' to "",
                'Ы' to "Y",
                'Ь' to "",
                'Э' to "E",
                'Ю' to "Yu",
                'Я' to "Ya",
                'а' to "a",
                'б' to "b",
                'в' to "v",
                'г' to "g",
                'д' to "d",
                'е' to "e",
                'ё' to "e",
                'ж' to "zh",
                'з' to "z",
                'и' to "i",
                'й' to "y",
                'к' to "k",
                'л' to "l",
                'м' to "m",
                'н' to "n",
                'о' to "o",
                'п' to "p",
                'р' to "r",
                'с' to "s",
                'т' to "t",
                'у' to "u",
                'ф' to "f",
                'х' to "kh",
                'ц' to "ts",
                'ч' to "ch",
                'ш' to "sh",
                'щ' to "shch",
                'ъ' to "",
                'ы' to "y",
                'ь' to "",
                'э' to "e",
                'ю' to "yu",
                'я' to "ya",
                'І' to "I",
                'Ї' to "Yi",
                'Є' to "Ye",
                'Ґ' to "G",
                'і' to "i",
                'ї' to "yi",
                'є' to "ye",
                'ґ' to "g",
            )
    }
}

data class ChapterWorkspace(
    val tempRootDir: Path,
    val tempDir: Path,
    val finalDir: Path,
)

data class DownloadStoragePruneSummary(
    val deletedCoverFiles: Int,
    val deletedTempWorkspaces: Int,
    val deletedTempExports: Int,
)
