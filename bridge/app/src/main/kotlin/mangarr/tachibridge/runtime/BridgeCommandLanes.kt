package mangarr.tachibridge.runtime

import java.util.concurrent.atomic.AtomicInteger

private val interactiveCapabilities =
    listOf(
        "extensions.repo",
        "extensions.install",
        "sources.preferences",
        "explore.search",
        "explore.feed",
        "explore.title.fetch",
        "reader.pages.fetch",
        "library.chapters.sync",
        "library.cover.cache",
        "library.title.stats.refresh",
        "library.import",
    )

private val discoveryCapabilities = listOf("discovery.feed", "discovery.metadata")

internal enum class BridgeCommandLane(
    val concurrency: Int,
    val capabilities: List<String>,
) {
    INTERACTIVE(concurrency = 2, capabilities = interactiveCapabilities),
    DOWNLOAD(concurrency = 2, capabilities = listOf("downloads.chapter")),
    DISCOVERY(concurrency = 1, capabilities = discoveryCapabilities),
    ;

    companion object {
        fun fromCommandType(commandType: String): BridgeCommandLane =
            when (commandType) {
                "downloads.chapter" -> DOWNLOAD
                "discovery.feed.crawl", "discovery.title.hydrate" -> DISCOVERY
                else -> INTERACTIVE
            }
    }

    fun metricName(): String = name.lowercase()
}

internal class BridgeCommandLaneTracker {
    private val activeCounts =
        BridgeCommandLane.entries.associateWith { AtomicInteger(0) }

    fun lanes(): List<BridgeCommandLane> = BridgeCommandLane.entries

    fun availableSlots(lane: BridgeCommandLane): Int =
        (lane.concurrency - activeCounts.getValue(lane).get()).coerceAtLeast(0)

    fun activeCount(lane: BridgeCommandLane): Int = activeCounts.getValue(lane).get()

    fun increment(commandType: String): AtomicInteger {
        val lane = BridgeCommandLane.fromCommandType(commandType)
        return activeCounts.getValue(lane)
    }
}
