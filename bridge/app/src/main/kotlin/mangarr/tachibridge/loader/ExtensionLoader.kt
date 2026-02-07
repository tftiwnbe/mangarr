package mangarr.tachibridge.loader

import android.content.pm.PackageInfo
import eu.kanade.tachiyomi.source.Source
import eu.kanade.tachiyomi.source.SourceFactory
import io.github.oshai.kotlinlogging.KotlinLogging
import mangarr.tachibridge.loader.PackageTools.Companion.EXTENSION_FEATURE
import mangarr.tachibridge.loader.PackageTools.Companion.LIB_VERSION_MAX
import mangarr.tachibridge.loader.PackageTools.Companion.LIB_VERSION_MIN
import mangarr.tachibridge.loader.PackageTools.Companion.METADATA_SOURCE_CLASS
import mangarr.tachibridge.loader.PackageTools.Companion.METADATA_SOURCE_FACTORY
import java.io.File
import java.nio.file.Path
import kotlin.io.path.Path
import kotlin.io.path.absolutePathString
import kotlin.io.path.createDirectories
import kotlin.io.path.createTempDirectory
import kotlin.io.path.deleteIfExists
import kotlin.io.path.exists
import kotlin.io.path.outputStream
import kotlin.io.path.relativeTo

class ExtensionLoader(
    private val directories: ExtensionsDirectories,
    private val packageTools: PackageTools,
) {
    private val logger = KotlinLogging.logger {}

    data class ExtensionMetadata(
        val packageName: String,
        val sourceClassName: String?,
        val factoryClassName: String?,
    )

    data class LoadedExtension(
        val packageInfo: PackageInfo,
        val sources: List<Source>,
        val metadata: ExtensionMetadata,
        val jarPath: String,
    )

    fun load(apkPath: String): LoadedExtension {
        val pkgInfo = packageTools.getPackageInfo(apkPath)
        validate(pkgInfo)

        val metadata = extractMetadata(pkgInfo)

        directories.extensionsRoot.createDirectories()
        val jarBaseName = buildJarBaseName(pkgInfo.packageName, pkgInfo.versionName ?: "unknown")
        val basePath = directories.extensionsRoot.resolve(jarBaseName)
        val dexFilePath = "${basePath.absolutePathString()}.dex"
        val jarFilePath = "${basePath.absolutePathString()}.jar"

        extractDex(apkPath, dexFilePath)
        try {
            packageTools.dex2jar(dexFilePath, jarFilePath, jarBaseName)
            mergeAssets(apkPath, jarFilePath)
        } finally {
            Path(dexFilePath).deleteIfExists()
        }

        val sources = instantiateSources(metadata, jarFilePath)

        return LoadedExtension(
            packageInfo = pkgInfo,
            sources = sources,
            metadata = metadata,
            jarPath = jarFilePath,
        )
    }

    fun instantiate(
        metadata: ExtensionMetadata,
        jarPath: Path,
    ): List<Source> = instantiateSources(metadata, jarPath.toAbsolutePath().toString())

    fun unloadJar(jarPath: Path) {
        packageTools.unloadJar(jarPath.toAbsolutePath().toString())
    }

    private fun validate(pkgInfo: PackageInfo) {
        val versionName =
            pkgInfo.versionName ?: throw InvalidExtensionException("Extension ${pkgInfo.packageName} is missing version information.")
        val libVersion = versionName.substringBeforeLast('.').toDoubleOrNull()
        if (libVersion == null || libVersion < LIB_VERSION_MIN || libVersion > LIB_VERSION_MAX) {
            throw InvalidExtensionException(
                "Unsupported extension library version: $libVersion. " +
                    "Supported range is $LIB_VERSION_MIN - $LIB_VERSION_MAX.",
            )
        }
        val hasFeature = pkgInfo.reqFeatures?.any { it.name == EXTENSION_FEATURE } ?: false
        if (!hasFeature) {
            throw InvalidExtensionException("APK ${pkgInfo.packageName} is not a Tachiyomi extension.")
        }
    }

    private fun extractMetadata(pkgInfo: PackageInfo): ExtensionMetadata {
        val metaData = pkgInfo.applicationInfo.metaData
        val className =
            metaData
                ?.getString(METADATA_SOURCE_CLASS)
                ?.takeIf { it.isNotBlank() }
                ?.let { if (it.startsWith(".")) pkgInfo.packageName + it else it }

        val factoryClassName =
            metaData
                ?.getString(METADATA_SOURCE_FACTORY)
                ?.takeIf { it.isNotBlank() }
                ?.let { if (it.startsWith(".")) pkgInfo.packageName + it else it }

        if (className.isNullOrBlank() && factoryClassName.isNullOrBlank()) {
            throw InvalidExtensionException("Extension is missing source class metadata.")
        }

        return ExtensionMetadata(
            packageName = pkgInfo.packageName,
            sourceClassName = className,
            factoryClassName = factoryClassName,
        )
    }

    private fun extractDex(
        apkPath: String,
        destDexPath: String,
    ) {
        val apkFile = File(apkPath)
        val destFile = File(destDexPath)

        java.util.zip.ZipInputStream(apkFile.inputStream()).use { input ->
            var entry = input.nextEntry
            while (entry != null) {
                if (!entry.isDirectory && entry.name.endsWith(".dex")) {
                    destFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                    return
                }
                entry = input.nextEntry
            }
        }
        throw InvalidExtensionException("Could not find DEX files inside APK $apkPath")
    }

    private fun mergeAssets(
        apkPath: String,
        jarPath: String,
    ) {
        val assetsDir = createTempDirectory("bridge_extension_assets")
        try {
            java.util.zip.ZipInputStream(File(apkPath).inputStream()).use { zipInput ->
                var entry = zipInput.nextEntry
                while (entry != null) {
                    if (entry.name.startsWith("assets/") && !entry.isDirectory) {
                        val relative = entry.name.removePrefix("assets/")
                        val outPath = assetsDir.resolve(relative)
                        outPath.parent?.createDirectories()
                        outPath.outputStream().use { output ->
                            zipInput.copyTo(output)
                        }
                    }
                    entry = zipInput.nextEntry
                }
            }

            if (!assetsDir.toFile().exists() || assetsDir.toFile().listFiles().isNullOrEmpty()) {
                assetsDir.toFile().deleteRecursively()
                return
            }

            val jarFile = File(jarPath)
            val tempJar = File("${jarFile.parent}/${jarFile.nameWithoutExtension}_temp.jar")
            java.util.zip.ZipInputStream(jarFile.inputStream()).use { jarInput ->
                java.util.zip.ZipOutputStream(tempJar.outputStream()).use { jarOutput ->
                    var entry = jarInput.nextEntry
                    while (entry != null) {
                        if (!entry.name.startsWith("META-INF/")) {
                            jarOutput.putNextEntry(java.util.zip.ZipEntry(entry.name))
                            jarInput.copyTo(jarOutput)
                            jarOutput.closeEntry()
                        }
                        entry = jarInput.nextEntry
                    }

                    assetsDir.toFile().walkTopDown().forEach { file ->
                        if (file.isFile) {
                            val relative =
                                file
                                    .toPath()
                                    .relativeTo(assetsDir)
                                    .toString()
                                    .replace("\\", "/")
                            val zipEntry = java.util.zip.ZipEntry("assets/$relative")
                            jarOutput.putNextEntry(zipEntry)
                            file.inputStream().use { input -> input.copyTo(jarOutput) }
                            jarOutput.closeEntry()
                        }
                    }
                }
            }

            jarFile.delete()
            tempJar.renameTo(jarFile)
        } finally {
            assetsDir.toFile().deleteRecursively()
        }
    }

    private fun buildJarBaseName(
        packageName: String,
        versionName: String,
    ): String = "${sanitizeForFilename(packageName)}-v${sanitizeForFilename(versionName)}"

    private fun sanitizeForFilename(value: String): String =
        buildString(value.length) {
            value.forEach { ch ->
                when {
                    ch.isLetterOrDigit() -> append(ch)
                    ch == '.' || ch == '-' || ch == '_' || ch == '+' -> append(ch)
                    else -> append('_')
                }
            }
        }.ifEmpty { "_" }

    private fun instantiateSources(
        metadata: ExtensionMetadata,
        jarFilePath: String,
    ): List<Source> {
        val result =
            when {
                !metadata.factoryClassName.isNullOrBlank() -> {
                    val factory = packageTools.loadExtensionSources(jarFilePath, metadata.factoryClassName)
                    if (factory is SourceFactory) {
                        factory.createSources()
                    } else {
                        throw InvalidExtensionException("Factory class ${metadata.factoryClassName} did not return SourceFactory.")
                    }
                }

                !metadata.sourceClassName.isNullOrBlank() -> {
                    when (val instance = packageTools.loadExtensionSources(jarFilePath, metadata.sourceClassName)) {
                        is Source -> listOf(instance)
                        is SourceFactory -> instance.createSources()
                        else -> throw InvalidExtensionException("Unknown source class type: ${instance.javaClass}")
                    }
                }

                else -> {
                    throw InvalidExtensionException("Extension is missing source class metadata.")
                }
            }

        logger.info { "Loaded ${result.size} source(s) from ${metadata.packageName}" }
        return result
    }
}

class InvalidExtensionException(
    message: String,
) : RuntimeException(message)
