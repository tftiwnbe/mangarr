package mangarr.tachibridge.runtime

private const val DEFAULT_CONVEX_AUTH_ISSUER = "https://auth.mangarr.local/convex"
private const val DEFAULT_CONVEX_AUTH_APPLICATION_ID = "mangarr-web"
private const val DEFAULT_CONVEX_AUTH_KEY_ID = "mangarr-20260310"
private const val DEFAULT_CONVEX_AUTH_TOKEN_TTL_SECONDS = 300L
private const val DEFAULT_CONVEX_AUTH_PRIVATE_JWK =
    """{"kty":"EC","crv":"P-256","x":"wQ_V3WF3zt9VDJAjCxSurV-qo9bDqjfE6j4_76Q8JkU","y":"8MDEofdMVTjhKLtpPUKWbgID5F8aJN17eNc5OXmNA5k","d":"VpOZuu2eEPXIAEWRUtt1eSo13Ick2wOH8PWbrP4crz8"}"""

data class ConvexAuthRuntimeConfig(
    val issuer: String,
    val applicationId: String,
    val keyId: String,
    val privateJwkJson: String,
    val tokenTtlSeconds: Long,
)

data class BridgeRuntimeConfig(
    val host: String,
    val port: Int,
    val bridgeId: String,
    val convexUrl: String,
    val convexAuth: ConvexAuthRuntimeConfig,
    val serviceSecret: String,
    val heartbeatIntervalMs: Long,
    val commandPollIntervalMs: Long,
    val commandLeaseDurationMs: Long,
)

fun loadBridgeRuntimeConfig(defaultPort: Int): BridgeRuntimeConfig =
    BridgeRuntimeConfig(
        host = System.getenv("MANGARR_BRIDGE_HOST")?.ifBlank { null } ?: "127.0.0.1",
        port = System.getenv("MANGARR_BRIDGE_PORT")?.toIntOrNull() ?: defaultPort,
        bridgeId = System.getenv("MANGARR_BRIDGE_ID")?.ifBlank { null } ?: "main",
        convexUrl =
            System.getenv("CONVEX_URL")
                ?.ifBlank { null }
                ?: System.getenv("CONVEX_SELF_HOSTED_URL")?.ifBlank { null }
                ?: "",
        convexAuth =
            ConvexAuthRuntimeConfig(
                issuer =
                    System.getenv("MANGARR_CONVEX_AUTH_ISSUER")
                        ?.ifBlank { null }
                        ?: DEFAULT_CONVEX_AUTH_ISSUER,
                applicationId =
                    System.getenv("MANGARR_CONVEX_AUTH_APPLICATION_ID")
                        ?.ifBlank { null }
                        ?: DEFAULT_CONVEX_AUTH_APPLICATION_ID,
                keyId =
                    System.getenv("MANGARR_CONVEX_AUTH_KEY_ID")
                        ?.ifBlank { null }
                        ?: DEFAULT_CONVEX_AUTH_KEY_ID,
                privateJwkJson =
                    System.getenv("MANGARR_CONVEX_AUTH_PRIVATE_JWK")
                        ?.ifBlank { null }
                        ?: DEFAULT_CONVEX_AUTH_PRIVATE_JWK,
                tokenTtlSeconds =
                    System.getenv("MANGARR_CONVEX_AUTH_TOKEN_TTL_SECONDS")
                        ?.toLongOrNull()
                        ?.takeIf { it > 0 }
                        ?: DEFAULT_CONVEX_AUTH_TOKEN_TTL_SECONDS,
            ),
        serviceSecret =
            System.getenv("MANGARR_SERVICE_SECRET")
                ?.ifBlank { null }
                ?: System.getenv("MANGARR_BRIDGE_INTERNAL_SECRET")?.ifBlank { null }
                ?: "",
        heartbeatIntervalMs = System.getenv("MANGARR_BRIDGE_HEARTBEAT_INTERVAL_MS")?.toLongOrNull() ?: 15_000L,
        commandPollIntervalMs = System.getenv("MANGARR_BRIDGE_COMMAND_POLL_INTERVAL_MS")?.toLongOrNull() ?: 2_000L,
        commandLeaseDurationMs = System.getenv("MANGARR_BRIDGE_COMMAND_LEASE_DURATION_MS")?.toLongOrNull() ?: 30_000L,
    )
