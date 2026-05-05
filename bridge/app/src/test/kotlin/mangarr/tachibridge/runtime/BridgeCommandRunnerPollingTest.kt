package mangarr.tachibridge.runtime

import kotlin.test.Test
import kotlin.test.assertEquals

class BridgeCommandRunnerPollingTest {
    @Test
    fun `idle poll delay stays at base interval for the first few empty polls`() {
        assertEquals(2_000L, idlePollDelayMs(baseIntervalMs = 2_000L, consecutiveIdlePolls = 0))
        assertEquals(2_000L, idlePollDelayMs(baseIntervalMs = 2_000L, consecutiveIdlePolls = 1))
        assertEquals(2_000L, idlePollDelayMs(baseIntervalMs = 2_000L, consecutiveIdlePolls = 2))
    }

    @Test
    fun `idle poll delay backs off in steps and caps at fifteen seconds`() {
        assertEquals(4_000L, idlePollDelayMs(baseIntervalMs = 2_000L, consecutiveIdlePolls = 3))
        assertEquals(8_000L, idlePollDelayMs(baseIntervalMs = 2_000L, consecutiveIdlePolls = 6))
        assertEquals(15_000L, idlePollDelayMs(baseIntervalMs = 2_000L, consecutiveIdlePolls = 12))
    }
}
