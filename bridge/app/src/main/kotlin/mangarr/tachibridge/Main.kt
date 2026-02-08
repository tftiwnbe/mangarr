package mangarr.tachibridge

import mangarr.tachibridge.config.ConfigManager
import mangarr.tachibridge.server.BridgeServer
import mangarr.tachibridge.server.ServerConfig
import java.nio.file.Path
import java.nio.file.Paths

@kotlinx.coroutines.DelicateCoroutinesApi
@kotlinx.serialization.ExperimentalSerializationApi
fun main(args: Array<String>) {
    // --- Parse arguments ---
    val dataDir = getArgValue(args, "--data-dir") ?: "./data"
    val port = getArgValue(args, "--port")?.toIntOrNull() ?: 50051

    // --- Initialize global BridgeConfig ---
    val dataPath = resolveDataDir(dataDir)
    ConfigManager.init(dataPath)

    // --- Launch the server ---
    val server =
        BridgeServer(
            config = ServerConfig(dataPath.toString(), port),
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

private fun resolveDataDir(raw: String): Path {
    val trimmed = raw.trim()
    val home = System.getProperty("user.home") ?: ""
    val expanded =
        when {
            trimmed == "~" -> home
            trimmed.startsWith("~/") -> home + trimmed.removePrefix("~")
            else -> trimmed
        }
    return Paths.get(expanded).toAbsolutePath().normalize()
}
