package mangarr.tachibridge.extensions

private val schemePrefixRegex = Regex("^[A-Za-z][A-Za-z0-9+.-]*://")

internal fun normalizeSourceUrlPath(rawUrl: String): String {
    val trimmed = rawUrl.trim()
    if (trimmed.isBlank()) {
        return trimmed
    }

    val suffixIndex =
        listOf(trimmed.indexOf('?'), trimmed.indexOf('#'))
            .filter { it >= 0 }
            .minOrNull()
            ?: -1
    val path =
        if (suffixIndex >= 0) {
            trimmed.substring(0, suffixIndex)
        } else {
            trimmed
        }
    val suffix =
        if (suffixIndex >= 0) {
            trimmed.substring(suffixIndex)
        } else {
            ""
        }

    val normalizedPath =
        schemePrefixRegex.find(path)?.value?.let { schemePrefix ->
            val remainder = path.removePrefix(schemePrefix)
            val slashIndex = remainder.indexOf('/')
            if (slashIndex < 0) {
                path
            } else {
                val authority = remainder.substring(0, slashIndex)
                val rawPath = remainder.substring(slashIndex)
                "$schemePrefix$authority${collapsePathSlashes(rawPath)}"
            }
        } ?: collapsePathSlashes(path)

    return normalizedPath + suffix
}

private fun collapsePathSlashes(path: String): String {
    if (path.isEmpty()) {
        return path
    }
    return when {
        path.startsWith("//") && !path.startsWith("///") ->
            "//" + path.removePrefix("//").replace(Regex("/{2,}"), "/")
        path.startsWith("/") ->
            "/" + path.removePrefix("/").replace(Regex("/{2,}"), "/")
        else -> path.replace(Regex("/{2,}"), "/")
    }
}
