package mangarr.tachibridge.runtime

import mangarr.tachibridge.config.ConfigManager
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.atomic.AtomicLong

private val DURATION_BUCKETS_MS = longArrayOf(5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000)
private val PROBE_ROUTES = setOf("/health", "/metrics")

data class CommandQueueLaneSnapshot(
    val lane: String,
    val readyCount: Long,
    val oldestReadyAgeMs: Long,
)

private data class HistogramSample(
    val labels: String,
    val buckets: LongArray = LongArray(DURATION_BUCKETS_MS.size),
    val count: AtomicLong = AtomicLong(0),
    val sum: AtomicLong = AtomicLong(0),
)

object BridgeMetrics {
    private val httpRequestsTotal = ConcurrentHashMap<String, AtomicLong>()
    private val httpRequestDurationMs = ConcurrentHashMap<String, HistogramSample>()
    private val httpRequestsInFlight = AtomicLong(0)

    private val commandExecutionsTotal = ConcurrentHashMap<String, AtomicLong>()
    private val commandDurationMs = ConcurrentHashMap<String, HistogramSample>()
    private val leasePollsTotal = ConcurrentHashMap<String, AtomicLong>()
    private val leasePollDurationMs = ConcurrentHashMap<String, HistogramSample>()
    private val leaseRequestedSlotsTotal = ConcurrentHashMap<String, AtomicLong>()
    private val leaseCandidatesTotal = ConcurrentHashMap<String, AtomicLong>()
    private val leaseLeasedTotal = ConcurrentHashMap<String, AtomicLong>()
    private val commandPollDelayMs = AtomicLong(0)
    private val commandIdlePolls = AtomicLong(0)
    private val commandLaneActive = ConcurrentHashMap<String, AtomicLong>()
    private val commandLaneCapacity = ConcurrentHashMap<String, AtomicLong>()
    private val commandQueueReady = ConcurrentHashMap<String, AtomicLong>()
    private val commandQueueOldestAgeMs = ConcurrentHashMap<String, AtomicLong>()

    private val convexCallsTotal = ConcurrentHashMap<String, AtomicLong>()
    private val convexCallDurationMs = ConcurrentHashMap<String, HistogramSample>()
    private val convexRetriesTotal = ConcurrentHashMap<String, AtomicLong>()

    private val cacheLookupsTotal = ConcurrentHashMap<String, AtomicLong>()
    private val cacheStoresTotal = ConcurrentHashMap<String, AtomicLong>()

    private val downloadOutcomesTotal = ConcurrentHashMap<String, AtomicLong>()
    private val downloadDurationMs = ConcurrentHashMap<String, HistogramSample>()
    private val readerPageRequestsTotal = ConcurrentHashMap<String, AtomicLong>()
    private val readerPageRequestDurationMs = ConcurrentHashMap<String, HistogramSample>()
    private val readerPagePayloadBytesTotal = ConcurrentHashMap<String, AtomicLong>()
    private val pageSourceFetchesTotal = ConcurrentHashMap<String, AtomicLong>()
    private val pageSourceFetchDurationMs = ConcurrentHashMap<String, HistogramSample>()
    private val pageSourceFetchRetriesTotal = ConcurrentHashMap<String, AtomicLong>()
    private val pageSourcePayloadBytesTotal = ConcurrentHashMap<String, AtomicLong>()
    private val downloadChapterPagesTotal = ConcurrentHashMap<String, AtomicLong>()
    private val downloadChapterBytesTotal = ConcurrentHashMap<String, AtomicLong>()

    fun onHttpRequestStarted(route: String) {
        if (!ConfigManager.metricsEnabled() || route in PROBE_ROUTES) return
        httpRequestsInFlight.incrementAndGet()
    }

    fun onHttpRequestFinished(
        route: String,
        method: String,
        status: Int,
        durationMs: Long,
    ) {
        if (!ConfigManager.metricsEnabled() || route in PROBE_ROUTES) return
        val requestLabels = labels("route" to route, "method" to method.uppercase(), "status" to status.toString())
        val durationLabels = labels("route" to route, "method" to method.uppercase())
        increment(httpRequestsTotal, requestLabels)
        observeHistogram(httpRequestDurationMs, durationLabels, durationMs)
        httpRequestsInFlight.updateAndGet { current -> (current - 1).coerceAtLeast(0) }
    }

