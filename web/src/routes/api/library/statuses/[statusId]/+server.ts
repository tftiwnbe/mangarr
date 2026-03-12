import { error, json } from '@sveltejs/kit';
import type { GenericId } from 'convex/values';
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

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	const user = requireUser(locals);
	let payload: { label?: string; position?: number };
	try {
		payload = (await request.json()) as { label?: string; position?: number };
	} catch {
		throw error(400, 'Request body must be valid JSON');
	}

	const label = String(payload.label ?? '').trim();
	if (!label) {
		throw error(400, 'Status label is required');
	}

	const client = await getUserConvexClient(user);
	const updated = await client.mutation(convexApi.library.updateUserStatus, {
		statusId: params.statusId as GenericId<'libraryUserStatuses'>,
		label,
		position: typeof payload.position === 'number' ? payload.position : undefined
	});
	return json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const user = requireUser(locals);
	const client = await getUserConvexClient(user);
	const result = await client.mutation(convexApi.library.deleteUserStatus, {
		statusId: params.statusId as GenericId<'libraryUserStatuses'>
	});
	return json(result);
};
