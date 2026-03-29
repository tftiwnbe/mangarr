import type { AuthConfig } from 'convex/server';

import {
	DEFAULT_CONVEX_AUTH_APPLICATION_ID,
	DEFAULT_CONVEX_AUTH_ISSUER,
	DEFAULT_KEY_ID,
	DEVELOPMENT_PRIVATE_JWK
} from '../lib/server/convex-auth-config';

const rawPrivateJwk = process.env.MANGARR_CONVEX_AUTH_PRIVATE_JWK;
const runtimePrivateJwk = parsePrivateJwk(rawPrivateJwk);
const keyId = process.env.MANGARR_CONVEX_AUTH_KEY_ID || DEFAULT_KEY_ID;
const issuer = process.env.MANGARR_CONVEX_AUTH_ISSUER || DEFAULT_CONVEX_AUTH_ISSUER;
const applicationId =
	process.env.MANGARR_CONVEX_AUTH_APPLICATION_ID || DEFAULT_CONVEX_AUTH_APPLICATION_ID;

const publicJwk = {
	kty: 'EC',
	crv: 'P-256',
	x: runtimePrivateJwk.x,
	y: runtimePrivateJwk.y,
	alg: 'ES256',
	use: 'sig',
	kid: keyId
} as const;

const jwksPayload = JSON.stringify({ keys: [publicJwk] });
const jwks = `data:application/json,${encodeURIComponent(jwksPayload)}`;

export default {
	providers: [
		{
			type: 'customJwt',
			applicationID: applicationId,
			issuer,
			algorithm: 'ES256',
			jwks
		}
	]
} satisfies AuthConfig;

function parsePrivateJwk(value: string | undefined) {
	if (!value) {
		return DEVELOPMENT_PRIVATE_JWK;
	}

	try {
		const parsed = JSON.parse(value) as Partial<typeof DEVELOPMENT_PRIVATE_JWK>;
		if (typeof parsed.x === 'string' && typeof parsed.y === 'string') {
			return {
				kty: 'EC',
				crv: 'P-256',
				x: parsed.x,
				y: parsed.y
			};
		}
	} catch {
		// Fall back to the development key when the local auth env has not been seeded yet.
	}

	return DEVELOPMENT_PRIVATE_JWK;
}
