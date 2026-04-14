package mangarr.tachibridge.runtime

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal fun normalizeRepoEntry(
	entry: mangarr.tachibridge.repo.ExtensionRepoEntry,
	repoIndexUrl: String,
): JsonObject =
	buildJsonObject {
		put("pkg", entry.pkg)
		put("name", normalizeExtensionName(entry.name))
		put("version", entry.version)
		put("lang", normalizeLangCode(entry.lang))
		put("nsfw", (entry.nsfw ?: 0) == 1)
		iconUrl(repoIndexUrl, entry.pkg)?.let { put("icon", it) }
		put(
			"sources",
			JsonArray(
				entry.sources.map { source ->
					buildJsonObject {
						put("id", source.id.toString())
						put("name", source.name)
						put("lang", normalizeLangCode(source.lang))
						put("supportsLatest", source.supportsLatest ?: true)
					}
				},
			),
		)
	}

internal fun normalizeExtensionName(name: String): String = name.removePrefix("Tachiyomi: ").trim()

internal fun repositoryLanguages(entries: List<mangarr.tachibridge.repo.ExtensionRepoEntry>): List<JsonPrimitive> =
	entries
		.asSequence()
		.flatMap { entry -> sequenceOf(entry.lang) + entry.sources.asSequence().map { source -> source.lang } }
		.map { normalizeLangCode(it) }
		.filter { it.isNotBlank() }
		.distinct()
		.sorted()
		.map(::JsonPrimitive)
		.toList()

internal fun normalizeLangCode(lang: String): String {
	val normalized = lang.trim().ifBlank { "all" }
	return if (normalized == "all") "multi" else normalized
}

internal fun iconUrl(repoIndexUrl: String, pkg: String): String? {
	val normalizedRepoUrl = repoIndexUrl.trim()
	if (normalizedRepoUrl.isBlank()) return null
	return "${normalizedRepoUrl.substringBeforeLast("/")}/icon/$pkg.png"
}
