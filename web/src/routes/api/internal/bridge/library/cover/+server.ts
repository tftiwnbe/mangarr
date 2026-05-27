import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Id } from '$convex/_generated/dataModel';

import { proxyBridgeRequest } from '$lib/server/bridge-proxy';
import { requireUser } from '$lib/server/auth';
import { convexApi } from '$lib/server/convex-api';
import { getUserConvexClient } from '$lib/server/convex';

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const titleId = event.url.searchParams.get('titleId')?.trim();

	if (!titleId) {
		throw error(400, 'titleId is required');
	}

	const client = await getUserConvexClient(user);
	const title = await client.query(convexApi.library.getMineById, {
		titleId: titleId as Id<'libraryTitles'>
	});
	if (!title) {
		throw error(404, 'Title not found');
	}
	if (!title.localCoverPath) {
		if (title.coverUrl) {
			return Response.redirect(title.coverUrl, 307);
		}
		throw error(404, 'Library cover asset is unavailable');
	}

	const upstream = new URL('assets/library/cover', 'http://bridge.internal/');
	upstream.searchParams.set('path', title.localCoverPath);

	const response = await proxyBridgeRequest(
		event,
		`${upstream.pathname.slice(1)}?${upstream.searchParams.toString()}`,
		{
			requireAdmin: false,
			timeoutMs: 30000
		}
	);
	if (response.status !== 404) {
		return response;
	}

	await queueCoverRepair(client, titleId as Id<'libraryTitles'>);
	if (title.coverUrl) {
		return Response.redirect(title.coverUrl, 307);
	}

	return response;
};

async function queueCoverRepair(
	client: Awaited<ReturnType<typeof getUserConvexClient>>,
	titleId: Id<'libraryTitles'>
) {
	try {
		await client.mutation(convexApi.library.ensureTitleCoverCache, {
			titleId,
			force: true
		});
	} catch (cause) {
		console.warn('Failed to enqueue library cover cache repair', {
			titleId,
			error: cause instanceof Error ? cause.message : String(cause)
		});
	}
}
