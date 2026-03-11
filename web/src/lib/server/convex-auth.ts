import { importJWK, SignJWT } from 'jose';
import type { AuthConfig } from 'convex/server';

import { getConvexAuthRuntimeConfig } from './convex-auth-config';

type ConvexTokenUser = {
	id: string;
	username: string;
	isAdmin: boolean;
};

type BridgeServiceToken = {
	bridgeId: string;
};

let cachedPrivateKey: Promise<Awaited<ReturnType<typeof importJWK>>> | null = null;

export function getConvexAuthIssuer() {
	return getConvexAuthRuntimeConfig().issuer;
}

export function getConvexAuthApplicationId() {
	return getConvexAuthRuntimeConfig().applicationId;
}

export function getConvexAuthTokenTtlSeconds() {
	return getConvexAuthRuntimeConfig().tokenTtlSeconds;
}

export function getConvexAuthConfig(): AuthConfig {
	const { publicJwk, applicationId, issuer } = getConvexAuthRuntimeConfig();
	const jwksPayload = JSON.stringify({ keys: [publicJwk] });
	const jwks = `data:application/json,${encodeURIComponent(jwksPayload)}`;

	return {
		providers: [
			{
				type: 'customJwt',
				applicationID: applicationId,
				issuer,
				algorithm: 'ES256',
				jwks
			}
		]
	};
}

export async function mintConvexAccessToken(user: ConvexTokenUser) {
	const nowSeconds = Math.floor(Date.now() / 1000);
	const expiresAtSeconds = nowSeconds + getConvexAuthTokenTtlSeconds();
	const { keyId, applicationId, issuer } = getConvexAuthRuntimeConfig();

	const token = await new SignJWT({
		isAdmin: user.isAdmin,
		role: user.isAdmin ? 'admin' : 'user',
		username: user.username,
		preferred_username: user.username
	})
		.setProtectedHeader({
			alg: 'ES256',
			kid: keyId,
			typ: 'JWT'
		})
		.setIssuer(issuer)
		.setAudience(applicationId)
		.setSubject(user.id)
		.setIssuedAt(nowSeconds)
		.setNotBefore(nowSeconds)
		.setExpirationTime(expiresAtSeconds)
		.sign(await getPrivateSigningKey());

	return {
		token,
		expiresAt: expiresAtSeconds * 1000,
		issuedAt: nowSeconds * 1000
	};
}

export async function mintBridgeAccessToken(service: BridgeServiceToken) {
	const nowSeconds = Math.floor(Date.now() / 1000);
	const expiresAtSeconds = nowSeconds + getConvexAuthTokenTtlSeconds();
	const { keyId, applicationId, issuer } = getConvexAuthRuntimeConfig();

	const token = await new SignJWT({
		role: 'bridge',
		service: 'tachibridge',
		bridge_id: service.bridgeId
	})
		.setProtectedHeader({
			alg: 'ES256',
			kid: keyId,
			typ: 'JWT'
		})
		.setIssuer(issuer)
		.setAudience(applicationId)
		.setSubject(`bridge:${service.bridgeId}`)
		.setIssuedAt(nowSeconds)
		.setNotBefore(nowSeconds)
		.setExpirationTime(expiresAtSeconds)
		.sign(await getPrivateSigningKey());

	return {
		token,
		expiresAt: expiresAtSeconds * 1000,
		issuedAt: nowSeconds * 1000
	};
}

async function getPrivateSigningKey() {
	if (!cachedPrivateKey) {
		cachedPrivateKey = importJWK(getConvexAuthRuntimeConfig().privateJwk, 'ES256');
	}

	return cachedPrivateKey;
}
