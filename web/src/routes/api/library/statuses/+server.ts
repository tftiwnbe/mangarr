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
	await client.mutation(convexApi.library.ensureDefaultUserStatuses, {});
	const statuses = await client.query(convexApi.library.listUserStatuses, {});
	return json({ items: statuses });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);
	let payload: { label?: string };
	try {
		payload = (await request.json()) as { label?: string };
	} catch {
		throw error(400, 'Request body must be valid JSON');
	}

	const label = String(payload.label ?? '').trim();
	if (!label) {
		throw error(400, 'Status label is required');
	}

	const client = await getUserConvexClient(user);
	const created = await client.mutation(convexApi.library.createUserStatus, { label });
	return json(created);
};
