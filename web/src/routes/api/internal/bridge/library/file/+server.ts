import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Id } from '$convex/_generated/dataModel';

import { proxyBridgeRequest } from '$lib/server/bridge-proxy';
import { requireUser } from '$lib/server/auth';
import { convexApi } from '$lib/server/convex-api';
import { getUserConvexClient } from '$lib/server/convex';

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const chapterId = event.url.searchParams.get('chapterId')?.trim();

	if (!chapterId) {
		throw error(400, 'chapterId is required');
	}

	const client = await getUserConvexClient(user);
	const chapter = await client.query(convexApi.library.getMineChapterById, {
		chapterId: chapterId as Id<'libraryChapters'>
	});
	if (!chapter) {
		throw error(404, 'Chapter not found');
	}
	if (!chapter.localRelativePath) {
		throw error(404, 'Downloaded chapter file is unavailable');
	}

	const upstream = new URL('assets/library/chapter-file', 'http://bridge.internal/');
	upstream.searchParams.set('path', chapter.localRelativePath);

	return proxyBridgeRequest(
		event,
		`${upstream.pathname.slice(1)}?${upstream.searchParams.toString()}`,
		{
			requireAdmin: false,
			timeoutMs: 30000
		}
	);
};
