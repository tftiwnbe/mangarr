package mangarr.tachibridge.server

import android.os.Looper
import com.jetbrains.cef.JCefAppConfig
import dev.datlag.kcef.KCEF
import dev.datlag.kcef.KCEFBuilder.Settings.LogSeverity
import eu.kanade.tachiyomi.App
import eu.kanade.tachiyomi.network.NetworkHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mangarr.tachibridge.config.ConfigManager
import mangarr.tachibridge.extensions.ExtensionManager
import mangarr.tachibridge.loader.ConfigExtensionsDirectories
import mangarr.tachibridge.loader.ExtensionLoader
import mangarr.tachibridge.loader.PackageTools
import mangarr.tachibridge.logging.EventLogger
import mangarr.tachibridge.logging.LogContext
import mangarr.tachibridge.repo.ExtensionRepoService
import mangarr.tachibridge.runtime.BridgeCommandRunner
import mangarr.tachibridge.runtime.BridgeHeartbeatReporter
import mangarr.tachibridge.runtime.BridgeJwtSigner
import mangarr.tachibridge.runtime.BridgeRuntimeConfig
import mangarr.tachibridge.runtime.BridgeService
import mangarr.tachibridge.runtime.BridgeState
import mangarr.tachibridge.runtime.ConvexBridgeClient
import mangarr.tachibridge.runtime.ConvexBridgeClientConfig
import mangarr.tachibridge.runtime.DownloadStorage
import mangarr.tachibridge.util.toCefCookie
import mangarr.tachibridge.webview.KcefCookieSync
import mangarr.tachibridge.webview.KcefProxyConfig
import mangarr.tachibridge.webview.KcefProxyRelay
import mangarr.tachibridge.webview.WebViewSessionManager
import mangarr.tachibridge.webview.WebViewSocketServer
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.cef.CefApp
import org.cef.CefSettings
import org.cef.network.CefCookieManager
import org.koin.core.context.startKoin
import org.koin.core.logger.Level
import org.koin.dsl.module
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get
import xyz.nulldev.androidcompat.AndroidCompat
import xyz.nulldev.androidcompat.AndroidCompatInitializer
import xyz.nulldev.androidcompat.androidCompatModule
import xyz.nulldev.androidcompat.webkit.KcefWebViewProvider
import java.io.File
import java.nio.file.Files
import java.security.Security
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.io.path.Path
import kotlin.io.path.createDirectories
import kotlin.math.roundToInt

data class ServerConfig(
    val dataDir: String,
    val runtime: BridgeRuntimeConfig,
)

private val events = EventLogger.named(
    "mangarr.tachibridge.server.BridgeServer",
    "component" to "bridge_server",
)
private const val CACHE_PRUNE_INTERVAL_MS = 15 * 60 * 1000L
private const val CACHE_PRUNE_INFO_THRESHOLD = 5

