import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { serializeUserProfile } from '$lib/server/auth';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.auth.user) {
		throw error(401, 'Not signed in');
	}

	return json(serializeUserProfile(locals.auth.user));
};
