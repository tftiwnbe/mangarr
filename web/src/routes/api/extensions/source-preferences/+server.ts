import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { waitForCommand } from '$lib/client/commands';
import { normalizePreferenceValue } from '$lib/extensions/source-preferences';
import { convexApi } from '$lib/server/convex-api';
import { commandFailure, requireAdminConvexClient } from '$lib/server/extensions-admin';

type SourcePreferenceEntry = {
	key: string;
	value: unknown;
};

export const GET: RequestHandler = async (event) => {
	const { client } = await requireAdminConvexClient(event);

	const sourceId = event.url.searchParams.get('sourceId')?.trim() ?? '';
	if (!sourceId) {
		throw error(400, 'sourceId is required');
	}

	const enqueued = await client.mutation(convexApi.commands.enqueueSourcePreferencesFetch, {
		sourceId
	});

	try {
		const completed = await waitForCommand(client, enqueued.commandId, {
			timeoutMs: 30_000,
			pollIntervalMs: 300
		});
		return json(completed.result ?? null);
	} catch (cause) {
		throw error(502, commandFailure(cause, 'Failed to load source preferences'));
	}
};

export const PUT: RequestHandler = async (event) => {
	const { client } = await requireAdminConvexClient(event);

	let payload: { sourceId?: string; entries?: SourcePreferenceEntry[] };
	try {
		payload = (await event.request.json()) as { sourceId?: string; entries?: SourcePreferenceEntry[] };
	} catch {
		throw error(400, 'Request body must be valid JSON');
	}

	const sourceId = String(payload.sourceId ?? '').trim();
	if (!sourceId) {
		throw error(400, 'sourceId is required');
	}

	const entries = Array.isArray(payload.entries) ? payload.entries : [];
	if (entries.some((entry) => !entry || typeof entry.key !== 'string')) {
		throw error(400, 'entries must be an array of { key, value } objects');
	}
	const normalizedEntries = entries.map((entry) => ({
		key: entry.key,
		value: normalizePreferenceValue(entry.key, entry.value)
	}));

	const enqueued = await client.mutation(convexApi.commands.enqueueSourcePreferencesSave, {
		sourceId,
		entries: normalizedEntries
	});

	try {
		await waitForCommand(client, enqueued.commandId, {
			timeoutMs: 30_000,
			pollIntervalMs: 300
		});
		return json({ ok: true });
	} catch (cause) {
		throw error(502, commandFailure(cause, 'Failed to save source preferences'));
	}
};
