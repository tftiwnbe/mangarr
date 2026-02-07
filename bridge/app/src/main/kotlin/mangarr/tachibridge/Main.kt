package mangarr.tachibridge

import mangarr.tachibridge.config.ConfigManager
import mangarr.tachibridge.server.BridgeServer
import mangarr.tachibridge.server.ServerConfig
import java.nio.file.Paths

@kotlinx.coroutines.DelicateCoroutinesApi
@kotlinx.serialization.ExperimentalSerializationApi
fun main(args: Array<String>) {
    // --- Parse arguments ---
    val dataDir = getArgValue(args, "--data-dir") ?: "./data"
    val port = getArgValue(args, "--port")?.toIntOrNull() ?: 50051

    // --- Initialize global BridgeConfig ---
    val dataPath = Paths.get(dataDir)
    ConfigManager.init(dataPath)

    // --- Launch the server ---
    val server =
        BridgeServer(
            config = ServerConfig(dataDir, port),
        )
    server.start()
    server.blockUntilShutdown()
}

fun getArgValue(
    args: Array<String>,
    key: String,
): String? {
    val index = args.indexOf(key)
    return if (index != -1 && index + 1 < args.size) args[index + 1] else null
}
