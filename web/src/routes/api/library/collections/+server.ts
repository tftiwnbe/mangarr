import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { convexApi } from '$lib/server/convex-api';
import { getUserConvexClient } from '$lib/server/convex';

function requireUser(locals: App.Locals) {
	const user = locals.auth.user;
	if (!user) {
		throw error(401, 'Not signed in');
	}
	return user;
}

export const GET: RequestHandler = async ({ locals }) => {
	const user = requireUser(locals);
	const client = await getUserConvexClient(user);
	await client.mutation(convexApi.library.ensureDefaultCollections, {});
	const collections = await client.query(convexApi.library.listCollections, {});
	return json({ items: collections });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);
	let payload: { name?: string };
	try {
		payload = (await request.json()) as { name?: string };
	} catch {
		throw error(400, 'Request body must be valid JSON');
	}

	const name = String(payload.name ?? '').trim();
	if (!name) {
		throw error(400, 'Collection name is required');
	}

	const client = await getUserConvexClient(user);
	const created = await client.mutation(convexApi.library.createCollection, { name });
	return json(created);
};