    fun recordCommandExecution(
        commandType: String,
        outcome: String,
        durationMs: Long,
    ) {
        if (!ConfigManager.metricsEnabled()) return
        val labels = labels("command_type" to commandType, "outcome" to outcome)
        increment(commandExecutionsTotal, labels)
        observeHistogram(commandDurationMs, labels, durationMs)
        if (commandType == "downloads.chapter") {
            val downloadLabels = labels("outcome" to outcome)
            increment(downloadOutcomesTotal, downloadLabels)
            observeHistogram(downloadDurationMs, downloadLabels, durationMs)
        }
    }

    fun recordLeasePoll(
        outcome: String,
        durationMs: Long,
        requestStats: List<LeaseBatchRequestStat>,
    ) {
        if (!ConfigManager.metricsEnabled()) return
        val labels = labels("outcome" to outcome)
        increment(leasePollsTotal, labels)
        observeHistogram(leasePollDurationMs, labels, durationMs)

        requestStats.forEach { stat ->
            val laneLabels = labels("lane" to stat.lane)
            add(leaseRequestedSlotsTotal, laneLabels, stat.requestedSlots.toLong())
            add(leaseCandidatesTotal, laneLabels, stat.candidateCount.toLong())
            add(leaseLeasedTotal, laneLabels, stat.leasedCount.toLong())
        }
    }

    fun setCommandPollState(
        delayMs: Long,
        consecutiveIdlePolls: Int,
    ) {
        if (!ConfigManager.metricsEnabled()) return
        commandPollDelayMs.set(delayMs)
        commandIdlePolls.set(consecutiveIdlePolls.toLong())
    }

    fun setLaneState(
        lane: String,
        active: Long,
        capacity: Long,
    ) {
        if (!ConfigManager.metricsEnabled()) return
        setGauge(commandLaneActive, labels("lane" to lane), active)
        setGauge(commandLaneCapacity, labels("lane" to lane), capacity)
    }

    fun recordQueueSnapshot(lanes: List<CommandQueueLaneSnapshot>) {
        if (!ConfigManager.metricsEnabled()) return
        lanes.forEach { lane ->
            val laneLabels = labels("lane" to lane.lane)
            setGauge(commandQueueReady, laneLabels, lane.readyCount)
            setGauge(commandQueueOldestAgeMs, laneLabels, lane.oldestReadyAgeMs)
        }
    }

    fun recordConvexCall(
        endpoint: String,
        path: String,
        outcome: String,
        durationMs: Long,
    ) {
        if (!ConfigManager.metricsEnabled()) return
        val labels =
            labels(
                "endpoint" to endpoint,
                "endpoint_family" to convexEndpointFamily(path),
                "outcome" to outcome,
            )
        increment(convexCallsTotal, labels)
        observeHistogram(convexCallDurationMs, labels, durationMs)
    }

    fun recordConvexRetry(
        endpoint: String,
        path: String,
    ) {
        if (!ConfigManager.metricsEnabled()) return
        increment(
            convexRetriesTotal,
            labels(
                "endpoint" to endpoint,
                "endpoint_family" to convexEndpointFamily(path),
            ),
        )
    }

    fun recordCacheLookup(
        cache: String,
        outcome: String,
    ) {
        if (!ConfigManager.metricsEnabled()) return
        increment(cacheLookupsTotal, labels("cache" to cache, "outcome" to outcome))
    }

    fun recordCacheStore(cache: String) {
        if (!ConfigManager.metricsEnabled()) return
        increment(cacheStoresTotal, labels("cache" to cache))
    }

