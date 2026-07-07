package mangarr.tachibridge.logging

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

class EventLoggerTest {
    @Test
    fun `normalizeLogValue preserves booleans and numbers inside json objects`() {
        val json =
            Json.parseToJsonElement(
                """
                {
                  "durationMs": 932,
                  "retryable": true,
                  "pageCount": 17,
                  "message": "ok"
                }
                """.trimIndent(),
            ) as JsonObject

        val normalized = normalizeLogValue(json)
        val values = assertIs<Map<String, Any?>>(normalized)

        assertEquals(932L, values["durationMs"])
        assertEquals(true, values["retryable"])
        assertEquals(17L, values["pageCount"])
        assertEquals("ok", values["message"])
    }
}
