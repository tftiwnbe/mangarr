import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { GenericId } from 'convex/values';

import { convexApi } from '$lib/server/convex-api';
import { getConvexClient, getUserConvexClient } from '$lib/server/convex';

type CommandRow = {
	id: GenericId<'commands'>;
	status: string;
	result?: Record<string, unknown> | null;
	lastErrorMessage?: string | null;
};

async function waitForCommand(
	client: Awaited<ReturnType<typeof getUserConvexClient>>,
	commandId: GenericId<'commands'>,
	timeoutMs = 30_000
): Promise<CommandRow> {
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		const row = (await client.query(convexApi.commands.getMineById, {
			commandId
		})) as CommandRow | null;

		if (!row) {
			throw error(404, 'Queued command was not found');
		}

		if (row.status === 'succeeded') {
			return row;
		}

		if (row.status === 'failed' || row.status === 'dead_letter' || row.status === 'cancelled') {
			throw error(502, row.lastErrorMessage ?? 'Bridge command failed');
		}

		await new Promise((resolve) => setTimeout(resolve, 400));
	}

	throw error(504, 'Timed out while waiting for repository sync');
}

function requireAdmin(locals: App.Locals) {
	if (!locals.auth.user) {
		throw error(401, 'Not signed in');
	}
	if (!locals.auth.user.isAdmin) {
		throw error(403, 'Admin privileges are required');
	}
}

export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals);

	const client = getConvexClient();
	return json(await client.query(convexApi.extensions.getRepository, {}));
};

export const PUT: RequestHandler = async ({ locals, request }) => {
	requireAdmin(locals);
	const user = locals.auth.user;
	if (!user) {
		throw error(401, 'Not signed in');
	}

	let payload: { url?: string };
	try {
		payload = (await request.json()) as { url?: string };
	} catch {
		throw error(400, 'Request body must be valid JSON');
	}

	const url = String(payload.url ?? '').trim();
	if (!url) {
		throw error(400, 'Repository URL is required');
	}

	const client = await getUserConvexClient(user);
	const sync = await client.mutation(convexApi.commands.enqueue, {
		commandType: 'extensions.repo.sync',
		payload: { url }
	});
	await waitForCommand(client, sync.commandId);

	const search = await client.mutation(convexApi.commands.enqueue, {
		commandType: 'extensions.repo.search',
		payload: { query: '', limit: 100 }
	});
	const searchResult = await waitForCommand(client, search.commandId);

	return json((searchResult.result as { items?: unknown[] } | null)?.items ?? []);
};
