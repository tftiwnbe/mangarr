import { importJWK, SignJWT, type JWK } from 'jose';
import type { AuthConfig } from 'convex/server';

type ConvexTokenUser = {
	id: string;
	username: string;
	isAdmin: boolean;
};

type SigningKeySet = {
	kid: string;
	privateJwk: JWK;
	publicJwk: JWK;
};

const DEFAULT_CONVEX_AUTH_ISSUER = 'https://auth.mangarr.local/convex';
const DEFAULT_CONVEX_AUTH_APPLICATION_ID = 'mangarr-web';
const DEFAULT_TOKEN_TTL_SECONDS = 5 * 60;
const DEFAULT_KEY_ID = 'mangarr-alpha-20260310';
const DEFAULT_PRIVATE_JWK = {
	kty: 'EC',
	crv: 'P-256',
	x: 'wQ_V3WF3zt9VDJAjCxSurV-qo9bDqjfE6j4_76Q8JkU',
	y: '8MDEofdMVTjhKLtpPUKWbgID5F8aJN17eNc5OXmNA5k',
	d: 'VpOZuu2eEPXIAEWRUtt1eSo13Ick2wOH8PWbrP4crz8'
} as const;

let cachedSigningKeySet: SigningKeySet | null = null;
let cachedPrivateKey: Promise<Awaited<ReturnType<typeof importJWK>>> | null = null;

export function getConvexAuthIssuer() {
	return DEFAULT_CONVEX_AUTH_ISSUER;
}

export function getConvexAuthApplicationId() {
	return DEFAULT_CONVEX_AUTH_APPLICATION_ID;
}

export function getConvexAuthTokenTtlSeconds() {
	return DEFAULT_TOKEN_TTL_SECONDS;
}

export function getConvexAuthConfig(): AuthConfig {
	const { publicJwk } = getSigningKeySet();
	const jwksPayload = JSON.stringify({ keys: [publicJwk] });
	const jwks = `data:application/json,${encodeURIComponent(jwksPayload)}`;

	return {
		providers: [
			{
				type: 'customJwt',
				applicationID: getConvexAuthApplicationId(),
				issuer: getConvexAuthIssuer(),
				algorithm: 'ES256',
				jwks
			}
		]
	};
}

export async function mintConvexAccessToken(user: ConvexTokenUser) {
	const nowSeconds = Math.floor(Date.now() / 1000);
	const expiresAtSeconds = nowSeconds + getConvexAuthTokenTtlSeconds();
	const { kid } = getSigningKeySet();

	const token = await new SignJWT({
		isAdmin: user.isAdmin,
		role: user.isAdmin ? 'admin' : 'user',
		username: user.username,
		preferred_username: user.username
	})
		.setProtectedHeader({
			alg: 'ES256',
			kid,
			typ: 'JWT'
		})
		.setIssuer(getConvexAuthIssuer())
		.setAudience(getConvexAuthApplicationId())
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

async function getPrivateSigningKey() {
	if (!cachedPrivateKey) {
		cachedPrivateKey = importJWK(getSigningKeySet().privateJwk, 'ES256');
	}

	return cachedPrivateKey;
}

function getSigningKeySet(): SigningKeySet {
	if (cachedSigningKeySet) {
		return cachedSigningKeySet;
	}

	const rawPrivateJwk = DEFAULT_PRIVATE_JWK;
	const kid = DEFAULT_KEY_ID;
	const publicJwk: JWK = {
		kty: 'EC',
		crv: 'P-256',
		x: rawPrivateJwk.x,
		y: rawPrivateJwk.y,
		alg: 'ES256',
		use: 'sig',
		kid
	};

	const privateJwk: JWK = {
		...publicJwk,
		d: rawPrivateJwk.d
	};

	cachedSigningKeySet = {
		kid,
		privateJwk,
		publicJwk
	};
	return cachedSigningKeySet;
}
