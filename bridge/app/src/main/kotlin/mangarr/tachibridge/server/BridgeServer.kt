package mangarr.tachibridge.server

import android.os.Looper
import dev.datlag.kcef.KCEF
import dev.datlag.kcef.KCEFBuilder.Settings.LogSeverity
import eu.kanade.tachiyomi.App
import eu.kanade.tachiyomi.network.NetworkHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
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
import org.bouncycastle.jce.provider.BouncyCastleProvider
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
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
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
    private val bridgeScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val shutdownLatch = CountDownLatch(1)
    private var kcefInitialized = false
    private val runtimeContext =
        LogContext.of(
            "bridgeId" to config.runtime.bridgeId,
            "port" to config.runtime.port,
            "dataDir" to dataPath.toString(),
            "extensionsDir" to extensionsPath.toString(),
        )

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
                    bridgeClient = convexClient,
                    bridgeId = config.runtime.bridgeId,
                )
            bridgeState.setRunning()
            heartbeatReporter.start()
            commandRunner.start()
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
                events.info(
                    "bridge.warmup.started",
                    "Bridge warmup started",
                    "bridgeId" to config.runtime.bridgeId,
                    "phase" to "warmup",
                )
                try {
                    val warmupWarnings = mutableListOf<String>()
                    runCatching {
                        initializeKCEF()
                    }.onFailure { error ->
                        val message = error.message ?: "KCEF warmup failed"
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
                    bridgeState.setError(e.message ?: "Bridge warmup failed")
                    events.error(
                        "bridge.warmup.failed",
                        "Bridge warmup failed",
                        e,
                        "bridgeId" to config.runtime.bridgeId,
                        "phase" to "warmup",
                    )
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
            shutdownLatch.countDown()
        }

    fun blockUntilShutdown() {
        shutdownLatch.await()
    }

    @kotlinx.coroutines.DelicateCoroutinesApi
    private fun initializeKCEF() {
        val kcefEvents = events.withContext("subsystem" to "kcef")
        if (!isKcefEnabled()) {
            kcefEvents.info("bridge.kcef.disabled", "KCEF is disabled")
            return
        }
        kcefEvents.info("bridge.kcef.initializing", "Initializing KCEF")
        Security.addProvider(BouncyCastleProvider())

        val kcefInstallOverride =
            System.getenv("KCEF_INSTALL_DIR")
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
        val kcefBinDir =
            (kcefInstallOverride?.let { Path(it) } ?: dataPath.resolve("bin/kcef"))
                .toAbsolutePath()
                .normalize()
        val kcefCacheDir = dataPath.resolve("cache/kcef").toAbsolutePath().normalize()
        kcefBinDir.createDirectories()
        kcefCacheDir.createDirectories()

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

        val initSignal = CountDownLatch(1)
        val initialized = AtomicBoolean(false)
        var initFailure: Throwable? = null

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
                            initialized.set(true)
                            kcefEvents.info("bridge.kcef.initialized", "KCEF initialized successfully")
                            logMissingNativeDeps(kcefBinDir)
                            initSignal.countDown()
                        }
                    }
                    download { github() }
                    settings {
                        windowlessRenderingEnabled = true
                        cachePath = kcefCacheDir.toString()
                        logSeverity = LogSeverity.Default
                    }
                    appHandler(
                        KCEF.AppHandler(
                            arrayOf(
                                "--disable-gpu",
                                // #1486 needed to be able to render without a window
                                "--off-screen-rendering-enabled",
                                // #1489 since /dev/shm is restricted in docker (OOM)
                                "--disable-dev-shm-usage",
                                // #1723 support Widevine (incomplete)
                                "--enable-widevine-cdm",
                                // #1736 JCEF does implement stack guards properly
                                "--change-stack-guard-on-fork=disable",
                            ),
                        ),
                    )
                    installDir(kcefBinDir.toFile())
                },
                onError = { error ->
                    initFailure = error
                    kcefEvents.error("bridge.kcef.init_error", "KCEF initialization error", error)
                    initSignal.countDown()
                },
                onRestartRequired = {
                    kcefEvents.warn("bridge.kcef.restart_required", "KCEF restart required")
                },
            )
        } catch (e: Exception) {
            kcefEvents.error("bridge.kcef.init_failed", "Failed to initialize KCEF", e)
            throw e
        }

        if (!initSignal.await(15, TimeUnit.SECONDS)) {
            val failure = initFailure ?: IllegalStateException("KCEF did not finish initialization within 15 seconds")
            kcefEvents.error("bridge.kcef.init_incomplete", "KCEF initialization did not complete", failure)
            throw IllegalStateException("KCEF initialization did not complete", failure)
        }

        if (!initialized.get()) {
            val failure = initFailure ?: IllegalStateException("KCEF did not finish initialization")
            kcefEvents.error("bridge.kcef.init_incomplete", "KCEF initialization did not complete", failure)
            throw IllegalStateException("KCEF initialization did not complete", failure)
        }

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
            modules(androidCompatModule())
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
