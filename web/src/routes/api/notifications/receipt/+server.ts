import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { convexInternal } from '$lib/server/convex-api';
import { getConvexAdminClient } from '$lib/server/convex';

export const POST: RequestHandler = async ({ request }) => {
	let payload: { token?: unknown; phase?: unknown };
	try {
		payload = (await request.json()) as { token?: unknown; phase?: unknown };
	} catch {
		throw error(400, 'Request body must be valid JSON');
	}

	if (
		typeof payload.token !== 'string' ||
		payload.token.length < 16 ||
		payload.token.length > 256
	) {
		throw error(400, 'Invalid receipt token');
	}
	if (payload.phase !== 'received' && payload.phase !== 'displayed') {
		throw error(400, 'Invalid receipt phase');
	}

	const client = getConvexAdminClient();
	const result = await client.mutation(convexInternal.notifications.recordDeliveryReceipt, {
		token: payload.token,
		phase: payload.phase
	});
	return json(result, {
		headers: { 'cache-control': 'no-store' }
	});
};
