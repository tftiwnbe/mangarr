import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { waitForCommand } from '$lib/client/commands';
import { convexApi } from '$lib/server/convex-api';
import { commandFailure, requireAdminConvexClient } from '$lib/server/extensions-admin';

export const POST: RequestHandler = async (event) => {
	const { client } = await requireAdminConvexClient(event);

	let payload: { pkg?: string };
	try {
		payload = (await event.request.json()) as { pkg?: string };
	} catch {
		throw error(400, 'Request body must be valid JSON');
	}

	const pkg = String(payload.pkg ?? '').trim();
	if (!pkg) {
		throw error(400, 'Package name is required');
	}

	const enqueued = await client.mutation(convexApi.commands.enqueueExtensionInstall, { pkg });

	try {
		const completed = await waitForCommand(client, enqueued.commandId, {
			timeoutMs: 30_000,
			pollIntervalMs: 300
		});
		return json({
			ok: true,
			result: completed.result ?? null
		});
	} catch (cause) {
		throw error(502, commandFailure(cause, 'Failed to install extension'));
	}
};
