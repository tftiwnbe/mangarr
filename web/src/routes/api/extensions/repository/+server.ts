import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { convexApi } from '$lib/server/convex-api';
import { getConvexClient, getUserConvexClient } from '$lib/server/convex';
import { buildBridgeInternalHeaders, getBridgeBaseUrl } from '$lib/server/bridge';

type RepositoryState = {
	url?: string;
	configured?: boolean;
	languages?: string[];
	extensionCount?: number;
};

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
	const repository = (await client.query(
		convexApi.extensions.getRepository,
		{}
	)) as RepositoryState;
	const storedLanguages = Array.isArray(repository.languages) ? repository.languages : [];
	if (!repository.configured || storedLanguages.length > 0) {
		return json({
			...repository,
			languages: storedLanguages
		});
	}

	let startedAt = Date.now();
	try {
		startedAt = Date.now();
		const bridgeResponse = await fetch(`${getBridgeBaseUrl()}/extensions/repository`, {
			headers: buildBridgeInternalHeaders(undefined, locals.requestId),
			signal: AbortSignal.timeout(10_000)
		});
		if (!bridgeResponse.ok) {
			return json({
				...repository,
				languages: storedLanguages
			});
		}
		const bridgeRepository = (await bridgeResponse.json()) as RepositoryState;
		const bridgeLanguages = Array.isArray(bridgeRepository.languages)
			? bridgeRepository.languages
			: [];
		if (!locals.auth.user || bridgeLanguages.length === 0) {
			return json({
				...repository,
				languages: bridgeLanguages
			});
		}

		const userClient = await getUserConvexClient(locals.auth.user);
		await userClient.mutation(convexApi.extensions.backfillRepositoryLanguages, {
			url: bridgeRepository.url ?? repository.url ?? '',
			languages: bridgeLanguages,
			now: Date.now()
		});

		return json({
			url: bridgeRepository.url ?? repository.url ?? '',
			configured: bridgeRepository.configured ?? repository.configured ?? false,
			languages: bridgeLanguages,
			extensionCount: bridgeRepository.extensionCount
		});
	} catch (cause) {
		return json({
			...repository,
			languages: storedLanguages
		});
	}
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
	const sync = await client.mutation(convexApi.commands.enqueueRepositorySync, { url });
	return json(
		{
			accepted: true,
			syncCommandId: sync.commandId
		},
		{
			status: 202
		}
	);
};
