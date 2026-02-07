package mangarr.tachibridge.util

import java.io.InputStream
import java.net.URLConnection

object ImageUtil {
    fun isImage(
        name: String,
        openStream: (() -> InputStream)? = null,
    ): Boolean {
        // First, try to guess type from file name
        val contentType =
            try {
                URLConnection.guessContentTypeFromName(name)
            } catch (e: Exception) {
                null
            }

        if (contentType?.startsWith("image/") == true) return true

        // Only read the stream if necessary
        if (openStream != null) {
            // Lazily check image type from stream
            val type = findImageType(openStream)
            if (type != null) return true
        }

        return false
    }

    fun findImageType(openStream: () -> InputStream): ImageType? = openStream().use { findImageType(it) }

    fun findImageType(stream: InputStream): ImageType? {
        val bytes = ByteArray(12)
        val length =
            try {
                if (stream.markSupported()) {
                    stream.mark(bytes.size)
                    val read = stream.read(bytes)
                    stream.reset()
                    read
                } else {
                    stream.read(bytes)
                }
            } catch (_: Exception) {
                return null
            }

        if (length == -1) return null

        IMAGE_MAGIC.forEach { (magic, type) ->
            if (bytes.startsWith(magic)) return type
        }

        return if (isHEIF(bytes)) ImageType.HEIF else null
    }

    private val HEIF_TYPES = listOf("heic", "heis", "hevc", "mif1", "msf1")

    private fun isHEIF(bytes: ByteArray): Boolean {
        if (bytes.size < 12) return false
        val header = bytes.copyOfRange(4, 12).toString(Charsets.US_ASCII)
        return HEIF_TYPES.any { header.startsWith(it) }
    }

    private fun ByteArray.startsWith(prefix: ByteArray): Boolean =
        this.size >= prefix.size && this.sliceArray(0.until(prefix.size)).contentEquals(prefix)

    private val IMAGE_MAGIC: Map<ByteArray, ImageType> =
        mapOf(
            byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte()) to ImageType.JPEG,
            byteArrayOf(0x89.toByte(), 0x50.toByte(), 0x4E.toByte(), 0x47.toByte()) to ImageType.PNG,
            "GIF8".toByteArray() to ImageType.GIF,
            "RIFF".toByteArray() to ImageType.WEBP,
            "ftypavif".toByteArray() to ImageType.AVIF,
            byteArrayOf(0xFF.toByte(), 0x0A.toByte()) to ImageType.JXL,
        )

    enum class ImageType(
        val mime: String,
        val extension: String,
    ) {
        AVIF("image/avif", "avif"),
        GIF("image/gif", "gif"),
        HEIF("image/heif", "heif"),
        JPEG("image/jpeg", "jpg"),
        JXL("image/jxl", "jxl"),
        PNG("image/png", "png"),
        WEBP("image/webp", "webp"),
    }
}
