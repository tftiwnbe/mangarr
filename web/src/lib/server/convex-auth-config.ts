import type { JWK } from 'jose';

export const DEFAULT_CONVEX_AUTH_ISSUER = 'https://auth.mangarr.local/convex';
export const DEFAULT_CONVEX_AUTH_APPLICATION_ID = 'mangarr-web';
export const DEFAULT_TOKEN_TTL_SECONDS = 5 * 60;
export const DEFAULT_KEY_ID = 'mangarr-20260310';
export const DEFAULT_PRIVATE_JWK = {
	kty: 'EC',
	crv: 'P-256',
	x: 'wQ_V3WF3zt9VDJAjCxSurV-qo9bDqjfE6j4_76Q8JkU',
	y: '8MDEofdMVTjhKLtpPUKWbgID5F8aJN17eNc5OXmNA5k',
	d: 'VpOZuu2eEPXIAEWRUtt1eSo13Ick2wOH8PWbrP4crz8'
} as const;

export type ConvexAuthRuntimeConfig = {
	issuer: string;
	applicationId: string;
	tokenTtlSeconds: number;
	keyId: string;
	privateJwk: JWK;
	publicJwk: JWK;
};

let cachedConfig: ConvexAuthRuntimeConfig | null = null;

export function getConvexAuthRuntimeConfig(): ConvexAuthRuntimeConfig {
	if (cachedConfig) {
		return cachedConfig;
	}

	const privateJwk = parsePrivateJwk();
	const keyId = DEFAULT_KEY_ID;
	const publicJwk: JWK = {
		kty: 'EC',
		crv: 'P-256',
		x: privateJwk.x,
		y: privateJwk.y,
		alg: 'ES256',
		use: 'sig',
		kid: keyId
	};

	cachedConfig = {
		issuer: DEFAULT_CONVEX_AUTH_ISSUER,
		applicationId: DEFAULT_CONVEX_AUTH_APPLICATION_ID,
		tokenTtlSeconds: DEFAULT_TOKEN_TTL_SECONDS,
		keyId,
		privateJwk: {
			...publicJwk,
			d: privateJwk.d
		},
		publicJwk
	};

	return cachedConfig;
}

function parsePrivateJwk(): JWK & { x: string; y: string; d: string } {
	return DEFAULT_PRIVATE_JWK;
}