    fun recordReaderPageRequest(
        cache: String,
        waited: Boolean,
        outcome: String,
        durationMs: Long,
        payloadBytes: Long? = null,
    ) {
        if (!ConfigManager.metricsEnabled()) return
        val labels =
            labels(
                "cache" to cache,
                "waited" to waited.toString(),
                "outcome" to outcome,
            )
        increment(readerPageRequestsTotal, labels)
        observeHistogram(readerPageRequestDurationMs, labels, durationMs)
        if (payloadBytes != null) {
            add(
                readerPagePayloadBytesTotal,
                labels("cache" to cache, "waited" to waited.toString()),
                payloadBytes,
            )
        }
    }

    fun recordPageSourceFetch(
        consumer: String,
        outcome: String,
        durationMs: Long,
        payloadBytes: Long? = null,
    ) {
        if (!ConfigManager.metricsEnabled()) return
        val labels = labels("consumer" to consumer, "outcome" to outcome)
        increment(pageSourceFetchesTotal, labels)
        observeHistogram(pageSourceFetchDurationMs, labels, durationMs)
        if (payloadBytes != null) {
            add(pageSourcePayloadBytesTotal, labels("consumer" to consumer), payloadBytes)
        }
    }

    fun recordPageSourceFetchRetry(
        consumer: String,
        reason: String,
    ) {
        if (!ConfigManager.metricsEnabled()) return
        increment(pageSourceFetchRetriesTotal, labels("consumer" to consumer, "reason" to reason))
    }

    fun recordDownloadChapterStored(
        storageKind: String,
        pageCount: Int,
        fileSizeBytes: Long,
    ) {
        if (!ConfigManager.metricsEnabled()) return
        val labels = labels("storage_kind" to storageKind)
        add(downloadChapterPagesTotal, labels, pageCount.toLong())
        add(downloadChapterBytesTotal, labels, fileSizeBytes)
    }

