package mangarr.tachibridge.config

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

object PreferenceValueSerializer : KSerializer<PreferenceValue> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("PreferenceValue")

    override fun deserialize(decoder: Decoder): PreferenceValue {
        val element = (decoder as JsonDecoder).decodeJsonElement()
        return when (element) {
            is JsonPrimitive -> {
                parsePrimitive(element)
            }

            is JsonArray -> {
                PreferenceValue.StringSetValue(
                    element.mapNotNull { (it as? JsonPrimitive)?.content }.toSet(),
                )
            }

            else -> {
                PreferenceValue.StringValue(element.toString())
            }
        }
    }

    override fun serialize(
        encoder: Encoder,
        value: PreferenceValue,
    ) {
        val jsonEncoder = encoder as JsonEncoder
        val element =
            when (value) {
                is PreferenceValue.StringValue -> {
                    JsonPrimitive(value.value)
                }

                is PreferenceValue.BooleanValue -> {
                    JsonPrimitive(value.value)
                }

                is PreferenceValue.IntValue -> {
                    JsonPrimitive(value.value)
                }

                is PreferenceValue.LongValue -> {
                    JsonPrimitive(value.value)
                }

                is PreferenceValue.FloatValue -> {
                    JsonPrimitive(value.value)
                }

                is PreferenceValue.StringSetValue -> {
                    buildJsonArray {
                        value.value.forEach { add(JsonPrimitive(it)) }
                    }
                }
            }
        jsonEncoder.encodeJsonElement(element)
    }

    private fun parsePrimitive(primitive: JsonPrimitive): PreferenceValue {
        primitive.booleanOrNull?.let { return PreferenceValue.BooleanValue(it) }
        primitive.longOrNull?.let {
            return if (it in Int.MIN_VALUE..Int.MAX_VALUE) {
                PreferenceValue.IntValue(it.toInt())
            } else {
                PreferenceValue.LongValue(it)
            }
        }
        primitive.doubleOrNull?.let { return PreferenceValue.FloatValue(it.toFloat()) }
        return PreferenceValue.StringValue(primitive.content)
    }
}
