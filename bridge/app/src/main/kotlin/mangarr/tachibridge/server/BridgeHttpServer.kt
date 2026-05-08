package mangarr.tachibridge.server

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.HttpException
import eu.kanade.tachiyomi.network.NetworkHelper
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import mangarr.tachibridge.config.ConfigManager
import mangarr.tachibridge.logging.EventLogger
import mangarr.tachibridge.logging.LogContext
import mangarr.tachibridge.runtime.BridgeSnapshot
import mangarr.tachibridge.runtime.BridgeCommandRunner
import mangarr.tachibridge.runtime.CommandRunnerSnapshot
import mangarr.tachibridge.runtime.BridgeHeartbeatReporter
import mangarr.tachibridge.runtime.BridgeMetrics
import mangarr.tachibridge.runtime.BridgeService
import mangarr.tachibridge.runtime.HeartbeatSnapshot
import mangarr.tachibridge.runtime.BridgeState
import mangarr.tachibridge.runtime.ConvexBridgeClient
import mangarr.tachibridge.runtime.DownloadReconcileChapter
import mangarr.tachibridge.util.ImageUtil
import java.io.ByteArrayInputStream
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.URI
import java.net.URLDecoder
import java.io.IOException
import java.nio.file.Files
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.io.path.deleteIfExists

