import type { JWK } from 'jose';

export const DEFAULT_CONVEX_AUTH_ISSUER = 'https://auth.mangarr.local/convex';
export const DEFAULT_CONVEX_AUTH_APPLICATION_ID = 'mangarr-web';
export const DEFAULT_TOKEN_TTL_SECONDS = 5 * 60;
export const DEFAULT_KEY_ID = 'mangarr-20260310';
export const DEVELOPMENT_PRIVATE_JWK = {
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

	const privateJwk = parsePrivateJwk(process.env.MANGARR_CONVEX_AUTH_PRIVATE_JWK);
	const keyId = process.env.MANGARR_CONVEX_AUTH_KEY_ID || DEFAULT_KEY_ID;
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

	return cachedConfig;
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
