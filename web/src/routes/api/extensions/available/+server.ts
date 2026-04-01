import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { waitForCommand } from '$lib/client/commands';
import { convexApi } from '$lib/server/convex-api';
import { commandFailure, requireAdminConvexClient } from '$lib/server/extensions-admin';

export const GET: RequestHandler = async (event) => {
	const { client } = await requireAdminConvexClient(event);

	const query = event.url.searchParams.get('query')?.trim() ?? '';
	const limitRaw = Number(event.url.searchParams.get('limit') ?? '5000');
	const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 5000)) : 5000;

	const enqueued = await client.mutation(convexApi.commands.enqueueRepositorySearch, {
		query,
		limit
	});

	try {
		const completed = await waitForCommand(client, enqueued.commandId, {
			timeoutMs: 30_000,
			pollIntervalMs: 300
		});
		const result = completed.result as { items?: unknown[] } | null;
		return json({
			ok: true,
			items: Array.isArray(result?.items) ? result.items : []
		});
	} catch (cause) {
		throw error(502, commandFailure(cause, 'Failed to load available extensions'));
	}
};
