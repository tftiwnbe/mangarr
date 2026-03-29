package mangarr.tachibridge.extensions

import androidx.preference.CheckBoxPreference
import androidx.preference.DialogPreference
import androidx.preference.EditTextPreference
import androidx.preference.ListPreference
import androidx.preference.MultiSelectListPreference
import androidx.preference.Preference
import androidx.preference.SwitchPreferenceCompat
import androidx.preference.TwoStatePreference
import eu.kanade.tachiyomi.source.model.Filter as SourceFilter
import eu.kanade.tachiyomi.source.model.FilterList
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import mangarr.tachibridge.config.PreferenceValue

internal fun applySearchFiltersToList(
	filterList: FilterList,
	searchFilters: Map<String, String>,
) {
	if (searchFilters.isEmpty()) return

	filterList.forEachIndexed { index, filter ->
		val key = "search_$index"
		val raw = searchFilters[key] ?: return@forEachIndexed
		val parsed = runCatching { Json.parseToJsonElement(raw) }.getOrNull() ?: return@forEachIndexed

		when (filter) {
			is SourceFilter.Text -> {
				val text = (parsed as? JsonPrimitive)?.contentOrNull ?: return@forEachIndexed
				filter.state = text
			}

			is SourceFilter.CheckBox -> {
				val bool = (parsed as? JsonPrimitive)?.booleanOrNull ?: return@forEachIndexed
				filter.state = bool
			}

			is SourceFilter.TriState -> {
				val value = parseSearchFilterIntValue(parsed) ?: return@forEachIndexed
				filter.state = value.coerceIn(
					SourceFilter.TriState.STATE_IGNORE,
					SourceFilter.TriState.STATE_EXCLUDE,
				)
			}

			is SourceFilter.Select<*> -> {
				val value = parseSearchFilterIntValue(parsed) ?: return@forEachIndexed
				val maxIndex = (filter.values.size - 1).coerceAtLeast(0)
				filter.state = value.coerceIn(0, maxIndex)
			}

			is SourceFilter.Sort -> {
				val token = (parsed as? JsonPrimitive)?.contentOrNull ?: return@forEachIndexed
				val parts = token.split(":")
				val selectedIndex = parts.getOrNull(0)?.toIntOrNull() ?: return@forEachIndexed
				val ascending = parts.getOrNull(1) != "desc"
				if (selectedIndex in filter.values.indices) {
					filter.state = SourceFilter.Sort.Selection(selectedIndex, ascending)
				}
			}

			is SourceFilter.Group<*> -> {
				val selected =
					(parsed as? JsonArray)
						?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.toIntOrNull() }
						?.toSet()
						?: return@forEachIndexed

				@Suppress("UNCHECKED_CAST")
				val groupItems = filter.state as? List<Any> ?: return@forEachIndexed
				groupItems.forEachIndexed { itemIndex, item ->
					if (item is SourceFilter.CheckBox) {
						item.state = selected.contains(itemIndex)
					}
				}
			}

			else -> Unit
		}
	}
}

