package mangarr.tachibridge.server

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
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
import mangarr.tachibridge.runtime.BridgeSnapshot
import mangarr.tachibridge.runtime.BridgeCommandRunner
import mangarr.tachibridge.runtime.CommandRunnerSnapshot
import mangarr.tachibridge.runtime.BridgeHeartbeatReporter
import mangarr.tachibridge.runtime.BridgeService
import mangarr.tachibridge.runtime.HeartbeatSnapshot
import mangarr.tachibridge.runtime.BridgeState
import mangarr.tachibridge.runtime.ConvexBridgeClient
import mangarr.tachibridge.runtime.DownloadReconcileChapter
import java.net.URLDecoder
import java.net.InetSocketAddress
import java.nio.file.Files
import java.io.IOException
import java.util.concurrent.Executors
import kotlin.io.path.deleteIfExists

private val logger = KotlinLogging.logger {}

class BridgeHttpServer(
    private val host: String,
    private val port: Int,
    private val serviceSecret: String,
    private val bridgeState: BridgeState,
    private val heartbeatReporter: BridgeHeartbeatReporter,
    private val commandRunner: BridgeCommandRunner,
    private val bridgeService: BridgeService,
    private val bridgeClient: ConvexBridgeClient?,
    private val bridgeId: String,
) {
    private val json = Json { prettyPrint = false }
    private val server =
        HttpServer.create(InetSocketAddress(host, port), 0).apply {
            executor = Executors.newCachedThreadPool()
        }

    fun start() {
        server.createContext("/health") { exchange ->
            sendJson(
                exchange,
                200,
                buildJsonObject {
                    put("ok", true)
                    put("bridge", json.encodeToJsonElement(BridgeSnapshot.serializer(), bridgeState.current()))
                    put("convex", json.encodeToJsonElement(HeartbeatSnapshot.serializer(), heartbeatReporter.snapshot()))
                    put("commands", json.encodeToJsonElement(CommandRunnerSnapshot.serializer(), commandRunner.snapshot()))
                },
            )
        }

        server.createContext("/bridge") { exchange ->
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

        server.createContext("/bridge/start") { exchange ->
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

        server.createContext("/bridge/stop") { exchange ->
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

        server.createContext("/bridge/restart") { exchange ->
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

        server.createContext("/assets/page") { exchange ->
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
                logger.warn(error) { "Failed to serve page asset for source=$sourceId chapter=$chapterUrl index=$index" }
                sendJson(exchange, 502, buildJsonObject { put("message", "Bridge page asset is unavailable") })
            }
        }

        server.createContext("/assets/library/page") { exchange ->
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

        server.createContext("/assets/library/cover") { exchange ->
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

        server.createContext("/assets/library/chapter-file") { exchange ->
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

        server.createContext("/settings/downloads") { exchange ->
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

        server.createContext("/settings/proxy") { exchange ->
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

        server.createContext("/settings/flaresolverr") { exchange ->
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

        server.createContext("/extensions/installed") { exchange ->
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

        server.createContext("/extensions/repository") { exchange ->
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

        server.createContext("/extensions/proxy") { exchange ->
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

        server.createContext("/extensions/source-enabled") { exchange ->
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
                logger.warn(error) { "Failed to toggle source $sourceId for $pkg" }
                sendJson(exchange, 502, buildJsonObject { put("message", "Unable to update source state") })
            }
        }

        server.createContext("/downloads/reconcile") { exchange ->
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

        server.createContext("/downloads/delete") { exchange ->
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
    }

    private fun authorize(exchange: HttpExchange): Boolean {
        val providedSecret = exchange.requestHeaders.getFirst("x-mangarr-service-secret").orEmpty()
        if (serviceSecret.isBlank() || providedSecret != serviceSecret) {
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

    private fun sendJson(exchange: HttpExchange, status: Int, payload: kotlinx.serialization.json.JsonObject) {
        val body = json.encodeToString(kotlinx.serialization.json.JsonObject.serializer(), payload).toByteArray()
        exchange.responseHeaders.add("content-type", "application/json")
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
            exchange.sendResponseHeaders(status, contentLength)
            exchange.responseBody.use { output -> write(output) }
        } catch (error: IOException) {
            if (isClientAbort(error)) {
                logger.debug(error) { "Client disconnected before bridge response completed" }
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