private val logger = KotlinLogging.logger {}
private const val PAGE_ASSET_FAILURE_LOG_TTL_MS = 60_000L
private const val HTTP_SERVER_MIN_WORKERS = 8
private const val HTTP_SERVER_QUEUE_MULTIPLIER = 16
private const val MAX_COVER_PROXY_REDIRECTS = 3
private const val MAX_REMOTE_COVER_BYTES = 8L * 1024 * 1024
private const val RESPONSE_STATUS_ATTRIBUTE = "mangarr.response_status"
private const val REQUEST_ID_HEADER = "x-request-id"
private const val DEFAULT_REQUEST_LOG_SLOW_MS = 1_000L
private const val PAGE_ASSET_REQUEST_LOG_SLOW_MS = 5_000L
private const val REMOTE_COVER_REQUEST_LOG_SLOW_MS = 10_000L
private val REQUEST_ID_PATTERN = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
private val HTTP_PROBE_PATHS = setOf("/health", "/metrics")

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
class BridgeHttpServer(
    private val host: String,
    private val port: Int,
    private val serviceSecret: String,
    private val bridgeState: BridgeState,
    private val heartbeatReporter: BridgeHeartbeatReporter,
    private val commandRunner: BridgeCommandRunner,
    private val bridgeService: BridgeService,
    private val networkHelper: NetworkHelper,
    private val bridgeClient: ConvexBridgeClient?,
    private val bridgeId: String,
    private val kcefSnapshotProvider: () -> JsonObject,
) {
    private val json = Json { prettyPrint = false }
    private val pageAssetFailureLogCache = ConcurrentHashMap<String, Long>()
    private val httpEvents = EventLogger.named("mangarr.tachibridge.http", "subsystem" to "http_server")

    // Dedicated client for cover proxying: short timeouts, inherits proxy/cookie config from networkHelper
    private val coverProxyClient by lazy {
        networkHelper.client
            .newBuilder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .callTimeout(20, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build()
    }
    private val httpWorkerCount = maxOf(HTTP_SERVER_MIN_WORKERS, Runtime.getRuntime().availableProcessors() * 4)
    private val httpExecutor =
        ThreadPoolExecutor(
            httpWorkerCount,
            httpWorkerCount,
            30L,
            TimeUnit.SECONDS,
            ArrayBlockingQueue(httpWorkerCount * HTTP_SERVER_QUEUE_MULTIPLIER),
            namedThreadFactory("bridge-http"),
            ThreadPoolExecutor.CallerRunsPolicy(),
        ).apply {
            allowCoreThreadTimeOut(false)
        }

    private val server =
        HttpServer.create(InetSocketAddress(host, port), 0).apply {
            executor = httpExecutor
        }

    fun start() {
        createContext("/health") { exchange ->
            sendJson(
                exchange,
                200,
                buildJsonObject {
                    put("ok", true)
                    put("bridge", json.encodeToJsonElement(BridgeSnapshot.serializer(), bridgeState.current()))
                    put("convex", json.encodeToJsonElement(HeartbeatSnapshot.serializer(), heartbeatReporter.snapshot()))
                    put("commands", json.encodeToJsonElement(CommandRunnerSnapshot.serializer(), commandRunner.snapshot()))
                    put("kcef", kcefSnapshotProvider())
                    put("repository", bridgeService.repositoryHealthSnapshot())
                },
            )
        }

        createContext("/bridge") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }

            when (exchange.requestMethod.uppercase()) {
                "GET" ->
                    sendJson(
                        exchange,
                        200,
                        buildJsonObject {
                            put("bridge", json.encodeToJsonElement(BridgeSnapshot.serializer(), bridgeState.current()))
                        },
                    )
                else -> sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
            }
        }

        createContext("/bridge/start") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }
            if (exchange.requestMethod.uppercase() != "POST") {
                sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
                return@createContext
            }
            bridgeState.setRunning()
            commandRunner.start()
            heartbeatReporter.start()
            sendJson(exchange, 200, buildJsonObject { put("ok", true) })
        }

        createContext("/bridge/stop") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }
            if (exchange.requestMethod.uppercase() != "POST") {
                sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
                return@createContext
            }
            kotlinx.coroutines.runBlocking {
                commandRunner.stop()
                heartbeatReporter.stop()
            }
            bridgeState.setStopped()
            sendJson(exchange, 200, buildJsonObject { put("ok", true) })
        }

        createContext("/bridge/restart") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }
            if (exchange.requestMethod.uppercase() != "POST") {
                sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
                return@createContext
            }
            bridgeState.restarted()
            kotlinx.coroutines.runBlocking {
                commandRunner.stop()
                heartbeatReporter.stop()
            }
            heartbeatReporter.start()
            commandRunner.start()
            sendJson(exchange, 200, buildJsonObject { put("ok", true) })
        }

        createContext("/commands/execute") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }
            if (exchange.requestMethod.uppercase() != "POST") {
                sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
                return@createContext
            }

            val payload = readJsonBody(exchange)
            val commandType = payload.optionalString("commandType")
            val commandPayload = payload["payload"]?.jsonObject
            val requestedByUserId = payload.optionalString("requestedByUserId")
            if (commandType.isNullOrBlank() || commandPayload == null) {
                sendJson(exchange, 400, buildJsonObject { put("message", "Missing commandType or payload") })
                return@createContext
            }

            try {
                sendJson(
                    exchange,
                    200,
                    commandRunner.executeWorkpoolCommand(commandType, commandPayload, requestedByUserId),
                )
            } catch (error: Exception) {
                logger.warn {
                    "Bridge workpool command failed commandType=$commandType error=${error::class.simpleName}: ${error.message}"
                }
                sendJson(
                    exchange,
                    502,
                    buildJsonObject {
                        put("message", error.message ?: "Bridge command execution failed")
                    },
                )
            }
        }

        createContext("/assets/page") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }
            if (exchange.requestMethod.uppercase() != "GET") {
                sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
                return@createContext
            }

            val sourceId = exchange.queryParam("sourceId")
            val chapterUrl = exchange.queryParam("chapterUrl")
            val chapterName = exchange.queryParam("chapterName")
            val index = exchange.queryParam("index")?.toIntOrNull()
            if (sourceId.isNullOrBlank() || chapterUrl.isNullOrBlank() || index == null || index < 0) {
                sendJson(exchange, 400, buildJsonObject { put("message", "Missing sourceId, chapterUrl, or index") })
                return@createContext
            }

            try {
                val image = kotlinx.coroutines.runBlocking {
                    bridgeService.fetchPageImage(sourceId, chapterUrl, chapterName, index)
                }
                sendBytes(exchange, 200, image.bytes, image.contentType)
            } catch (error: Exception) {
                val httpError = error.findHttpException()
                val errorSummary = buildString {
                    append(error::class.simpleName ?: error::class.java.simpleName)
                    error.message?.takeIf { it.isNotBlank() }?.let {
                        append(": ")
                        append(it)
                    }
                }
                if (httpError != null) {
                    val logKey = "$sourceId::$chapterUrl::$index::${httpError.code}"
                    if (shouldLogPageAssetFailure(logKey)) {
                        logger.warn {
                            "Failed to serve page asset for source=$sourceId chapter=$chapterUrl index=$index: HTTP ${httpError.code} ($errorSummary)"
                        }
                    }
                } else {
                    logger.warn {
                        "Failed to serve page asset for source=$sourceId chapter=$chapterUrl index=$index ($errorSummary)"
                    }
                }
                val statusCode =
                    when (httpError?.code) {
                        400 -> 400
                        401 -> 401
                        403 -> 403
                        404 -> 404
                        410 -> 410
                        429 -> 429
                        else -> 502
                    }
                sendJson(exchange, statusCode, buildJsonObject { put("message", "Bridge page asset is unavailable") })
            }
        }

        createContext("/assets/library/page") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }
            if (exchange.requestMethod.uppercase() != "GET") {
                sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
                return@createContext
            }

            val localRelativePath = exchange.queryParam("path")
            val index = exchange.queryParam("index")?.toIntOrNull()
            if (localRelativePath.isNullOrBlank() || index == null || index < 0) {
                sendJson(exchange, 400, buildJsonObject { put("message", "Missing path or index") })
                return@createContext
            }

            try {
                val image = bridgeService.fetchStoredPage(localRelativePath, index)
                sendBytes(exchange, 200, image.bytes, image.contentType)
            } catch (error: Exception) {
                logger.warn(error) {
                    "Failed to serve downloaded page asset path=$localRelativePath index=$index"
                }
                sendJson(exchange, 404, buildJsonObject { put("message", "Downloaded page asset is unavailable") })
            }
        }

        createContext("/assets/library/cover") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }
            if (exchange.requestMethod.uppercase() != "GET") {
                sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
                return@createContext
            }

            val localCoverPath = exchange.queryParam("path")
            if (localCoverPath.isNullOrBlank()) {
                sendJson(exchange, 400, buildJsonObject { put("message", "Missing path") })
                return@createContext
            }

            try {
                val image = bridgeService.fetchStoredCover(localCoverPath)
                sendBytes(exchange, 200, image.bytes, image.contentType)
            } catch (error: Exception) {
                logger.warn(error) { "Failed to serve cached library cover path=$localCoverPath" }
                sendJson(exchange, 404, buildJsonObject { put("message", "Library cover asset is unavailable") })
            }
        }

        createContext("/assets/remote/cover") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }
            if (exchange.requestMethod.uppercase() != "GET") {
                sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
                return@createContext
            }

            val target = exchange.queryParam("url")
            if (target.isNullOrBlank()) {
                sendJson(exchange, 400, buildJsonObject { put("message", "Missing url") })
                return@createContext
            }

            val initialUrl = parsePublicRemoteCoverUrl(target)
            if (initialUrl == null) {
                sendJson(exchange, 400, buildJsonObject { put("message", "Invalid url") })
                return@createContext
            }
            var currentUrl: URI = initialUrl

            val maxAttempts = 3
            var lastError: Exception? = null
            var redirectsRemaining = MAX_COVER_PROXY_REDIRECTS
            for (attempt in 1..maxAttempts) {
                try {
                    while (true) {
                        val refererOrigin = "${currentUrl.scheme}://${currentUrl.host}"
                        val coverHeaders =
                            okhttp3.Headers
                                .Builder()
                                .add("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
                                .add("Origin", refererOrigin)
                                .add("Referer", "$refererOrigin/")
                                .add("User-Agent", "Mozilla/5.0 (compatible; MangarrCoverProxy/1.0)")
                                .build()
                        val request = GET(currentUrl.toString(), headers = coverHeaders)
                        coverProxyClient.newCall(request).execute().use { response ->
                            if (response.isRedirect) {
                                val redirected =
                                    resolvePublicRedirectTarget(
                                        currentUrl = currentUrl,
                                        location = response.header("location"),
                                    )
                                if (redirected == null || redirectsRemaining <= 0) {
                                    sendJson(exchange, 502, buildJsonObject { put("message", "Remote cover is unavailable") })
                                    return@createContext
                                }
                                redirectsRemaining -= 1
                                currentUrl = redirected
                                return@use
                            }
                            if (!response.isSuccessful) {
                                sendJson(exchange, response.code, buildJsonObject { put("message", "Remote cover is unavailable") })
                                return@createContext
                            }
                            val responseBody = response.body
                            if (responseBody == null) {
                                sendJson(exchange, 502, buildJsonObject { put("message", "Remote cover is unavailable") })
                                return@createContext
                            }
                            val body = readResponseBodyWithinLimit(responseBody, MAX_REMOTE_COVER_BYTES)
                            val detectedImageType = ImageUtil.findImageType(ByteArrayInputStream(body ?: ByteArray(0)))
                            if (body == null || !isRemoteCoverImage(response.header("content-type"), body, detectedImageType)) {
                                sendJson(exchange, 502, buildJsonObject { put("message", "Remote cover is unavailable") })
                                return@createContext
                            }
                            val contentType = responseBody.contentType()?.toString() ?: detectedImageType?.mime ?: "image/jpeg"
                            val cacheControl = response.header("cache-control") ?: "public, max-age=86400, stale-while-revalidate=604800"
                            sendBytes(exchange, 200, body, contentType, extraHeaders = mapOf("cache-control" to cacheControl))
                            return@createContext
                        }
                    }
                } catch (e: IOException) {
                    lastError = e
                    logger.debug(e) { "Cover fetch attempt $attempt/$maxAttempts failed url=${currentUrl}" }
                    if (attempt < maxAttempts) {
                        continue
                    }
                } catch (e: Exception) {
                    logger.warn(e) { "Unexpected error serving remote cover url=${currentUrl}" }
                    sendJson(exchange, 502, buildJsonObject { put("message", "Remote cover is unavailable") })
                    return@createContext
                }
            }
            logger.debug { "Failed to serve remote cover after $maxAttempts attempts url=${currentUrl}: ${lastError?.message}" }
            sendJson(exchange, 502, buildJsonObject { put("message", "Remote cover is unavailable") })
        }

        createContext("/assets/library/chapter-file") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }
            if (exchange.requestMethod.uppercase() != "GET") {
                sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
                return@createContext
            }

            val localRelativePath = exchange.queryParam("path")
            if (localRelativePath.isNullOrBlank()) {
                sendJson(exchange, 400, buildJsonObject { put("message", "Missing path") })
                return@createContext
            }

            try {
                val file = bridgeService.fetchStoredChapterFile(localRelativePath)
                sendFile(
                    exchange,
                    200,
                    file.filePath,
                    file.contentType,
                    file.fileSizeBytes,
                    mapOf("content-disposition" to """attachment; filename="${file.fileName}""""),
                    deleteAfterSend = file.deleteAfterSend,
                )
            } catch (error: Exception) {
                logger.warn(error) {
                    "Failed to serve downloaded chapter file path=$localRelativePath"
                }
                sendJson(exchange, 404, buildJsonObject { put("message", "Downloaded chapter file is unavailable") })
            }
        }

        createContext("/settings/downloads") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }

            when (exchange.requestMethod.uppercase()) {
                "GET" -> sendJson(exchange, 200, bridgeService.downloadSettings())
                "PUT" -> {
                    val payload = readJsonBody(exchange)
                    val updated =
                        bridgeService.updateDownloadSettings(
                            downloadPath = payload.optionalString("downloadPath"),
                            failedRetryDelaySeconds = payload.optionalInt("failedRetryDelaySeconds"),
                        )
                    sendJson(exchange, 200, updated)
                }
                else -> sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
            }
        }

        createContext("/settings/proxy") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }

            when (exchange.requestMethod.uppercase()) {
                "GET" -> sendJson(exchange, 200, bridgeService.proxySettings())
                "PUT" -> {
                    val payload = readJsonBody(exchange)
                    val updated =
                        bridgeService.updateProxySettings(
                            hostname = payload.optionalString("hostname"),
                            port = payload.optionalInt("port"),
                            username = payload.optionalString("username"),
                            password = payload.optionalString("password"),
                            ignoredAddresses = payload.optionalString("ignoredAddresses"),
                            bypassLocalAddresses = payload.optionalBoolean("bypassLocalAddresses"),
                        )
                    sendJson(exchange, 200, updated)
                }
                else -> sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
            }
        }

        createContext("/settings/flaresolverr") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }

            when (exchange.requestMethod.uppercase()) {
                "GET" -> sendJson(exchange, 200, bridgeService.flareSolverrSettings())
                "PUT" -> {
                    val payload = readJsonBody(exchange)
                    val updated =
                        bridgeService.updateFlareSolverrSettings(
                            enabled = payload.optionalBoolean("enabled"),
                            url = payload.optionalString("url"),
                            timeoutSeconds = payload.optionalInt("timeoutSeconds"),
                            responseFallback = payload.optionalBoolean("responseFallback"),
                            sessionName = payload.optionalString("sessionName"),
                            sessionTtlMinutes = payload.optionalInt("sessionTtlMinutes"),
                        )
                    sendJson(exchange, 200, updated)
                }
                else -> sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
            }
        }

        createContext("/extensions/installed") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }
            if (exchange.requestMethod.uppercase() != "GET") {
                sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
                return@createContext
            }

            try {
                val payload = kotlinx.coroutines.runBlocking { bridgeService.listInstalledExtensions() }
                sendJson(exchange, 200, payload)
            } catch (error: Exception) {
                logger.warn(error) { "Failed to list installed extensions" }
                sendJson(exchange, 502, buildJsonObject { put("message", "Unable to list installed extensions") })
            }
        }

        createContext("/extensions/repository") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }
            if (exchange.requestMethod.uppercase() != "GET") {
                sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
                return@createContext
            }

            try {
                sendJson(exchange, 200, bridgeService.repositorySnapshot())
            } catch (error: Exception) {
                logger.warn(error) { "Failed to read repository snapshot" }
                sendJson(exchange, 502, buildJsonObject { put("message", "Unable to read repository snapshot") })
            }
        }

        createContext("/extensions/proxy") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }
            if (exchange.requestMethod.uppercase() != "PUT") {
                sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
                return@createContext
            }

            val payload = readJsonBody(exchange)
            val pkg = payload.optionalString("pkg")
            val useProxy = payload.optionalBoolean("useProxy")
            if (pkg.isNullOrBlank() || useProxy == null) {
                sendJson(exchange, 400, buildJsonObject { put("message", "Missing pkg or useProxy") })
                return@createContext
            }

            try {
                val result = kotlinx.coroutines.runBlocking { bridgeService.setExtensionProxy(pkg, useProxy) }
                sendJson(exchange, 200, result)
            } catch (error: Exception) {
                logger.warn(error) { "Failed to toggle extension proxy for $pkg" }
                sendJson(exchange, 502, buildJsonObject { put("message", "Unable to update extension proxy") })
            }
        }

        createContext("/extensions/source-enabled") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }
            if (exchange.requestMethod.uppercase() != "PUT") {
                sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
                return@createContext
            }

            val payload = readJsonBody(exchange)
            val pkg = payload.optionalString("pkg")
            val sourceId = payload.optionalString("sourceId")
            val enabled = payload.optionalBoolean("enabled")
            if (pkg.isNullOrBlank() || sourceId.isNullOrBlank() || enabled == null) {
                sendJson(exchange, 400, buildJsonObject { put("message", "Missing pkg, sourceId, or enabled") })
                return@createContext
            }

            try {
                val result = kotlinx.coroutines.runBlocking { bridgeService.setSourceEnabled(sourceId, enabled) }
                bridgeClient?.setInstalledExtensionSourceEnabled(
                    bridgeClient.payload(
                        buildJsonObject {
                            put("pkg", pkg)
                            put("sourceId", sourceId)
                            put("enabled", enabled)
                            put("now", System.currentTimeMillis())
                        },
                    ),
                )
                sendJson(exchange, 200, result)
            } catch (error: Exception) {
                if (error is IllegalStateException && error.message?.startsWith("Source not found:") == true) {
                    logger.info { "Ignoring stale source toggle for missing source $sourceId ($pkg)" }
                    sendJson(exchange, 404, buildJsonObject { put("message", "Source not found") })
                    return@createContext
                }
                logger.warn(error) { "Failed to toggle source $sourceId for $pkg" }
                sendJson(exchange, 502, buildJsonObject { put("message", "Unable to update source state") })
            }
        }

        createContext("/downloads/reconcile") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }
            if (exchange.requestMethod.uppercase() != "POST") {
                sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
                return@createContext
            }

            val client = requireBridgeClient(exchange) ?: return@createContext
            val payload = readJsonBody(exchange)
            val chapters = payload["chapters"]?.jsonArray?.map(::parseReconcileChapter).orEmpty()

            var fixed = 0
            var downloaded = 0
            var missing = 0

            for (chapter in chapters) {
                val stored =
                    bridgeService.resolveStoredChapter(
                        titleId = chapter.titleId,
                        titleName = chapter.titleName,
                        sourceId = chapter.sourceId,
                        sourcePkg = chapter.sourcePkg,
                        sourceLang = chapter.sourceLang,
                        chapterUrl = chapter.chapterUrl,
                        chapterName = chapter.chapterName,
                        chapterNumber = chapter.chapterNumber,
                    )
                if (stored == null) {
                    if (chapter.currentStatus == "downloaded" || !chapter.localRelativePath.isNullOrBlank()) {
                        updateChapterState(
                            client = client,
                            chapterId = chapter.chapterId,
                            status = "missing",
                            downloadedPages = 0,
                            totalPages = null,
                            localRelativePath = null,
                            storageKind = null,
                            fileSizeBytes = null,
                        )
                        fixed += 1
                    }
                    missing += 1
                    continue
                }

                downloaded += 1
                if (
                    chapter.currentStatus != "downloaded" ||
                    chapter.localRelativePath != stored.localRelativePath ||
                    chapter.storageKind != stored.storageKind
                ) {
                    updateChapterState(
                        client = client,
                        chapterId = chapter.chapterId,
                        status = "downloaded",
                        downloadedPages = stored.pageCount,
                        totalPages = stored.pageCount,
                        localRelativePath = stored.localRelativePath,
                        storageKind = stored.storageKind,
                        fileSizeBytes = stored.fileSizeBytes,
                    )
                    fixed += 1
                }
            }

            sendJson(
                exchange,
                200,
                buildJsonObject {
                    put("ok", true)
                    put("fixed", fixed)
                    put("downloaded", downloaded)
                    put("missing", missing)
                },
            )
        }

        createContext("/downloads/delete") { exchange ->
            if (!authorize(exchange)) {
                return@createContext
            }
            if (exchange.requestMethod.uppercase() != "POST") {
                sendJson(exchange, 405, buildJsonObject { put("message", "Method not allowed") })
                return@createContext
            }

            val client = requireBridgeClient(exchange) ?: return@createContext
            val payload = readJsonBody(exchange)
            val chapterId = payload.requiredString("chapterId")
            val titleId = payload.requiredString("titleId")
            val chapterUrl = payload.requiredString("chapterUrl")
            val deleted =
                bridgeService.deleteDownloadedChapter(
                    titleId = titleId,
                    titleName = payload.requiredString("titleName"),
                    sourceId = payload.requiredString("sourceId"),
                    sourcePkg = payload.requiredString("sourcePkg"),
                    sourceLang = payload.requiredString("sourceLang"),
                    chapterUrl = chapterUrl,
                    chapterName = payload.requiredString("chapterName"),
                    chapterNumber = payload.optionalDouble("chapterNumber"),
                    localRelativePath = payload.optionalString("localRelativePath"),
                )

            updateChapterState(
                client = client,
                chapterId = chapterId,
                status = "missing",
                downloadedPages = 0,
                totalPages = null,
                localRelativePath = null,
                storageKind = null,
                fileSizeBytes = null,
            )

            sendJson(
                exchange,
                200,
                buildJsonObject {
                    put("ok", true)
                    put("deleted", deleted)
                },
            )
        }

        server.start()
    }

    fun stop() {
        server.stop(0)
        httpExecutor.shutdownNow()
    }

    private fun createContext(
        path: String,
        handler: (HttpExchange) -> Unit,
    ) {
        server.createContext(path) { exchange ->
            val requestId = resolveRequestId(exchange)
            val startedAt = System.currentTimeMillis()
            exchange.responseHeaders.set(REQUEST_ID_HEADER, requestId)
            try {
                LogContext
                    .of(
                        "request_id" to requestId,
                        "http_route" to path,
                        "http_method" to exchange.requestMethod.uppercase(),
                    ).use {
                        handler(exchange)
                    }
            } finally {
                val status = (exchange.getAttribute(RESPONSE_STATUS_ATTRIBUTE) as? Int) ?: 500
                val durationMs = System.currentTimeMillis() - startedAt
                if (shouldLogRequestCompletion(path, status, durationMs)) {
                    logRequestCompletion(exchange, path, requestId, status, durationMs)
                }
            }
        }
    }

    private fun resolveRequestId(exchange: HttpExchange): String {
        val header = exchange.requestHeaders.getFirst(REQUEST_ID_HEADER)?.trim().orEmpty()
        return if (header.isNotEmpty() && header.length <= 128 && REQUEST_ID_PATTERN.matches(header)) {
            header
        } else {
            UUID.randomUUID().toString()
        }
    }

    private fun shouldLogRequestCompletion(
        path: String,
        status: Int,
        durationMs: Long,
    ): Boolean {
        val slowRequestThresholdMs = requestLogSlowThresholdMs(path)
        if (status >= 500 || durationMs >= slowRequestThresholdMs) {
            return true
        }
        if (path in HTTP_PROBE_PATHS) {
            return false
        }
        return status >= 400
    }

    private fun requestLogSlowThresholdMs(path: String): Long =
        when (path) {
            "/assets/page" -> PAGE_ASSET_REQUEST_LOG_SLOW_MS
            "/assets/remote/cover" -> REMOTE_COVER_REQUEST_LOG_SLOW_MS
            else -> DEFAULT_REQUEST_LOG_SLOW_MS
        }

    private fun logRequestCompletion(
        exchange: HttpExchange,
        path: String,
        requestId: String,
        status: Int,
        durationMs: Long,
    ) {
        val remoteAddress = exchange.remoteAddress.address?.hostAddress ?: exchange.remoteAddress.hostString
        val context =
            buildList {
                add("request_id" to requestId)
                add("method" to exchange.requestMethod.uppercase())
                add("path" to exchange.requestURI.path)
                add("route" to path)
                add("status" to status)
                add("duration_ms" to durationMs)
                if (!isLoopbackAddress(remoteAddress)) {
                    add("remote_addr" to remoteAddress)
                }
            }.toTypedArray()
        when {
            status >= 500 ->
                httpEvents.error(
                    "http.request.completed",
                    "Bridge HTTP request completed with server error",
                    null,
                    *context,
                )

            status >= 400 ->
                httpEvents.warn(
                    "http.request.completed",
                    "Bridge HTTP request completed with client error",
                    *context,
                )

            else ->
                httpEvents.info(
                    "http.request.completed",
                    "Bridge HTTP request completed",
                    *context,
                )
        }
    }

    private fun isLoopbackAddress(value: String?): Boolean {
        val normalized = value?.trim()?.lowercase().orEmpty()
        return normalized == "127.0.0.1" ||
            normalized == "::1" ||
            normalized == "::ffff:127.0.0.1" ||
            normalized.startsWith("127.")
    }

    private fun authorize(exchange: HttpExchange): Boolean {
        val providedSecret = exchange.requestHeaders.getFirst("x-mangarr-service-secret").orEmpty()
        if (serviceSecret.isBlank() || !secretsMatch(providedSecret)) {
            sendJson(
                exchange,
                401,
                buildJsonObject {
                    put("ok", false)
                    put("message", "Missing or invalid bridge service secret")
                },
            )
            return false
        }
        return true
    }

    private fun secretsMatch(providedSecret: String): Boolean =
        MessageDigest.isEqual(
            serviceSecret.toByteArray(Charsets.UTF_8),
            providedSecret.toByteArray(Charsets.UTF_8),
        )

    private fun shouldLogPageAssetFailure(logKey: String, now: Long = System.currentTimeMillis()): Boolean {
        val lastLoggedAt = pageAssetFailureLogCache[logKey]
        if (lastLoggedAt != null && now - lastLoggedAt < PAGE_ASSET_FAILURE_LOG_TTL_MS) {
            return false
        }
        pageAssetFailureLogCache[logKey] = now
        pageAssetFailureLogCache.entries.removeIf { (_, loggedAt) ->
            now - loggedAt >= PAGE_ASSET_FAILURE_LOG_TTL_MS
        }
        return true
    }

    private fun sendJson(exchange: HttpExchange, status: Int, payload: kotlinx.serialization.json.JsonObject) {
        val body = json.encodeToString(kotlinx.serialization.json.JsonObject.serializer(), payload).toByteArray()
        exchange.responseHeaders.add("content-type", "application/json")
        sendResponse(exchange, status, body.size.toLong()) {
            it.write(body)
        }
    }

    private fun sendPlainText(exchange: HttpExchange, status: Int, payload: String) {
        val body = payload.toByteArray()
        exchange.responseHeaders.set("content-type", "text/plain; charset=utf-8")
        sendResponse(exchange, status, body.size.toLong()) {
            it.write(body)
        }
    }

    private fun sendBytes(
        exchange: HttpExchange,
        status: Int,
        body: ByteArray,
        contentType: String,
        extraHeaders: Map<String, String> = emptyMap(),
    ) {
        exchange.responseHeaders.set("content-type", contentType)
        exchange.responseHeaders.set("cache-control", "private, max-age=300")
        for ((name, value) in extraHeaders) {
            exchange.responseHeaders.set(name, value)
        }
        sendResponse(exchange, status, body.size.toLong()) {
            it.write(body)
        }
    }

    private fun sendFile(
        exchange: HttpExchange,
        status: Int,
        filePath: java.nio.file.Path,
        contentType: String,
        contentLength: Long,
        extraHeaders: Map<String, String> = emptyMap(),
        deleteAfterSend: Boolean = false,
    ) {
        exchange.responseHeaders.set("content-type", contentType)
        exchange.responseHeaders.set("cache-control", "private, max-age=300")
        for ((name, value) in extraHeaders) {
            exchange.responseHeaders.set(name, value)
        }
        try {
            sendResponse(exchange, status, contentLength) {
                Files.copy(filePath, it)
            }
        } finally {
            if (deleteAfterSend) {
                runCatching { filePath.deleteIfExists() }
            }
        }
    }

    private inline fun sendResponse(
        exchange: HttpExchange,
        status: Int,
        contentLength: Long,
        write: (java.io.OutputStream) -> Unit,
    ) {
        try {
            exchange.setAttribute(RESPONSE_STATUS_ATTRIBUTE, status)
            exchange.sendResponseHeaders(status, contentLength)
            exchange.responseBody.use { output -> write(output) }
        } catch (error: IOException) {
            if (isClientAbort(error)) {
                httpEvents.warn(
                    "http.request.client_disconnected",
                    "Client disconnected before bridge response completed",
                    "method" to exchange.requestMethod.uppercase(),
                    "path" to exchange.requestURI.path,
                )
                return
            }
            throw error
        }
    }

    private fun isClientAbort(error: IOException): Boolean {
        var current: Throwable? = error
        while (current != null) {
            val message = current.message?.lowercase().orEmpty()
            if (
                message.contains("broken pipe") ||
                message.contains("connection reset by peer") ||
                message.contains("stream closed")
            ) {
                return true
            }
            current = current.cause
        }
        return false
    }

    private fun parsePublicRemoteCoverUrl(raw: String): URI? {
        val parsed =
            try {
                URI(raw.trim())
            } catch (_: Exception) {
                return null
            }
        if (parsed.scheme != "http" && parsed.scheme != "https") {
            return null
        }
        if (!parsed.userInfo.isNullOrBlank()) {
            return null
        }
        val host = parsed.host?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val resolved =
            try {
                InetAddress.getAllByName(host)
            } catch (_: Exception) {
                return null
            }
        if (resolved.isEmpty() || resolved.any { !isPublicInternetAddress(it) }) {
            return null
        }
        return parsed.normalize()
    }

    private fun resolvePublicRedirectTarget(
        currentUrl: URI,
        location: String?,
    ): URI? {
        val nextRaw = location?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return parsePublicRemoteCoverUrl(currentUrl.resolve(nextRaw).toString())
    }

    private fun isPublicInternetAddress(address: InetAddress): Boolean {
        if (
            address.isAnyLocalAddress ||
            address.isLoopbackAddress ||
            address.isLinkLocalAddress ||
            address.isSiteLocalAddress ||
            address.isMulticastAddress
        ) {
            return false
        }
        return when (address) {
            is Inet4Address -> isPublicIpv4Address(address)
            is Inet6Address -> isPublicIpv6Address(address)
        }
    }

    private fun isPublicIpv4Address(address: Inet4Address): Boolean {
        val octets = address.address
        val first = octets[0].toInt() and 0xff
        val second = octets[1].toInt() and 0xff

        if (first == 0 || first == 10 || first == 127) return false
        if (first == 100 && second in 64..127) return false
        if (first == 169 && second == 254) return false
        if (first == 172 && second in 16..31) return false
        if (first == 192 && second == 168) return false
        if (first == 198 && (second == 18 || second == 19)) return false
        if (first >= 224) return false

        return true
    }

    private fun isPublicIpv6Address(address: Inet6Address): Boolean {
        val octets = address.address
        val first = octets[0].toInt() and 0xff
        val second = octets[1].toInt() and 0xff

        if (address.isIPv4CompatibleAddress) return false
        if (first and 0xfe == 0xfc) return false
        if (first == 0xfe && second and 0xc0 == 0x80) return false

        return true
    }

    private fun readResponseBodyWithinLimit(
        body: okhttp3.ResponseBody,
        maxBytes: Long,
    ): ByteArray? {
        val declaredLength = body.contentLength()
        if (declaredLength > maxBytes) {
            return null
        }

        val source = body.source()
        val buffer = okio.Buffer()
        var totalBytes = 0L
        while (true) {
            val read = source.read(buffer, 8_192)
            if (read == -1L) {
                return buffer.readByteArray()
            }
            totalBytes += read
            if (totalBytes > maxBytes) {
                return null
            }
        }
    }

    private fun isRemoteCoverImage(
        contentType: String?,
        bytes: ByteArray,
        detectedImageType: ImageUtil.ImageType? = ImageUtil.findImageType(ByteArrayInputStream(bytes)),
    ): Boolean {
        val normalizedType = contentType?.substringBefore(';')?.trim()?.lowercase()
        if (normalizedType?.startsWith("image/") == true) {
            return true
        }
        return detectedImageType != null
    }

    private fun HttpExchange.queryParam(name: String): String? =
        requestURI.rawQuery
            ?.split('&')
            ?.asSequence()
            ?.mapNotNull { part ->
                if (part.isBlank()) {
                    null
                } else {
                    val key = part.substringBefore('=')
                    val value = part.substringAfter('=', "")
                    URLDecoder.decode(key, Charsets.UTF_8) to URLDecoder.decode(value, Charsets.UTF_8)
                }
            }?.firstOrNull { (key, _) -> key == name }
            ?.second

    private fun readJsonBody(exchange: HttpExchange): JsonObject {
        val raw = exchange.requestBody.bufferedReader().readText().trim()
        if (raw.isBlank()) {
            return JsonObject(emptyMap())
        }
        return json.parseToJsonElement(raw).jsonObject
    }

    private fun requireBridgeClient(exchange: HttpExchange): ConvexBridgeClient? {
        if (bridgeClient != null) {
            return bridgeClient
        }
        sendJson(exchange, 503, buildJsonObject { put("message", "Convex bridge client is unavailable") })
        return null
    }

    private fun parseReconcileChapter(element: kotlinx.serialization.json.JsonElement): DownloadReconcileChapter {
        val payload = element.jsonObject
        return DownloadReconcileChapter(
            chapterId = payload.requiredString("chapterId"),
            titleId = payload.requiredString("titleId"),
            titleName = payload.requiredString("titleName"),
            sourceId = payload.requiredString("sourceId"),
            sourcePkg = payload.requiredString("sourcePkg"),
            sourceLang = payload.requiredString("sourceLang"),
            chapterUrl = payload.requiredString("chapterUrl"),
            chapterName = payload.requiredString("chapterName"),
            chapterNumber = payload.optionalDouble("chapterNumber"),
            currentStatus = payload.requiredString("currentStatus"),
            localRelativePath = payload.optionalString("localRelativePath"),
            storageKind = payload.optionalString("storageKind"),
        )
    }

    private fun updateChapterState(
        client: ConvexBridgeClient,
        chapterId: String,
        status: String,
        downloadedPages: Int,
        totalPages: Int?,
        localRelativePath: String?,
        storageKind: String?,
        fileSizeBytes: Long?,
    ) {
        client.setLibraryChapterDownloadState(
            client.payload(
                buildJsonObject {
                    put("chapterId", chapterId)
                    put("status", status)
                    put("downloadedPages", downloadedPages)
                    if (totalPages != null) {
                        put("totalPages", totalPages)
                    }
                    put("localRelativePath", localRelativePath?.let(::JsonPrimitive) ?: JsonNull)
                    put("storageKind", storageKind?.let(::JsonPrimitive) ?: JsonNull)
                    if (fileSizeBytes != null) {
                        put("fileSizeBytes", fileSizeBytes)
                    }
                    put("lastErrorMessage", JsonNull)
                    put("now", System.currentTimeMillis())
                },
            ),
        )
    }

    private fun JsonObject.requiredString(name: String): String =
        this[name]?.jsonPrimitive?.contentOrNull ?: error("Missing $name")

    private fun JsonObject.optionalString(name: String): String? =
        this[name]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }

    private fun JsonObject.optionalInt(name: String): Int? =
        this[name]?.jsonPrimitive?.intLikeOrNull()

    private fun JsonObject.optionalBoolean(name: String): Boolean? =
        this[name]?.jsonPrimitive?.contentOrNull?.toBooleanStrictOrNull()

    private fun JsonObject.optionalDouble(name: String): Double? =
        this[name]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull()

    private fun JsonPrimitive.intLikeOrNull(): Int? {
        val numeric = contentOrNull?.toDoubleOrNull() ?: return null
        if (!numeric.isFinite() || numeric % 1.0 != 0.0) return null
        return numeric.toInt()
    }
}

private fun namedThreadFactory(prefix: String): ThreadFactory {
    val counter = AtomicInteger(1)
    return ThreadFactory { runnable ->
        Thread(runnable, "$prefix-${counter.getAndIncrement()}").apply {
            isDaemon = true
        }
    }
}

private fun Throwable.findHttpException(): HttpException? {
    var current: Throwable? = this
    while (current != null) {
        if (current is HttpException) {
            return current
        }
        current = current.cause
    }
    return null
}
