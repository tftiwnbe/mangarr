package mangarr.tachibridge.runtime

import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.min
import kotlin.math.pow

private val logger = KotlinLogging.logger {}

/**
 * Per-source adaptive rate limiter that prevents hitting rate limits.
 * Tracks request timing and automatically slows down when rate limits are detected.
 */
class SourceRateLimiter {
    private val sourceStates = ConcurrentHashMap<String, SourceState>()
    private val sourceStateLocks = ConcurrentHashMap<String, Mutex>()

    data class SourceState(
        var lastRequestTime: Long = 0,
        var lastChapterCompletionTime: Long = 0,
        var adaptiveDelayMs: Long = 0,
        var consecutiveRateLimits: Int = 0,
        var consecutiveSuccesses: Int = 0,
    )

    /**
     * Acquires permission to make a request to the given source.
     * Blocks until enough time has passed since the last request.
     */
    suspend fun acquirePermit(
        sourceId: String,
        baseDelayMs: Long,
        adaptiveRateLimitingEnabled: Boolean,
    ) {
        val lock = sourceStateLocks.getOrPut(sourceId) { Mutex() }
        lock.withLock {
            val state = sourceStates.getOrPut(sourceId) { SourceState() }

            // Calculate total delay needed
            val adaptiveDelay = if (adaptiveRateLimitingEnabled) state.adaptiveDelayMs else 0L
            val totalDelay = baseDelayMs + adaptiveDelay

            // Wait if needed
            val now = System.currentTimeMillis()
            val timeSinceLastRequest = now - state.lastRequestTime
            if (timeSinceLastRequest < totalDelay) {
                val waitTime = totalDelay - timeSinceLastRequest
                if (waitTime > 0) {
                    if (adaptiveDelay > 0) {
                        logger.debug { "Rate limiting source $sourceId: waiting ${waitTime}ms (adaptive delay: ${adaptiveDelay}ms)" }
                    }
                    delay(waitTime)
                }
            }

            state.lastRequestTime = System.currentTimeMillis()
        }
    }

    /**
     * Records a rate limit (429) error for the given source.
     * Exponentially increases the adaptive delay to prevent future rate limits.
     */
    fun recordRateLimit(
        sourceId: String,
        retryAfterSeconds: Long?,
    ) {
        val state = sourceStates.getOrPut(sourceId) { SourceState() }
        state.consecutiveRateLimits++
        state.consecutiveSuccesses = 0

        // Exponential backoff: 2s, 4s, 8s, 16s, 30s (capped)
        val backoffMultiplier = 2.0.pow(state.consecutiveRateLimits - 1)
        val exponentialBackoff = (2000L * backoffMultiplier).toLong()
        val cappedBackoff = min(30_000L, exponentialBackoff)

        // Use the larger of: exponential backoff or Retry-After header
        val backoff = if (retryAfterSeconds != null) {
            max(cappedBackoff, retryAfterSeconds * 1000)
        } else {
            cappedBackoff
        }

        state.adaptiveDelayMs = max(state.adaptiveDelayMs, backoff)

        logger.warn {
            "Rate limit detected for source $sourceId " +
                "(consecutive: ${state.consecutiveRateLimits}, adaptive delay now: ${state.adaptiveDelayMs}ms)"
        }
    }

    /**
     * Records a successful request for the given source.
     * Gradually reduces the adaptive delay as requests succeed.
     */
    fun recordSuccess(sourceId: String) {
        val state = sourceStates[sourceId] ?: return

        state.consecutiveSuccesses++

        // Reset rate limit counter after multiple successes
        if (state.consecutiveSuccesses >= 5 && state.consecutiveRateLimits > 0) {
            state.consecutiveRateLimits = kotlin.math.max(0, state.consecutiveRateLimits - 1)
        }

        // Gradually reduce adaptive delay: reduce by 20% every 10 successful requests
        if (state.consecutiveSuccesses % 10 == 0 && state.adaptiveDelayMs > 0) {
            val oldDelay = state.adaptiveDelayMs
            state.adaptiveDelayMs = (state.adaptiveDelayMs * 0.8).toLong()

            if (state.adaptiveDelayMs == 0L && oldDelay > 0) {
                logger.info { "Rate limiting recovered for source $sourceId (adaptive delay cleared)" }
            }
        }
    }

    /**
     * Returns whether the source is currently being throttled due to rate limits.
     */
    fun isThrottled(sourceId: String): Boolean {
        val state = sourceStates[sourceId] ?: return false
        return state.adaptiveDelayMs > 0 || state.consecutiveRateLimits > 0
    }

    /**
     * Returns the current adaptive delay for a source in milliseconds.
     */
    fun getCurrentDelay(sourceId: String): Long {
        val state = sourceStates[sourceId] ?: return 0L
        return state.adaptiveDelayMs
    }

    /**
     * Waits for the required delay before starting a new chapter download.
     * Ensures minimum time between chapter downloads from the same source.
     */
    suspend fun waitForChapterStart(
        sourceId: String,
        delayBetweenChaptersMs: Long,
    ) {
        if (delayBetweenChaptersMs <= 0) return

        val lock = sourceStateLocks.getOrPut(sourceId) { Mutex() }
        lock.withLock {
            val state = sourceStates.getOrPut(sourceId) { SourceState() }

            if (state.lastChapterCompletionTime > 0) {
                val timeSinceLastChapter = System.currentTimeMillis() - state.lastChapterCompletionTime
                if (timeSinceLastChapter < delayBetweenChaptersMs) {
                    val waitTime = delayBetweenChaptersMs - timeSinceLastChapter
                    logger.debug { "Delaying chapter start for source $sourceId by ${waitTime}ms" }
                    delay(waitTime)
                }
            }
        }
    }

    /**
     * Records that a chapter download has completed for this source.
     */
    fun recordChapterCompletion(sourceId: String) {
        val state = sourceStates.getOrPut(sourceId) { SourceState() }
        state.lastChapterCompletionTime = System.currentTimeMillis()
    }

    private fun max(
        a: Long,
        b: Long,
    ): Long = if (a > b) a else b
}
