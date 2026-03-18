import { env as privateEnv } from '$env/dynamic/private';

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
	const keyId = privateEnv.MANGARR_CONVEX_AUTH_KEY_ID || DEFAULT_KEY_ID;
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
		issuer: privateEnv.MANGARR_CONVEX_AUTH_ISSUER || DEFAULT_CONVEX_AUTH_ISSUER,
		applicationId: privateEnv.MANGARR_CONVEX_AUTH_APPLICATION_ID || DEFAULT_CONVEX_AUTH_APPLICATION_ID,
		tokenTtlSeconds: parseTokenTtlSeconds(),
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
	const value = privateEnv.MANGARR_CONVEX_AUTH_PRIVATE_JWK;
	if (!value) {
		return DEFAULT_PRIVATE_JWK;
	}

	try {
		const parsed = JSON.parse(value) as Partial<JWK> & { x?: string; y?: string; d?: string };
		if (typeof parsed.x === 'string' && typeof parsed.y === 'string' && typeof parsed.d === 'string') {
			return {
				...parsed,
				kty: 'EC',
				crv: 'P-256',
				x: parsed.x,
				y: parsed.y,
				d: parsed.d
			};
		}
	} catch {
		// Fall back to the baked-in development key below.
	}

	return DEFAULT_PRIVATE_JWK;
}

function parseTokenTtlSeconds() {
	const value = Number.parseInt(privateEnv.MANGARR_CONVEX_AUTH_TOKEN_TTL_SECONDS || '', 10);
	return Number.isFinite(value) && value > 0 ? value : DEFAULT_TOKEN_TTL_SECONDS;
}
