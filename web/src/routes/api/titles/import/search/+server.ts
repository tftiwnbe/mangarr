import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { waitForCommand } from '$lib/client/commands';
import { convexApi } from '$lib/server/convex-api';
import { requireIntegrationApiUser } from '$lib/server/integration-auth';
import { mapSearchItem } from '$lib/server/integration-library';

export const POST: RequestHandler = async (event) => {
	const { client } = await requireIntegrationApiUser(event);

	let payload: Record<string, unknown>;
	try {
		payload = (await event.request.json()) as Record<string, unknown>;
	} catch {
		throw error(400, 'Request body must be valid JSON');
	}

	const query = typeof payload.query === 'string' ? payload.query : '';
	const sourceId =
		typeof payload.source_id === 'string'
			? payload.source_id.trim()
			: typeof payload.sourceId === 'string'
				? payload.sourceId.trim()
				: '';
	const limitRaw =
		typeof payload.limit === 'number'
			? payload.limit
			: typeof payload.limit === 'string'
				? Number(payload.limit)
				: 20;
	const limit = Math.max(1, Math.min(Math.floor(limitRaw), 100));
	const searchFilters =
		isRecord(payload.search_filters) || isRecord(payload.searchFilters)
			? ((payload.search_filters ?? payload.searchFilters) as Record<string, unknown>)
			: undefined;

	if (!query.trim() && !searchFilters) {
		throw error(400, 'Either query or search_filters is required');
	}

	const enqueued = await client.mutation(convexApi.commands.enqueue, {
		commandType: 'explore.search',
		payload: {
			sourceId,
			query,
			limit,
			...(searchFilters ? { searchFilters } : {})
		}
	});
	let completed;
	try {
		completed = await waitForCommand(client, enqueued.commandId, {
			timeoutMs: 30_000,
			pollIntervalMs: 300
		});
	} catch (cause) {
		const message =
			cause instanceof Error && cause.message.trim()
				? cause.message.trim()
				: 'Title import search failed';
		throw error(502, message);
	}
	const result = isRecord(completed.result) ? completed.result : null;
	const rawItems = Array.isArray(result?.items) ? result.items : [];

	return json({
		query,
		source_id: sourceId || null,
		limit,
		items: rawItems.filter(isRecord).map((item) => mapSearchItem(item)),
		command_id: String(completed.id ?? enqueued.commandId)
	});
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