@kotlinx.serialization.ExperimentalSerializationApi
class BridgeServer(
    private val config: ServerConfig,
) {
    private val dataPath = Path(config.dataDir).toAbsolutePath().normalize()
    private val extensionsPath = dataPath.resolve("extensions")

    private val extensionsDirectories = ConfigExtensionsDirectories(extensionsPath.toString())
    private val packageTools = PackageTools(extensionsDirectories)
    private val extensionLoader = ExtensionLoader(extensionsDirectories, packageTools)

    private lateinit var networkHelper: NetworkHelper
    private lateinit var repoService: ExtensionRepoService
    private lateinit var extensionManager: ExtensionManager
    private lateinit var bridgeState: BridgeState
    private lateinit var heartbeatReporter: BridgeHeartbeatReporter
    private lateinit var commandRunner: BridgeCommandRunner
    private lateinit var httpServer: BridgeHttpServer
    private lateinit var webViewSessionManager: WebViewSessionManager
    private lateinit var webViewSocketServer: WebViewSocketServer
    private var kcefProxyConfig: KcefProxyConfig? = null
    private var kcefProxyRelay: KcefProxyRelay? = null
    private val bridgeScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val shutdownLatch = CountDownLatch(1)
    @Volatile private var kcefInitialized = false
    @Volatile
    private var kcefSnapshot: JsonObject =
        buildJsonObject {
            put("enabled", isKcefEnabled())
            put("initialized", false)
            put("status", if (isKcefEnabled()) "starting" else "disabled")
        }
    private val runtimeContext =
        LogContext.of(
            "bridgeId" to config.runtime.bridgeId,
            "port" to config.runtime.port,
            "dataDir" to dataPath.toString(),
            "extensionsDir" to extensionsPath.toString(),
        )

    private fun setKcefSnapshot(
        status: String,
        initialized: Boolean,
        lastError: String? = null,
    ) {
        kcefSnapshot =
            buildJsonObject {
                put("enabled", isKcefEnabled())
                put("initialized", initialized)
                put("status", status)
                if (!lastError.isNullOrBlank()) {
                    put("lastError", lastError)
                }
            }
    }

    @kotlinx.coroutines.DelicateCoroutinesApi
    fun start() =
        runBlocking {
            events.info(
                "bridge.runtime.starting",
                "Starting bridge runtime",
                "bridgeId" to config.runtime.bridgeId,
                "port" to config.runtime.port,
                "dataDir" to dataPath,
                "extensionsDir" to extensionsPath,
                "host" to config.runtime.host,
                "convexConfigured" to config.runtime.convexUrl.isNotBlank(),
            )

            ConfigManager.init(dataPath)
            System.setProperty("mangarr.data.dir", dataPath.toString())

            val tmpDir = dataPath.resolve("tmp").also { it.createDirectories() }
            System.setProperty("java.io.tmpdir", tmpDir.toString())

            mangarr.tachibridge.config.FlareSolverrConfigProvider.update(
                ConfigManager.config.flareSolverr,
            )

            initializeAndroidCompat()

            networkHelper = Injekt.get()

            val initialRepoUrl = ConfigManager.config.repoUrl
            val json = Json { ignoreUnknownKeys = true }
            repoService =
                ExtensionRepoService(
                    networkHelper = networkHelper,
                    initialRepoIndexUrl = initialRepoUrl,
                    cachePath = dataPath.resolve("cache/repo/index.json"),
                    json = json,
                )

            extensionManager =
                ExtensionManager(
                    extensionsDir = extensionsPath,
                    loader = extensionLoader,
                    repoService = repoService,
                    networkHelper = networkHelper,
                )
            val cookieSync = KcefCookieSync(networkHelper.cookieStore)
            kcefProxyConfig = KcefProxyConfig.from(ConfigManager.config.proxy)
            webViewSessionManager =
                WebViewSessionManager(
                    extensionManager = extensionManager,
                    cookieSync = cookieSync,
                    proxyConfig = kcefProxyConfig,
                    browserReady = { kcefInitialized },
                )
            val webViewPort =
                System.getenv("MANGARR_WEBVIEW_PORT")
                    ?.trim()
                    ?.toIntOrNull()
                    ?.takeIf { it in 1..65535 }
                    ?: (config.runtime.port + 1)
            webViewSocketServer = WebViewSocketServer(webViewPort, webViewSessionManager)

            val convexClient =
                if (config.runtime.convexUrl.isNotBlank()) {
                    val signer = BridgeJwtSigner(config.runtime.convexAuth, config.runtime.bridgeId)
                    ConvexBridgeClient(
                        ConvexBridgeClientConfig(
                            baseUrl = config.runtime.convexUrl,
                            authTokenProvider = signer::currentToken,
                        ),
                    )
                } else {
                    null
                }
            val bridgeService =
                BridgeService(
                    extensionManager,
                    repoService,
                    DownloadStorage(dataPath),
                    dataPath.resolve("cache/feeds"),
                    dataPath.resolve("cache/reader-pages"),
                )
            bridgeState = BridgeState(config.runtime.bridgeId, config.runtime.port, convexClient != null)
            heartbeatReporter =
                BridgeHeartbeatReporter(
                    bridgeClient = convexClient,
                    bridgeState = bridgeState,
                    bridgeId = config.runtime.bridgeId,
                    version = mangarr.tachibridge.generated.BuildConfig.VERSION,
                    intervalMs = config.runtime.heartbeatIntervalMs,
                )
            commandRunner =
                BridgeCommandRunner(
                    bridgeClient = convexClient,
                    service = bridgeService,
                    bridgeId = config.runtime.bridgeId,
                    pollIntervalMs = config.runtime.commandPollIntervalMs,
                    leaseDurationMs = config.runtime.commandLeaseDurationMs,
                )
            httpServer =
                BridgeHttpServer(
                    host = config.runtime.host,
                    port = config.runtime.port,
                    serviceSecret = config.runtime.serviceSecret,
                    bridgeState = bridgeState,
                    heartbeatReporter = heartbeatReporter,
                    commandRunner = commandRunner,
                    bridgeService = bridgeService,
                    networkHelper = networkHelper,
                    bridgeClient = convexClient,
                    bridgeId = config.runtime.bridgeId,
                    kcefSnapshotProvider = { kcefSnapshot },
                    webViewSessionManager = webViewSessionManager,
                )
            bridgeState.setRunning()
            heartbeatReporter.start()
            webViewSocketServer.start()
            httpServer.start()
            events.info(
                "bridge.runtime.started",
                "Bridge runtime started",
                "bridgeId" to config.runtime.bridgeId,
                "port" to config.runtime.port,
                "host" to config.runtime.host,
                "repoUrl" to ConfigManager.config.repoUrl.ifBlank { null },
            )
            bridgeScope.launch {
                while (true) {
                    delay(CACHE_PRUNE_INTERVAL_MS)
                    pruneBridgeCaches(bridgeService, phase = "maintenance")
                }
            }

            bridgeScope.launch {
                events.info(
                    "bridge.warmup.started",
                    "Bridge warmup started",
                    "bridgeId" to config.runtime.bridgeId,
                    "phase" to "warmup",
                )
                try {
                    val warmupWarnings = mutableListOf<String>()
                    pruneBridgeCaches(bridgeService, phase = "warmup")
                    runCatching {
                        initializeKCEF()
                    }.onFailure { error ->
                        val message = error.message ?: "KCEF warmup failed"
                        setKcefSnapshot(status = "degraded", initialized = false, lastError = message)
                        warmupWarnings += "KCEF: $message"
                        events.warn(
                            "bridge.kcef.degraded",
                            "KCEF warmup failed, continuing in degraded mode",
                            "bridgeId" to config.runtime.bridgeId,
                            "phase" to "warmup",
                            "warning" to message,
                        )
                    }
                    extensionManager.init()
                    if (convexClient != null && ConfigManager.config.repoUrl.isNotBlank()) {
                        runCatching {
                            val repository = bridgeService.repositorySnapshot()
                            convexClient.setExtensionRepository(
                                convexClient.payload(
                                    kotlinx.serialization.json.buildJsonObject {
                                        put("url", repository["url"] ?: JsonPrimitive(ConfigManager.config.repoUrl))
                                        put("languages", repository["languages"] ?: JsonArray(emptyList()))
                                        put("now", System.currentTimeMillis())
                                    },
                                ),
                            )
                        }.onFailure { error ->
                            events.error(
                                "bridge.repository.backfill_failed",
                                "Failed to persist repository metadata during warmup",
                                error,
                                "bridgeId" to config.runtime.bridgeId,
                                "repoUrl" to ConfigManager.config.repoUrl,
                            )
                            warmupWarnings +=
                                "Repository metadata backfill: ${error.message ?: "failed"}"
                        }
                    }
                    val warningMessage =
                        warmupWarnings
                            .map { it.trim() }
                            .filter { it.isNotEmpty() }
                            .joinToString("; ")
                            .ifBlank { null }
                    if (warningMessage == null) {
                        bridgeState.setReady()
                    } else {
                        bridgeState.setDegraded(warningMessage)
                    }
                    events.info(
                        "bridge.warmup.completed",
                        "Bridge warmup completed",
                        "bridgeId" to config.runtime.bridgeId,
                        "phase" to "warmup",
                        "sourceCount" to extensionManager.listSources().size,
                        "degraded" to (warningMessage != null),
                        "warnings" to warningMessage,
                    )
                } catch (e: Exception) {
                    setKcefSnapshot(status = "error", initialized = kcefInitialized, lastError = e.message)
                    bridgeState.setError(e.message ?: "Bridge warmup failed")
                    events.error(
                        "bridge.warmup.failed",
                        "Bridge warmup failed",
                        e,
                        "bridgeId" to config.runtime.bridgeId,
                        "phase" to "warmup",
                    )
                } finally {
                    commandRunner.start()
                }
            }

            Runtime.getRuntime().addShutdownHook(
                Thread {
                    events.info(
                        "bridge.runtime.shutdown_requested",
                        "Shutting down bridge runtime",
                        "bridgeId" to config.runtime.bridgeId,
                        "phase" to "shutdown",
                    )
                    this@BridgeServer.stop()
                    events.info(
                        "bridge.runtime.stopped",
                        "Bridge runtime stopped",
                        "bridgeId" to config.runtime.bridgeId,
                        "phase" to "shutdown",
                    )
                },
            )
        }

    private fun stop() =
        runBlocking {
            bridgeState.setStopped()
            commandRunner.stop()
            heartbeatReporter.stop()
            bridgeScope.cancel()
            webViewSocketServer.shutdown()
            extensionManager.cleanup()
            httpServer.stop()

            if (kcefInitialized) {
                events.info(
                    "bridge.kcef.shutdown_started",
                    "Shutting down KCEF",
                    "bridgeId" to config.runtime.bridgeId,
                    "phase" to "shutdown",
                )
                KCEF.disposeBlocking()
                events.info(
                    "bridge.kcef.shutdown_completed",
                    "KCEF shutdown complete",
                    "bridgeId" to config.runtime.bridgeId,
                    "phase" to "shutdown",
                )
            }
            kcefProxyRelay?.close()
            kcefProxyRelay = null
            shutdownLatch.countDown()
        }

    fun blockUntilShutdown() {
        shutdownLatch.await()
    }

    private fun pruneBridgeCaches(
        bridgeService: BridgeService,
        phase: String,
    ) {
        runCatching {
            bridgeService.pruneCaches()
        }.onSuccess { summary ->
            val deletedEntries =
                summary.deletedFeedFiles +
                    summary.deletedReaderPageFiles +
                    summary.deletedCoverFiles +
                    summary.deletedTempWorkspaces +
                    summary.deletedTempExports
            if (deletedEntries > 0) {
                val isRoutineMaintenance = phase == "maintenance" && deletedEntries < CACHE_PRUNE_INFO_THRESHOLD
                if (isRoutineMaintenance) {
                    events.debug(
                        "bridge.cache.pruned",
                        "Pruned bridge caches",
                        "bridgeId" to config.runtime.bridgeId,
                        "phase" to phase,
                        "deletedFeedFiles" to summary.deletedFeedFiles,
                        "deletedReaderPageFiles" to summary.deletedReaderPageFiles,
                        "deletedCoverFiles" to summary.deletedCoverFiles,
                        "deletedTempWorkspaces" to summary.deletedTempWorkspaces,
                        "deletedTempExports" to summary.deletedTempExports,
                    )
                } else {
                    events.info(
                        "bridge.cache.pruned",
                        "Pruned bridge caches",
                        "bridgeId" to config.runtime.bridgeId,
                        "phase" to phase,
                        "deletedFeedFiles" to summary.deletedFeedFiles,
                        "deletedReaderPageFiles" to summary.deletedReaderPageFiles,
                        "deletedCoverFiles" to summary.deletedCoverFiles,
                        "deletedTempWorkspaces" to summary.deletedTempWorkspaces,
                        "deletedTempExports" to summary.deletedTempExports,
                    )
                }
            }
        }.onFailure { error ->
            events.warn(
                "bridge.cache.prune_failed",
                "Failed to prune bridge caches",
                "bridgeId" to config.runtime.bridgeId,
                "phase" to phase,
                "warning" to (error.message ?: "cache prune failed"),
            )
        }
    }

    @kotlinx.coroutines.DelicateCoroutinesApi
    private fun initializeKCEF() {
        val kcefEvents = events.withContext("subsystem" to "kcef")
        if (!isKcefEnabled()) {
            setKcefSnapshot(status = "disabled", initialized = false)
            kcefEvents.info("bridge.kcef.disabled", "KCEF is disabled")
            return
        }
        setKcefSnapshot(status = "initializing", initialized = false)
        kcefEvents.info("bridge.kcef.initializing", "Initializing KCEF")
        Security.addProvider(BouncyCastleProvider())
        if (System.getProperty("os.name")?.contains("linux", ignoreCase = true) == true) {
            System.setProperty("jcef_app_preinit_any", System.getProperty("jcef_app_preinit_any") ?: "true")
        }

        val kcefInstallOverride =
            System.getenv("KCEF_INSTALL_DIR")
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
        val kcefBinDir =
            (kcefInstallOverride?.let { Path(it) } ?: dataPath.resolve("bin/kcef"))
                .toAbsolutePath()
                .normalize()
        val kcefCacheDir = dataPath.resolve("cache/kcef").toAbsolutePath().normalize()
        val disableSandbox =
            System.getenv("MANGARR_KCEF_NO_SANDBOX")
                ?.trim()
                ?.lowercase()
                ?.let { it == "1" || it == "true" || it == "yes" || it == "on" }
                ?: false
        val upstreamProxyConfig = kcefProxyConfig
        kcefProxyRelay = upstreamProxyConfig?.let(KcefProxyRelay::start)
        val proxyConfig = kcefProxyRelay?.localConfig ?: upstreamProxyConfig
        kcefBinDir.createDirectories()
        kcefCacheDir.createDirectories()

        if (disableSandbox) {
            kcefEvents.warn(
                "bridge.kcef.sandbox_disabled",
                "KCEF sandbox is disabled for the current runtime user",
                "user" to System.getProperty("user.name"),
            )
        }
        if (proxyConfig != null) {
            kcefEvents.info(
                "bridge.kcef.proxy_configured",
                "KCEF will use the shared HTTP proxy",
                "hostname" to proxyConfig.hostname,
                "port" to proxyConfig.port,
                "authenticated" to (proxyConfig.username != null),
            )
        }

        fun logMissingNativeDeps(installDir: java.nio.file.Path) {
            val osName = System.getProperty("os.name")?.lowercase() ?: ""
            if (!osName.contains("linux")) return

            val candidateLibs =
                listOf(
                    installDir.resolve("libjcef.so"),
                    installDir.resolve("libcef.so"),
                )

            val existingLib = candidateLibs.firstOrNull { Files.exists(it) }
            if (existingLib == null) {
                kcefEvents.warn(
                    "bridge.kcef.native_lib_missing",
                    "KCEF native library not found",
                    "installDir" to installDir,
                )
                return
            }

            try {
                val process =
                    ProcessBuilder("ldd", existingLib.toString())
                        .redirectErrorStream(true)
                        .start()
                val output = process.inputStream.bufferedReader().readText()
                process.waitFor()
                val missing = output.lineSequence().filter { it.contains("not found") }.toList()
                if (missing.isNotEmpty()) {
                    kcefEvents.warn(
                        "bridge.kcef.native_deps_missing",
                        "KCEF native dependencies are missing",
                        "library" to existingLib.fileName,
                        "missingDeps" to missing.joinToString(", "),
                    )
                } else {
                    kcefEvents.info(
                        "bridge.kcef.native_deps_ready",
                        "KCEF native dependencies are available",
                        "library" to existingLib.fileName,
                    )
                }
            } catch (e: Exception) {
                kcefEvents.warn(
                    "bridge.kcef.native_deps_check_skipped",
                    "Skipping KCEF native dependency check",
                    "reason" to (e.message ?: e::class.java.simpleName),
                )
            }
        }

        val initFailure = AtomicReference<Throwable?>()
        val cefSettings =
            JCefAppConfig.getInstance().cefSettings.clone().apply {
                windowless_rendering_enabled = true
                cache_path = kcefCacheDir.toString()
                persist_session_cookies = true
                no_sandbox = disableSandbox
                log_severity = CefSettings.LogSeverity.LOGSEVERITY_DEFAULT
            }
        val kcefCommandLineArgs =
            buildList {
                add("--disable-gpu")
                // #1486 needed to be able to render without a window
                add("--off-screen-rendering-enabled")
                // #1489 since /dev/shm is restricted in docker (OOM)
                add("--disable-dev-shm-usage")
                // #1723 support Widevine (incomplete)
                add("--enable-widevine-cdm")
                // #1736 JCEF does implement stack guards properly
                add("--change-stack-guard-on-fork=disable")
                if (proxyConfig != null) {
                    add(proxyConfig.serverArgument)
                    proxyConfig.bypassArgument?.let(::add)
                }
                if (disableSandbox) add("--no-sandbox")
            }.toTypedArray()

        try {
            KCEF.initBlocking(
                builder = {
                    progress {
                        var lastBucket = -1
                        onDownloading {
                            val bucket = (it.roundToInt() / 10) * 10
                            if (bucket != lastBucket) {
                                lastBucket = bucket
                                kcefEvents.info(
                                    "bridge.kcef.download_progress",
                                    "KCEF download progress",
                                    "progressPercent" to bucket,
                                )
                            }
                        }
                        onInitialized {
                            kcefEvents.info("bridge.kcef.context_initialized", "KCEF context initialized")
                        }
                    }
                    download { github() }
                    settings {
                        windowlessRenderingEnabled = true
                        cachePath = kcefCacheDir.toString()
                        persistSessionCookies = true
                        noSandbox = disableSandbox
                        logSeverity = LogSeverity.Default
                    }
                    appHandler(KCEF.AppHandler(kcefCommandLineArgs))
                    installDir(kcefBinDir.toFile())
                },
                onError = { error ->
                    initFailure.set(error)
                    kcefEvents.error("bridge.kcef.init_error", "KCEF initialization error", error)
                },
                onRestartRequired = {
                    kcefEvents.warn("bridge.kcef.restart_required", "KCEF restart required")
                },
            )
        } catch (e: Exception) {
            setKcefSnapshot(status = "error", initialized = false, lastError = e.message)
            kcefEvents.error("bridge.kcef.init_failed", "Failed to initialize KCEF", e)
            throw e
        }

        initFailure.get()?.let { failure ->
            setKcefSnapshot(status = "error", initialized = false, lastError = failure.message)
            throw IllegalStateException("KCEF initialization failed", failure)
        }

        // KCEF's runtime fast path can fall back to CefApp.getInstance() without carrying the
        // configured settings or app handler. Repair the still-new instance before JCEF's async
        // initialization consumes either. Both calls are also safe when KCEF supplied them.
        CefApp.getInstanceIfAny()
            ?.takeIf { CefApp.getState() == CefApp.CefAppState.NEW }
            ?.let { cefApp ->
                CefApp.addAppHandler(KCEF.AppHandler(kcefCommandLineArgs))
                cefApp.setSettings(cefSettings)
            }

        fun cefStartupFailure(): Throwable? {
            val startup =
                runCatching {
                    CefApp::class.java.getDeclaredField("ourStartupFeature").apply { isAccessible = true }.get(null)
                        as CompletableFuture<*>
                }.getOrNull() ?: return null
            if (!startup.isCompletedExceptionally) return null
            return runCatching { startup.join() }.exceptionOrNull()?.cause
        }

        val initializationDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60)
        var startupFailure = cefStartupFailure()
        while (
            CefApp.getState() in setOf(CefApp.CefAppState.NEW, CefApp.CefAppState.INITIALIZING) &&
            startupFailure == null &&
            System.nanoTime() < initializationDeadline
        ) {
            Thread.sleep(50)
            startupFailure = cefStartupFailure()
        }
        startupFailure?.let { failure ->
            setKcefSnapshot(status = "error", initialized = false, lastError = failure.message)
            kcefEvents.error("bridge.kcef.startup_failed", "JCEF startup failed", failure)
            throw IllegalStateException("KCEF initialization failed", failure)
        }
        val cefState = CefApp.getState()
        if (cefState != CefApp.CefAppState.INITIALIZED) {
            val failure = IllegalStateException("JCEF stopped in state $cefState")
            setKcefSnapshot(status = "error", initialized = false, lastError = failure.message)
            kcefEvents.error("bridge.kcef.init_incomplete", "KCEF initialization did not complete", failure)
            throw IllegalStateException("KCEF initialization did not complete", failure)
        }

        kcefEvents.info("bridge.kcef.initialized", "KCEF initialized successfully")
        logMissingNativeDeps(kcefBinDir)

        Runtime.getRuntime().addShutdownHook(
            Thread {
                runtimeContext.with("phase" to "shutdown", "subsystem" to "kcef").use {
                    try {
                        if (kcefInitialized) {
                            KCEF.disposeBlocking()
                        }
                    } catch (e: Exception) {
                        events.error("bridge.kcef.shutdown_failed", "Error shutting down KCEF", e)
                    }
                }
            },
        )

        kcefInitialized = true
        setKcefSnapshot(status = "ready", initialized = true)
        kcefEvents.info(
            "bridge.kcef.ready",
            "KCEF initialization complete",
            "installDir" to kcefBinDir,
            "cacheDir" to kcefCacheDir,
        )
    }

    @kotlinx.coroutines.DelicateCoroutinesApi
    private fun initializeAndroidCompat() {
        val androidEvents = events.withContext("subsystem" to "android_compat")
        androidEvents.info("bridge.android_compat.initializing", "Initializing Android compatibility layer")

        val app = App()
        startKoin {
            logger(KoinSlf4jLogger(Level.WARNING))
            modules(
                androidCompatModule(),
                module {
                    single<KcefWebViewProvider.InitBrowserHandler> {
                        object : KcefWebViewProvider.InitBrowserHandler {
                            override fun init(provider: KcefWebViewProvider) {
                                KcefCookieSync(Injekt.get<NetworkHelper>().cookieStore).loadIntoBrowser()
                            }
                        }
                    }
                },
            )
        }.apply {
            AndroidCompatInitializer().init()
            val androidCompat by lazy { AndroidCompat() }
            androidCompat.startApp(app)

            Injekt
                .get<NetworkHelper>()
                .userAgentFlow
                .onEach { System.setProperty("http.agent", it) }
                .launchIn(bridgeScope)
        }

        // Start Android main looper
        @Suppress("DEPRECATION")
        class LooperThread : Thread() {
            override fun run() {
                runtimeContext.with("subsystem" to "android_compat", "loopThread" to "android_main_looper").use {
                    events.info("bridge.android_compat.looper_started", "Android main looper started")
                }
                Looper.prepareMainLooper()
                Looper.loop()
            }
        }

        val looperThread = LooperThread()
        // looperThread.isDaemon = true
        looperThread.start()

        androidEvents.info("bridge.android_compat.ready", "Android compatibility layer initialized")
    }

    private fun isKcefEnabled(): Boolean =
        System.getenv("MANGARR_KCEF_ENABLED")
            ?.trim()
            ?.lowercase()
            ?.let { it == "1" || it == "true" || it == "yes" }
            ?: true
}
