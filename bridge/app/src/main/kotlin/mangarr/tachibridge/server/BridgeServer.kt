package mangarr.tachibridge.server

import android.os.Looper
import dev.datlag.kcef.KCEF
import dev.datlag.kcef.KCEFBuilder.Settings.LogSeverity
import eu.kanade.tachiyomi.App
import eu.kanade.tachiyomi.network.NetworkHelper
import io.github.oshai.kotlinlogging.KotlinLogging
import io.grpc.Server
import io.grpc.netty.NettyServerBuilder
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import mangarr.tachibridge.config.ConfigManager
import mangarr.tachibridge.extensions.ExtensionBridgeService
import mangarr.tachibridge.extensions.ExtensionManager
import mangarr.tachibridge.loader.ConfigExtensionsDirectories
import mangarr.tachibridge.loader.ExtensionLoader
import mangarr.tachibridge.loader.PackageTools
import mangarr.tachibridge.repo.ExtensionRepoService
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
import kotlin.io.path.Path
import kotlin.io.path.createDirectories
import kotlin.math.roundToInt

data class ServerConfig(
    val dataDir: String,
    val port: Int,
)

private val logger = KotlinLogging.logger {}

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
    private lateinit var extensionService: ExtensionBridgeService
    private lateinit var server: Server

    @kotlinx.coroutines.DelicateCoroutinesApi
    fun start() =
        runBlocking {
            // Initialize config first
            ConfigManager.init(dataPath)

            // Ensure a writable temporary directory for CEF/Jogamp to use.
            // Some embedded OpenGL implementations (Jogamp) cannot infer an executable
            // temp directory when running on Android. Explicitly set the temp
            // directory to a subfolder of our data directory.
            val tmpDir = dataPath.resolve("tmp").also { it.createDirectories() }
            System.setProperty("java.io.tmpdir", tmpDir.toString())

            // Initialize FlareSolverr config provider
            mangarr.tachibridge.config.FlareSolverrConfigProvider.update(
                ConfigManager.config.flareSolverr,
            )

            // Initialize Android compatibility layer
            initializeAndroidCompat()

            // Initialize KCEF
            initializeKCEF()

            // Get network helper from Injekt
            networkHelper = Injekt.get()

            // Initialize repo service
            val initialRepoUrl = ConfigManager.config.repoUrl
            val json = Json { ignoreUnknownKeys = true }
            repoService = ExtensionRepoService(networkHelper, initialRepoUrl, json)

            // Initialize extension manager
            extensionManager =
                ExtensionManager(
                    extensionsDir = extensionsPath,
                    loader = extensionLoader,
                    repoService = repoService,
                    networkHelper = networkHelper,
                )

            // Initialize and sync extensions
            try {
                extensionManager.init()
            } catch (e: Exception) {
                logger.error(e) { "Failed to initialize extensions" }
            }

            // Create gRPC service
            extensionService = ExtensionBridgeService(extensionManager, repoService)

            // Build and start server
            server =
                NettyServerBuilder
                    .forPort(config.port)
                    .addService(extensionService)
                    .build()

            server.start()

            logger.info { "==================================================" }
            logger.info { "Bridge Server started on port ${config.port}" }
            logger.info { "Data directory: $dataPath" }
            logger.info { "Extensions directory: $extensionsPath" }
            logger.info { "Repository: ${ConfigManager.config.repoUrl.ifBlank { "(not configured)" }}" }
            logger.info { "Loaded sources: ${extensionManager.listSources().size}" }
            logger.info { "==================================================" }

            Runtime.getRuntime().addShutdownHook(
                Thread {
                    logger.info { "Shutting down gRPC server..." }
                    this@BridgeServer.stop()
                    logger.info { "Server stopped" }
                },
            )
        }

    private fun stop() =
        runBlocking {
            extensionManager.cleanup()
            server.shutdown()

            // Shutdown KCEF
            logger.info { "Shutting down KCEF..." }
            KCEF.disposeBlocking()
            logger.info { "KCEF shutdown complete" }
        }

    fun blockUntilShutdown() {
        server.awaitTermination()
    }

    @kotlinx.coroutines.DelicateCoroutinesApi
    private fun initializeKCEF() {
        logger.info { "Initializing KCEF (Chromium Embedded Framework)..." }
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

        val kcefLogger = KotlinLogging.logger("KCEF")

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
                kcefLogger.warn { "KCEF library not found under $installDir" }
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
                    kcefLogger.warn { "KCEF missing native deps:\n${missing.joinToString("\n")}" }
                } else {
                    kcefLogger.info { "KCEF native deps OK for ${existingLib.fileName}" }
                }
            } catch (e: Exception) {
                kcefLogger.debug(e) { "Skipping ldd dependency check" }
            }
        }

        try {
            KCEF.initBlocking(
                builder = {
                    progress {
                        var lastNum = -1
                        onDownloading {
                            val num = it.roundToInt()
                            if (num != lastNum) {
                                lastNum = num
                                logger.info { "KCEF download progress: $num" }
                            }
                        }
                        onInitialized {
                            kcefLogger.info { "KCEF initialized successfully" }
                            logMissingNativeDeps(kcefBinDir)
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
                    kcefLogger.error(error) { "KCEF initialization error" }
                },
                onRestartRequired = {
                    kcefLogger.warn { "KCEF restart required" }
                },
            )
        } catch (e: Exception) {
            kcefLogger.error(e) { "Failed to initialize KCEF" }
            throw e
        }

        // Add shutdown hook for KCEF
        Runtime.getRuntime().addShutdownHook(
            Thread {
                val kcefLogger = KotlinLogging.logger("KCEF")
                kcefLogger.debug { "Shutting down KCEF" }
                try {
                    KCEF.disposeBlocking()
                    kcefLogger.debug { "KCEF shutdown complete" }
                } catch (e: Exception) {
                    kcefLogger.error(e) { "Error shutting down KCEF" }
                }
            },
        )

        logger.info { "KCEF initialization complete" }
        logger.info { "KCEF install dir: $kcefBinDir" }
        logger.info { "KCEF cache dir: $kcefCacheDir" }
    }

    @kotlinx.coroutines.DelicateCoroutinesApi
    private fun initializeAndroidCompat() {
        logger.info { "Initializing Android compatibility layer..." }

        val app = App()
        startKoin {
            logger(KoinSlf4jLogger(Level.DEBUG))
            modules(androidCompatModule())
        }.apply {
            AndroidCompatInitializer().init()
            val androidCompat by lazy { AndroidCompat() }
            androidCompat.startApp(app)

            Injekt
                .get<NetworkHelper>()
                .userAgentFlow
                .onEach { System.setProperty("http.agent", it) }
                .launchIn(GlobalScope)
        }

        // Start Android main looper
        @Suppress("DEPRECATION")
        class LooperThread : Thread() {
            override fun run() {
                logger.debug { "Starting Android Main Looper" }
                Looper.prepareMainLooper()
                Looper.loop()
            }
        }

        val looperThread = LooperThread()
        // looperThread.isDaemon = true
        looperThread.start()

        logger.info { "Android compatibility layer initialized" }
    }
}
