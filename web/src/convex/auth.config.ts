import type { AuthConfig } from 'convex/server';

import {
	DEFAULT_CONVEX_AUTH_APPLICATION_ID,
	DEFAULT_CONVEX_AUTH_ISSUER,
	DEFAULT_KEY_ID,
	DEFAULT_PRIVATE_JWK
} from '../lib/server/convex-auth-config';

const publicJwk = {
	kty: 'EC',
	crv: 'P-256',
	x: DEFAULT_PRIVATE_JWK.x,
	y: DEFAULT_PRIVATE_JWK.y,
	alg: 'ES256',
	use: 'sig',
	kid: DEFAULT_KEY_ID
} as const;

const jwksPayload = JSON.stringify({ keys: [publicJwk] });
const jwks = `data:application/json,${encodeURIComponent(jwksPayload)}`;

export default {
	providers: [
		{
			type: 'customJwt',
			applicationID: DEFAULT_CONVEX_AUTH_APPLICATION_ID,
			issuer: DEFAULT_CONVEX_AUTH_ISSUER,
			algorithm: 'ES256',
			jwks
		}
	]
} satisfies AuthConfig;
