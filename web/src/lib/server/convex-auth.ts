import { importJWK, SignJWT } from 'jose';
import type { AuthConfig } from 'convex/server';

import {
	DEFAULT_CONVEX_AUTH_APPLICATION_ID,
	DEFAULT_CONVEX_AUTH_ISSUER,
	DEFAULT_KEY_ID,
	DEFAULT_TOKEN_TTL_SECONDS,
	DEVELOPMENT_PRIVATE_JWK,
	type ConvexAuthRuntimeConfig
} from './convex-auth-config';

type ConvexTokenUser = {
	id: string;
	username: string;
	isAdmin: boolean;
};

type BridgeServiceToken = {
	bridgeId: string;
};

let cachedPrivateKey: Promise<Awaited<ReturnType<typeof importJWK>>> | null = null;
let cachedRuntimeConfig: ConvexAuthRuntimeConfig | null = null;

export function getConvexAuthIssuer() {
	return getServerConvexAuthRuntimeConfig().issuer;
}

export function getConvexAuthApplicationId() {
	return getServerConvexAuthRuntimeConfig().applicationId;
}

export function getConvexAuthTokenTtlSeconds() {
	return getServerConvexAuthRuntimeConfig().tokenTtlSeconds;
}

export function getConvexAuthConfig(): AuthConfig {
	const { publicJwk, applicationId, issuer } = getServerConvexAuthRuntimeConfig();
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
	const { keyId, applicationId, issuer } = getServerConvexAuthRuntimeConfig();

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
	const { keyId, applicationId, issuer } = getServerConvexAuthRuntimeConfig();

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
		cachedPrivateKey = importJWK(getServerConvexAuthRuntimeConfig().privateJwk, 'ES256');
	}

	return cachedPrivateKey;
}

function getServerConvexAuthRuntimeConfig(): ConvexAuthRuntimeConfig {
	if (cachedRuntimeConfig) {
		return cachedRuntimeConfig;
	}

	const privateJwk = parsePrivateJwk(process.env.MANGARR_CONVEX_AUTH_PRIVATE_JWK);
	const keyId = process.env.MANGARR_CONVEX_AUTH_KEY_ID || DEFAULT_KEY_ID;
	const publicJwk = {
		kty: 'EC',
		crv: 'P-256',
		x: privateJwk.x,
		y: privateJwk.y,
		alg: 'ES256',
		use: 'sig',
		kid: keyId
	} as const;

	cachedRuntimeConfig = {
		issuer: process.env.MANGARR_CONVEX_AUTH_ISSUER || DEFAULT_CONVEX_AUTH_ISSUER,
		applicationId:
			process.env.MANGARR_CONVEX_AUTH_APPLICATION_ID || DEFAULT_CONVEX_AUTH_APPLICATION_ID,
		tokenTtlSeconds: parseTokenTtlSeconds(process.env.MANGARR_CONVEX_AUTH_TOKEN_TTL_SECONDS),
		keyId,
		privateJwk: {
			...publicJwk,
			d: privateJwk.d
		},
		publicJwk
	};

	return cachedRuntimeConfig;
}

function parsePrivateJwk(value: string | undefined) {
	if (!value) {
		return isProductionLike() ? failMissingPrivateJwk() : DEVELOPMENT_PRIVATE_JWK;
	}

	try {
		const parsed = JSON.parse(value) as Partial<typeof DEVELOPMENT_PRIVATE_JWK>;
		if (
			typeof parsed.x === 'string' &&
			typeof parsed.y === 'string' &&
			typeof parsed.d === 'string'
		) {
			return {
				kty: 'EC',
				crv: 'P-256',
				x: parsed.x,
				y: parsed.y,
				d: parsed.d
			};
		}
	} catch {
		if (isProductionLike()) {
			failMissingPrivateJwk();
		}
	}

	return DEVELOPMENT_PRIVATE_JWK;
}

function parseTokenTtlSeconds(value: string | undefined) {
	const parsed = Number.parseInt(value || '', 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOKEN_TTL_SECONDS;
}

function isProductionLike() {
	const mode = (process.env.NODE_ENV || process.env.MANGARR_APP_MODE || '').toLowerCase();
	return mode === 'production' || mode === 'prod';
}

function failMissingPrivateJwk(): never {
	throw new Error('MANGARR_CONVEX_AUTH_PRIVATE_JWK must be configured for production runtime');
}
