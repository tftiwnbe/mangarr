package mangarr.tachibridge.runtime

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import java.io.IOException
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
}