    fun renderPrometheus(httpExecutor: ThreadPoolExecutor? = null): String =
        buildString {
            appendCounterMetric(
                "mangarr_http_requests_total",
                "Total bridge HTTP requests served, excluding probe traffic.",
                httpRequestsTotal,
            )
            appendHistogramMetric(
                "mangarr_http_request_duration_ms",
                "Bridge HTTP request duration in milliseconds, excluding probe traffic.",
                httpRequestDurationMs,
            )
            appendGaugeMetric(
                "mangarr_http_requests_in_flight",
                "Current number of in-flight bridge HTTP requests, excluding probe traffic.",
                httpRequestsInFlight.get(),
            )

            appendCounterMetric(
                "mangarr_bridge_command_executions_total",
                "Total bridge command executions by type and outcome.",
                commandExecutionsTotal,
            )
            appendHistogramMetric(
                "mangarr_bridge_command_duration_ms",
                "Bridge command execution duration in milliseconds.",
                commandDurationMs,
            )
            appendCounterMetric(
                "mangarr_bridge_lease_polls_total",
                "Total bridge lease polling attempts by outcome.",
                leasePollsTotal,
            )
            appendHistogramMetric(
                "mangarr_bridge_lease_poll_duration_ms",
                "Bridge lease polling duration in milliseconds.",
                leasePollDurationMs,
            )
            appendCounterMetric(
                "mangarr_bridge_lease_requested_slots_total",
                "Total requested bridge lease slots by lane.",
                leaseRequestedSlotsTotal,
            )
            appendCounterMetric(
                "mangarr_bridge_lease_candidates_total",
                "Total candidate bridge commands considered for leasing by lane.",
                leaseCandidatesTotal,
            )
            appendCounterMetric(
                "mangarr_bridge_lease_leased_total",
                "Total bridge commands leased by lane.",
                leaseLeasedTotal,
            )
            appendGaugeMetric(
                "mangarr_bridge_command_poll_delay_ms",
                "Current bridge command poll delay in milliseconds.",
                commandPollDelayMs.get(),
            )
            appendGaugeMetric(
                "mangarr_bridge_command_idle_polls",
                "Current consecutive idle bridge command poll count.",
                commandIdlePolls.get(),
            )
            appendGaugeMetric(
                "mangarr_bridge_command_lane_active",
                "Current number of in-flight bridge commands by lane.",
                commandLaneActive,
            )
            appendGaugeMetric(
                "mangarr_bridge_command_lane_capacity",
                "Configured bridge command concurrency by lane.",
                commandLaneCapacity,
            )
            appendGaugeMetric(
                "mangarr_bridge_command_queue_ready",
                "Current number of ready-to-run bridge commands by lane.",
                commandQueueReady,
            )
            appendGaugeMetric(
                "mangarr_bridge_command_queue_oldest_age_ms",
                "Age in milliseconds of the oldest ready-to-run bridge command by lane.",
                commandQueueOldestAgeMs,
            )

            appendCounterMetric(
                "mangarr_convex_calls_total",
                "Total Convex bridge client calls by endpoint family and outcome.",
                convexCallsTotal,
            )
            appendHistogramMetric(
                "mangarr_convex_call_duration_ms",
                "Convex bridge client call duration in milliseconds.",
                convexCallDurationMs,
            )
            appendCounterMetric(
                "mangarr_convex_retries_total",
                "Total Convex optimistic concurrency retries by endpoint family.",
                convexRetriesTotal,
            )

            appendCounterMetric(
                "mangarr_cache_lookups_total",
                "Total bridge cache lookups by cache name and outcome.",
                cacheLookupsTotal,
            )
            appendCounterMetric(
                "mangarr_cache_stores_total",
                "Total bridge cache stores by cache name.",
                cacheStoresTotal,
            )
            appendCounterMetric(
                "mangarr_reader_page_requests_total",
                "Total reader page requests by cache path, wait state, and outcome.",
                readerPageRequestsTotal,
            )
            appendHistogramMetric(
                "mangarr_reader_page_request_duration_ms",
                "Reader page request duration in milliseconds by cache path, wait state, and outcome.",
                readerPageRequestDurationMs,
            )
            appendCounterMetric(
                "mangarr_reader_page_payload_bytes_total",
                "Total bytes served for successful reader page requests by cache path and wait state.",
                readerPagePayloadBytesTotal,
            )
            appendCounterMetric(
                "mangarr_page_source_fetches_total",
                "Total source page fetches by consumer and outcome.",
                pageSourceFetchesTotal,
            )
            appendHistogramMetric(
                "mangarr_page_source_fetch_duration_ms",
                "Source page fetch duration in milliseconds by consumer and outcome.",
                pageSourceFetchDurationMs,
            )
            appendCounterMetric(
                "mangarr_page_source_fetch_retries_total",
                "Total retried source page fetch attempts by consumer and reason.",
                pageSourceFetchRetriesTotal,
            )
            appendCounterMetric(
                "mangarr_page_source_payload_bytes_total",
                "Total bytes fetched from sources for page images by consumer.",
                pageSourcePayloadBytesTotal,
            )
            appendCounterMetric(
                "mangarr_bridge_download_outcomes_total",
                "Total download command outcomes by outcome.",
                downloadOutcomesTotal,
            )
            appendHistogramMetric(
                "mangarr_bridge_download_duration_ms",
                "Download command duration in milliseconds by outcome.",
                downloadDurationMs,
            )
            appendCounterMetric(
                "mangarr_download_chapter_pages_total",
                "Total pages successfully stored by download chapter commands and storage kind.",
                downloadChapterPagesTotal,
            )
            appendCounterMetric(
                "mangarr_download_chapter_bytes_total",
                "Total bytes successfully stored by download chapter commands and storage kind.",
                downloadChapterBytesTotal,
            )

            if (httpExecutor != null) {
                appendGaugeMetric(
                    "mangarr_http_executor_active_threads",
                    "Current number of active bridge HTTP worker threads.",
                    httpExecutor.activeCount.toLong(),
                )
                appendGaugeMetric(
                    "mangarr_http_executor_pool_size",
                    "Current bridge HTTP executor pool size.",
                    httpExecutor.poolSize.toLong(),
                )
                appendGaugeMetric(
                    "mangarr_http_executor_queue_depth",
                    "Current number of queued bridge HTTP tasks.",
                    httpExecutor.queue.size.toLong(),
                )
                appendCounterMetric(
                    "mangarr_http_executor_completed_tasks_total",
                    "Total completed bridge HTTP executor tasks.",
                    httpExecutor.completedTaskCount,
                )
            }
        }