internal fun encodeSearchFilterDefinition(
	index: Int,
	filter: SourceFilter<*>,
): Filter {
	val key = "search_$index"
	val payload =
		buildJsonObject {
			put("key", key)
			put("title", filter.name)
			put("enabled", true)
			put("visible", true)

			when (filter) {
				is SourceFilter.Text -> {
					put("type", "text")
					put("default_value", JsonPrimitive(""))
					put("current_value", JsonPrimitive(filter.state))
				}

				is SourceFilter.CheckBox -> {
					put("type", "toggle")
					put("default_value", JsonPrimitive(false))
					put("current_value", JsonPrimitive(filter.state))
				}

				is SourceFilter.TriState -> {
					put("type", "list")
					putJsonArray("entries") {
						add(JsonPrimitive("Ignore"))
						add(JsonPrimitive("Include"))
						add(JsonPrimitive("Exclude"))
					}
					putJsonArray("entry_values") {
						add(JsonPrimitive("0"))
						add(JsonPrimitive("1"))
						add(JsonPrimitive("2"))
					}
					put("default_value", JsonPrimitive("0"))
					put("current_value", JsonPrimitive(filter.state.toString()))
				}

				is SourceFilter.Select<*> -> {
					put("type", "list")
					putJsonArray("entries") {
						filter.values.forEach { add(JsonPrimitive(it.toString())) }
					}
					putJsonArray("entry_values") {
						filter.values.indices.forEach { add(JsonPrimitive(it.toString())) }
					}
					put("default_value", JsonPrimitive("0"))
					put("current_value", JsonPrimitive(filter.state.toString()))
				}

				is SourceFilter.Sort -> {
					put("type", "list")
					putJsonArray("entries") {
						filter.values.forEach { value ->
							add(JsonPrimitive("${value} (Asc)"))
							add(JsonPrimitive("${value} (Desc)"))
						}
					}
					putJsonArray("entry_values") {
						filter.values.indices.forEach { idx ->
							add(JsonPrimitive("$idx:asc"))
							add(JsonPrimitive("$idx:desc"))
						}
					}
					val current =
						filter.state?.let { "${it.index}:${if (it.ascending) "asc" else "desc"}" } ?: "0:asc"
					put("default_value", JsonPrimitive("0:asc"))
					put("current_value", JsonPrimitive(current))
				}

				is SourceFilter.Group<*> -> {
					@Suppress("UNCHECKED_CAST")
					val groupItems = filter.state as? List<Any> ?: emptyList()
					put("type", "multi_select")
					putJsonArray("entries") {
						groupItems.forEach { item ->
							val label =
								when (item) {
									is SourceFilter<*> -> item.name
									else -> item.toString()
								}
							add(JsonPrimitive(label))
						}
					}
					putJsonArray("entry_values") {
						groupItems.indices.forEach { add(JsonPrimitive(it.toString())) }
					}
					val selected =
						groupItems.mapIndexedNotNull { itemIndex, item ->
							if (item is SourceFilter.CheckBox && item.state) {
								itemIndex.toString()
							} else {
								null
							}
						}
					put("default_value", JsonArray(emptyList()))
					put("current_value", JsonArray(selected.map { JsonPrimitive(it) }))
				}

				is SourceFilter.Header, is SourceFilter.Separator -> {
					put("type", "text")
					put("enabled", false)
					put("visible", false)
					put("default_value", JsonPrimitive(""))
					put("current_value", JsonPrimitive(""))
				}

				else -> {
					put("type", "text")
					put("default_value", JsonPrimitive(""))
					put("current_value", JsonPrimitive(filter.state?.toString() ?: ""))
				}
			}
		}

	return Filter
		.newBuilder()
		.setName(filter.name)
		.setType(payload["type"]?.jsonPrimitive?.content ?: "text")
		.setData(Json.encodeToString(JsonElement.serializer(), payload))
		.build()
}

internal fun extensionPreferenceType(preference: Preference): String =
	when (preference) {
		is ListPreference -> "list"
		is MultiSelectListPreference -> "multi_select"
		is SwitchPreferenceCompat, is CheckBoxPreference, is TwoStatePreference -> "toggle"
		is EditTextPreference -> "text"
		else -> "text"
	}

internal fun encodeExtensionPreference(
	preference: Preference,
	type: String,
): String {
	val defaultValue = runCatching { preference.defaultValue }.getOrNull()
	val currentValue = runCatching { preference.currentValue }.getOrNull()

	val payload =
		buildJsonObject {
			put("key", preference.key ?: "")
			put("title", preference.title?.toString() ?: preference.key ?: "Preference")
			put("summary", preference.summary?.toString() ?: "")
			put("type", type)
			put("enabled", preference.isEnabled)
			put("visible", preference.visible)
			put("default_value", extensionPreferenceValueToJsonElement(defaultValue))
			put("current_value", extensionPreferenceValueToJsonElement(currentValue))

			if (preference is ListPreference) {
				putJsonArray("entries") {
					preference.entries?.forEach { add(JsonPrimitive(it.toString())) }
				}
				putJsonArray("entry_values") {
					preference.entryValues?.forEach { add(JsonPrimitive(it.toString())) }
				}
			}

			if (preference is MultiSelectListPreference) {
				putJsonArray("entries") {
					preference.entries?.forEach { add(JsonPrimitive(it.toString())) }
				}
				putJsonArray("entry_values") {
					preference.entryValues?.forEach { add(JsonPrimitive(it.toString())) }
				}
			}

			if (preference is DialogPreference) {
				put("dialog_title", preference.dialogTitle?.toString() ?: "")
				put("dialog_message", preference.dialogMessage?.toString() ?: "")
			}
		}

	return Json.encodeToString(JsonElement.serializer(), payload)
}

