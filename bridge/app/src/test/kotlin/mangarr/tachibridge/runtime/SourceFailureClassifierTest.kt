package mangarr.tachibridge.runtime

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import java.io.IOException
import java.lang.IllegalArgumentException
import java.net.ProtocolException

class SourceFailureClassifierTest {
    @Test
    fun `redirect loops are treated as permanent source failures`() {
        val error =
            IOException(
                "Too many follow-up requests: 21",
                ProtocolException("Too many follow-up requests: 21"),
            )

        assertTrue(isPermanentSourceRequestFailure(error))

        val failure = classifySourceFailure(commandType = "library.import", error = error)
        assertFalse(failure.retryable)
        assertTrue(failure.expected)
    }

    @Test
    fun `missing sources are terminal even when wrapped`() {
        val error =
            IOException(
                "Unable to fetch title",
                IllegalArgumentException("Source 6338219619148105941 not found or wrong type"),
            )

        assertTrue(isPermanentSourceRequestFailure(error))

        val failure = classifySourceFailure(commandType = "explore.title.fetch", error = error)
        assertFalse(failure.retryable)
        assertTrue(failure.expected)
    }

    @Test
    fun `plain missing source errors are terminal`() {
        val failure =
            classifySourceFailure(
                commandType = "discovery.feed.crawl",
                error = IllegalStateException("Source not found: 6338219619148105941"),
            )

        assertFalse(failure.retryable)
        assertTrue(failure.expected)
    }
}
