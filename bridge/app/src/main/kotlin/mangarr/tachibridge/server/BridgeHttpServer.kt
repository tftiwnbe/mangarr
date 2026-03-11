package mangarr.tachibridge.server

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mangarr.tachibridge.runtime.BridgeSnapshot
import mangarr.tachibridge.runtime.BridgeCommandRunner
import mangarr.tachibridge.runtime.CommandRunnerSnapshot
import mangarr.tachibridge.runtime.BridgeHeartbeatReporter
import mangarr.tachibridge.runtime.BridgeService
import mangarr.tachibridge.runtime.HeartbeatSnapshot
import mangarr.tachibridge.runtime.BridgeState
import java.net.URLDecoder
import java.net.InetSocketAddress
import java.util.concurrent.Executors

private val logger = KotlinLogging.logger {}

class BridgeHttpServer(
    private val host: String,
    private val port: Int,
    private val serviceSecret: String,
    private val bridgeState: BridgeState,
    private val heartbeatReporter: BridgeHeartbeatReporter,
    private val commandRunner: BridgeCommandRunner,
    private val bridgeService: BridgeService,
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
            val index = exchange.queryParam("index")?.toIntOrNull()
            if (sourceId.isNullOrBlank() || chapterUrl.isNullOrBlank() || index == null || index < 0) {
                sendJson(exchange, 400, buildJsonObject { put("message", "Missing sourceId, chapterUrl, or index") })
                return@createContext
            }

            try {
                val image = kotlinx.coroutines.runBlocking {
                    bridgeService.fetchPageImage(sourceId, chapterUrl, index)
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
            val storageKind = exchange.queryParam("storage")
            val index = exchange.queryParam("index")?.toIntOrNull()
            if (localRelativePath.isNullOrBlank() || storageKind.isNullOrBlank() || index == null || index < 0) {
                sendJson(exchange, 400, buildJsonObject { put("message", "Missing path, storage, or index") })
                return@createContext
            }

            try {
                val image = bridgeService.fetchStoredPage(localRelativePath, storageKind, index)
                sendBytes(exchange, 200, image.bytes, image.contentType)
            } catch (error: Exception) {
                logger.warn(error) {
                    "Failed to serve downloaded page asset path=$localRelativePath storage=$storageKind index=$index"
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

        server.start()
        logger.info { "Bridge HTTP server started on $host:$port" }
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
        exchange.sendResponseHeaders(status, body.size.toLong())
        exchange.responseBody.use { output -> output.write(body) }
    }

    private fun sendBytes(exchange: HttpExchange, status: Int, body: ByteArray, contentType: String) {
        exchange.responseHeaders.set("content-type", contentType)
        exchange.responseHeaders.set("cache-control", "private, max-age=300")
        exchange.sendResponseHeaders(status, body.size.toLong())
        exchange.responseBody.use { output -> output.write(body) }
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
}
