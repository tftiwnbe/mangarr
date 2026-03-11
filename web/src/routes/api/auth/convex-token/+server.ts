import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { mintConvexAccessToken } from '$lib/server/convex-auth';

export const POST: RequestHandler = async ({ locals, setHeaders }) => {
	const user = locals.auth.user;
	if (!user || !locals.auth.sessionToken) {
		throw error(401, 'Not authenticated');
	}

	const issued = await mintConvexAccessToken({
		id: user.id,
		username: user.username,
		isAdmin: user.isAdmin
	});

	setHeaders({
		'cache-control': 'no-store'
	});

	return json({
		token: issued.token,
		issued_at: new Date(issued.issuedAt).toISOString(),
		expires_at: new Date(issued.expiresAt).toISOString()
	});
};