    private fun increment(
        target: ConcurrentHashMap<String, AtomicLong>,
        labels: String,
    ) {
        target.computeIfAbsent(labels) { AtomicLong(0) }.incrementAndGet()
    }

    private fun add(
        target: ConcurrentHashMap<String, AtomicLong>,
        labels: String,
        delta: Long,
    ) {
        target.computeIfAbsent(labels) { AtomicLong(0) }.addAndGet(delta)
    }

    private fun setGauge(
        target: ConcurrentHashMap<String, AtomicLong>,
        labels: String,
        value: Long,
    ) {
        target.computeIfAbsent(labels) { AtomicLong(0) }.set(value.coerceAtLeast(0))
    }

    private fun observeHistogram(
        target: ConcurrentHashMap<String, HistogramSample>,
        labels: String,
        durationMs: Long,
    ) {
        val sample = target.computeIfAbsent(labels) { HistogramSample(labels = labels) }
        val boundedDuration = durationMs.coerceAtLeast(0)
        synchronized(sample) {
            sample.count.incrementAndGet()
            sample.sum.addAndGet(boundedDuration)
            DURATION_BUCKETS_MS.forEachIndexed { index, bucket ->
                if (boundedDuration <= bucket) {
                    sample.buckets[index] += 1
                }
            }
        }
    }

    private fun convexEndpointFamily(path: String): String = path.substringBefore(':').ifBlank { "unknown" }

    private fun labels(vararg pairs: Pair<String, String>): String =
        pairs.joinToString(",") { (key, value) -> """$key="${escape(value)}"""" }

    private fun escape(value: String): String =
        value
            .replace("\\", "\\\\")
            .replace("\n", "\\n")
            .replace("\"", "\\\"")

    private fun StringBuilder.appendCounterMetric(
        name: String,
        help: String,
        values: ConcurrentHashMap<String, AtomicLong>,
    ) {
        appendLine("# HELP $name $help")
        appendLine("# TYPE $name counter")
        appendSeries(name, values)
    }

    private fun StringBuilder.appendCounterMetric(
        name: String,
        help: String,
        value: Long,
    ) {
        appendLine("# HELP $name $help")
        appendLine("# TYPE $name counter")
        appendLine("$name $value")
    }

    private fun StringBuilder.appendGaugeMetric(
        name: String,
        help: String,
        value: Long,
    ) {
        appendLine("# HELP $name $help")
        appendLine("# TYPE $name gauge")
        appendLine("$name $value")
    }

    private fun StringBuilder.appendGaugeMetric(
        name: String,
        help: String,
        values: ConcurrentHashMap<String, AtomicLong>,
    ) {
        appendLine("# HELP $name $help")
        appendLine("# TYPE $name gauge")
        appendSeries(name, values)
    }

    private fun StringBuilder.appendHistogramMetric(
        name: String,
        help: String,
        values: ConcurrentHashMap<String, HistogramSample>,
    ) {
        appendLine("# HELP $name $help")
        appendLine("# TYPE $name histogram")
        values.entries
            .sortedBy { it.key }
            .forEach { (_, sample) ->
                synchronized(sample) {
                    DURATION_BUCKETS_MS.forEachIndexed { index, bucket ->
                        appendLine("${name}_bucket{${sample.labels},le=\"${bucket}\"} ${sample.buckets[index]}")
                    }
                    appendLine("${name}_bucket{${sample.labels},le=\"+Inf\"} ${sample.count.get()}")
                    appendLine("${name}_sum{${sample.labels}} ${sample.sum.get()}")
                    appendLine("${name}_count{${sample.labels}} ${sample.count.get()}")
                }
            }
    }

    private fun StringBuilder.appendSeries(
        name: String,
        values: ConcurrentHashMap<String, AtomicLong>,
    ) {
        values.entries
            .sortedBy { it.key }
            .forEach { (labels, value) ->
                appendLine("$name{$labels} ${value.get()}")
            }
    }
}
