package mangarr.tachibridge.runtime

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.atomic.AtomicLong

object BridgeMetrics {
    private val httpRequestsTotal = ConcurrentHashMap<String, AtomicLong>()
    private val httpRequestDurationTotalMs = ConcurrentHashMap<String, AtomicLong>()
    private val httpRequestDurationCount = ConcurrentHashMap<String, AtomicLong>()
    private val httpRequestsInFlight = AtomicLong(0)

    private val commandExecutionsTotal = ConcurrentHashMap<String, AtomicLong>()
    private val commandDurationTotalMs = ConcurrentHashMap<String, AtomicLong>()
    private val commandDurationCount = ConcurrentHashMap<String, AtomicLong>()
    private val leasePollsTotal = ConcurrentHashMap<String, AtomicLong>()
    private val leasePollDurationTotalMs = ConcurrentHashMap<String, AtomicLong>()
    private val leasePollDurationCount = ConcurrentHashMap<String, AtomicLong>()
    private val leaseRequestedSlotsTotal = ConcurrentHashMap<String, AtomicLong>()
    private val leaseCandidatesTotal = ConcurrentHashMap<String, AtomicLong>()
    private val leaseLeasedTotal = ConcurrentHashMap<String, AtomicLong>()
    private val commandPollDelayMs = AtomicLong(0)
    private val commandIdlePolls = AtomicLong(0)

    private val convexCallsTotal = ConcurrentHashMap<String, AtomicLong>()
    private val convexCallDurationTotalMs = ConcurrentHashMap<String, AtomicLong>()
    private val convexCallDurationCount = ConcurrentHashMap<String, AtomicLong>()
    private val convexRetriesTotal = ConcurrentHashMap<String, AtomicLong>()

    private val cacheLookupsTotal = ConcurrentHashMap<String, AtomicLong>()
    private val cacheStoresTotal = ConcurrentHashMap<String, AtomicLong>()

    fun onHttpRequestStarted() {
        httpRequestsInFlight.incrementAndGet()
    }

    fun onHttpRequestFinished(
        route: String,
        method: String,
        status: Int,
        durationMs: Long,
    ) {
        val labels = labels("route" to route, "method" to method.uppercase(), "status" to status.toString())
        increment(httpRequestsTotal, labels)
        add(httpRequestDurationTotalMs, labels, durationMs)
        increment(httpRequestDurationCount, labels)
        httpRequestsInFlight.decrementAndGet()
    }

    fun recordCommandExecution(
        commandType: String,
        outcome: String,
        durationMs: Long,
    ) {
        val labels = labels("command_type" to commandType, "outcome" to outcome)
        increment(commandExecutionsTotal, labels)
        add(commandDurationTotalMs, labels, durationMs)
        increment(commandDurationCount, labels)
    }

    fun recordLeasePoll(
        outcome: String,
        durationMs: Long,
        requestStats: List<LeaseBatchRequestStat>,
    ) {
        val labels = labels("outcome" to outcome)
        increment(leasePollsTotal, labels)
        add(leasePollDurationTotalMs, labels, durationMs)
        increment(leasePollDurationCount, labels)

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
        commandPollDelayMs.set(delayMs)
        commandIdlePolls.set(consecutiveIdlePolls.toLong())
    }

    fun recordConvexCall(
        endpoint: String,
        path: String,
        outcome: String,
        durationMs: Long,
    ) {
        val labels = labels("endpoint" to endpoint, "path" to path, "outcome" to outcome)
        increment(convexCallsTotal, labels)
        add(convexCallDurationTotalMs, labels, durationMs)
        increment(convexCallDurationCount, labels)
    }

    fun recordConvexRetry(
        endpoint: String,
        path: String,
    ) {
        increment(convexRetriesTotal, labels("endpoint" to endpoint, "path" to path))
    }

    fun recordCacheLookup(
        cache: String,
        outcome: String,
    ) {
        increment(cacheLookupsTotal, labels("cache" to cache, "outcome" to outcome))
    }

    fun recordCacheStore(cache: String) {
        increment(cacheStoresTotal, labels("cache" to cache))
    }

    fun renderPrometheus(httpExecutor: ThreadPoolExecutor? = null): String =
        buildString {
            appendCounterMetric(
                "mangarr_http_requests_total",
                "Total bridge HTTP requests served.",
                httpRequestsTotal,
            )
            appendCounterMetric(
                "mangarr_http_request_duration_ms_total",
                "Sum of bridge HTTP request durations in milliseconds.",
                httpRequestDurationTotalMs,
            )
            appendCounterMetric(
                "mangarr_http_request_duration_ms_count",
                "Count of bridge HTTP requests contributing to duration sums.",
                httpRequestDurationCount,
            )
            appendGaugeMetric(
                "mangarr_http_requests_in_flight",
                "Current number of in-flight bridge HTTP requests.",
                httpRequestsInFlight.get(),
            )

            appendCounterMetric(
                "mangarr_bridge_command_executions_total",
                "Total bridge command executions by outcome.",
                commandExecutionsTotal,
            )
            appendCounterMetric(
                "mangarr_bridge_command_duration_ms_total",
                "Sum of bridge command execution durations in milliseconds.",
                commandDurationTotalMs,
            )
            appendCounterMetric(
                "mangarr_bridge_command_duration_ms_count",
                "Count of bridge commands contributing to duration sums.",
                commandDurationCount,
            )
            appendCounterMetric(
                "mangarr_bridge_lease_polls_total",
                "Total bridge lease polling attempts by outcome.",
                leasePollsTotal,
            )
            appendCounterMetric(
                "mangarr_bridge_lease_poll_duration_ms_total",
                "Sum of bridge lease polling durations in milliseconds.",
                leasePollDurationTotalMs,
            )
            appendCounterMetric(
                "mangarr_bridge_lease_poll_duration_ms_count",
                "Count of bridge lease polling attempts contributing to duration sums.",
                leasePollDurationCount,
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

            appendCounterMetric(
                "mangarr_convex_calls_total",
                "Total Convex bridge client calls by endpoint, path, and outcome.",
                convexCallsTotal,
            )
            appendCounterMetric(
                "mangarr_convex_call_duration_ms_total",
                "Sum of Convex bridge client call durations in milliseconds.",
                convexCallDurationTotalMs,
            )
            appendCounterMetric(
                "mangarr_convex_call_duration_ms_count",
                "Count of Convex bridge client calls contributing to duration sums.",
                convexCallDurationCount,
            )
            appendCounterMetric(
                "mangarr_convex_retries_total",
                "Total Convex optimistic concurrency retries.",
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
                appendGaugeMetric(
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

    private fun StringBuilder.appendGaugeMetric(
        name: String,
        help: String,
        value: Long,
    ) {
        appendLine("# HELP $name $help")
        appendLine("# TYPE $name gauge")
        appendLine("$name $value")
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
