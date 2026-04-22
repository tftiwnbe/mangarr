import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { convexApi } from '$lib/server/convex-api';
import { requireAdminConvexClient } from '$lib/server/extensions-admin';

export const GET: RequestHandler = async (event) => {
	const { client } = await requireAdminConvexClient(event);

	const query = event.url.searchParams.get('query')?.trim() ?? '';
	const limitRaw = Number(event.url.searchParams.get('limit') ?? '5000');
	const limit = Number.isFinite(limitRaw)
		? Math.max(1, Math.min(Math.floor(limitRaw), 5000))
		: 5000;

	const enqueued = await client.mutation(convexApi.commands.enqueueRepositorySearch, {
		query,
		limit
	});

	return json(
		{
			accepted: true,
			commandId: enqueued.commandId
		},
		{ status: 202 }
	);
};