internal fun encodeStoredPreferenceFilter(
	key: String,
	value: PreferenceValue,
): Filter {
	val payload =
		buildJsonObject {
			put("key", key)
			put("title", key)
			put("summary", "Imported storage value")
			put("type", "text")
			put("enabled", true)
			put("visible", false)
			put("default_value", JsonNull)
			put("current_value", storedPreferenceValueToJsonElement(value))
		}

	return Filter
		.newBuilder()
		.setName(key)
		.setType("text")
		.setData(Json.encodeToString(JsonElement.serializer(), payload))
		.build()
}

internal fun parseStoredPreferenceValue(raw: String): PreferenceValue {
	val parsed =
		runCatching { Json.parseToJsonElement(raw) }.getOrNull()
			?: return parseStoredPrimitiveFallback(raw)

	return when (parsed) {
		is JsonArray -> {
			PreferenceValue.StringSetValue(
				parsed
					.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
					.toSet(),
			)
		}

		is JsonPrimitive -> {
			val content = parsed.contentOrNull ?: raw
			val boolValue = parsed.booleanOrNull
			val longValue = parsed.longOrNull
			val doubleValue = parsed.doubleOrNull
			when {
				parsed.isString -> PreferenceValue.StringValue(content)
				boolValue != null -> PreferenceValue.BooleanValue(boolValue)
				longValue != null && longValue in Int.MIN_VALUE..Int.MAX_VALUE -> PreferenceValue.IntValue(longValue.toInt())
				longValue != null -> PreferenceValue.LongValue(longValue)
				doubleValue != null -> PreferenceValue.FloatValue(doubleValue.toFloat())
				else -> PreferenceValue.StringValue(content)
			}
		}

		else -> PreferenceValue.StringValue(raw)
	}
}

private fun parseStoredPrimitiveFallback(raw: String): PreferenceValue {
	val value = raw.trim()
	return when {
		value.equals("true", ignoreCase = true) -> PreferenceValue.BooleanValue(true)
		value.equals("false", ignoreCase = true) -> PreferenceValue.BooleanValue(false)
		value.toIntOrNull() != null -> PreferenceValue.IntValue(value.toInt())
		value.toLongOrNull() != null -> PreferenceValue.LongValue(value.toLong())
		value.toFloatOrNull() != null -> PreferenceValue.FloatValue(value.toFloat())
		else -> PreferenceValue.StringValue(raw)
	}
}

private fun parseSearchFilterIntValue(value: JsonElement): Int? =
	when (value) {
		is JsonPrimitive -> value.intOrNull ?: value.contentOrNull?.toIntOrNull()
		else -> null
	}

private fun storedPreferenceValueToJsonElement(value: PreferenceValue): JsonElement =
	when (value) {
		is PreferenceValue.BooleanValue -> JsonPrimitive(value.value)
		is PreferenceValue.IntValue -> JsonPrimitive(value.value)
		is PreferenceValue.LongValue -> JsonPrimitive(value.value)
		is PreferenceValue.FloatValue -> JsonPrimitive(value.value)
		is PreferenceValue.StringValue -> JsonPrimitive(value.value)
		is PreferenceValue.StringSetValue -> JsonArray(value.value.map { JsonPrimitive(it) })
	}

private fun extensionPreferenceValueToJsonElement(value: Any?): JsonElement =
	when (value) {
		null -> JsonNull
		is String -> JsonPrimitive(value)
		is Boolean -> JsonPrimitive(value)
		is Number -> JsonPrimitive(value)
		is Set<*> -> {
			val entries = value.map { it.toString() }
			JsonArray(entries.map { JsonPrimitive(it) })
		}
		is Collection<*> -> JsonArray(value.map { extensionPreferenceValueToJsonElement(it) })
		is Array<*> -> JsonArray(value.map { extensionPreferenceValueToJsonElement(it) })
		else -> JsonPrimitive(value.toString())
	}
