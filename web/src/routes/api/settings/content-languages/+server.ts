import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { convexInternal } from '$lib/server/convex-api';
import { getConvexAdminClient } from '$lib/server/convex';

function requireSignedInUser(locals: App.Locals) {
	if (!locals.auth.user) {
		throw error(401, 'Not signed in');
	}
}

export const GET: RequestHandler = async ({ locals }) => {
	requireSignedInUser(locals);

	const client = getConvexAdminClient();
	return json(await client.query(convexInternal.settings.getContentLanguages, {}));
};

export const PUT: RequestHandler = async ({ locals, request }) => {
	requireSignedInUser(locals);

	let payload: { preferred?: string[] };
	try {
		payload = (await request.json()) as { preferred?: string[] };
	} catch {
		throw error(400, 'Request body must be valid JSON');
	}

	const preferred = Array.isArray(payload.preferred)
		? payload.preferred.filter((value): value is string => typeof value === 'string')
		: [];

	const client = getConvexAdminClient();
	return json(
		await client.mutation(convexInternal.settings.setContentLanguages, {
			preferred,
			now: Date.now()
		})
	);
};
