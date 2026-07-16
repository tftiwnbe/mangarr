package mangarr.tachibridge.webview

data class ExtensionWebViewLaunch(
    val packageName: String,
    val extensionName: String,
    val sourceId: Long,
    val sourceName: String,
    val initialUrl: String,
    val headers: Map<String, String>,
    val userAgent: String,
    val trustedHosts: Set<String>,
)
