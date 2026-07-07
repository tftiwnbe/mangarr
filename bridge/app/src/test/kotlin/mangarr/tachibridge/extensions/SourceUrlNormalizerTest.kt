package mangarr.tachibridge.extensions

import kotlin.test.Test
import kotlin.test.assertEquals

class SourceUrlNormalizerTest {
    @Test
    fun collapsesDuplicateSlashesInRelativePaths() {
        assertEquals(
            "/read/gist/token/4/0",
            normalizeSourceUrlPath("/read/gist/token//4/0"),
        )
    }

    @Test
    fun collapsesDuplicateSlashesInAbsoluteUrlsWithoutTouchingQuery() {
        assertEquals(
            "https://cubari.moe/read/gist/token/4/0?quality=high#page",
            normalizeSourceUrlPath("https://cubari.moe/read/gist/token//4/0?quality=high#page"),
        )
    }
}
