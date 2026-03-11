package mangarr.tachibridge.runtime

import com.nimbusds.jose.JOSEObjectType
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.crypto.ECDSASigner
import com.nimbusds.jose.jwk.ECKey
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import java.util.Date

class BridgeJwtSigner(
    private val auth: ConvexAuthRuntimeConfig,
    private val bridgeId: String,
) {
    @Volatile
    private var cachedToken: CachedToken? = null

    @Synchronized
    fun currentToken(): String {
        val nowSeconds = System.currentTimeMillis() / 1000
        val existing = cachedToken
        if (existing != null && existing.expiresAtSeconds - 30 > nowSeconds) {
            return existing.token
        }

        val token = mintToken(nowSeconds)
        cachedToken = token
        return token.token
    }

    private fun mintToken(nowSeconds: Long): CachedToken {
        val ecKey = ECKey.parse(auth.privateJwkJson)
        val claims =
            JWTClaimsSet.Builder()
                .issuer(auth.issuer)
                .audience(auth.applicationId)
                .subject("bridge:$bridgeId")
                .issueTime(Date(nowSeconds * 1000))
                .notBeforeTime(Date(nowSeconds * 1000))
                .expirationTime(Date((nowSeconds + auth.tokenTtlSeconds) * 1000))
                .claim("role", "bridge")
                .claim("service", "tachibridge")
                .claim("bridge_id", bridgeId)
                .build()
        val signedJwt =
            SignedJWT(
                JWSHeader
                    .Builder(JWSAlgorithm.ES256)
                    .type(JOSEObjectType.JWT)
                    .keyID(auth.keyId)
                    .build(),
                claims,
            )

        signedJwt.sign(ECDSASigner(ecKey))
        return CachedToken(token = signedJwt.serialize(), expiresAtSeconds = nowSeconds + auth.tokenTtlSeconds)
    }
}

private data class CachedToken(
    val token: String,
    val expiresAtSeconds: Long,
)
