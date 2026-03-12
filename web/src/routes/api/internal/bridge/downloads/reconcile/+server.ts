import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { buildBridgeInternalHeaders, getBridgeBaseUrl } from '$lib/server/bridge';
import { requireUser } from '$lib/server/auth';
import { convexApi } from '$lib/server/convex-api';
import { getUserConvexClient } from '$lib/server/convex';

type LibraryChapter = {
	_id: string;
	libraryTitleId: string;
	chapterUrl: string;
	downloadStatus: string;
	localRelativePath?: string | null;
	storageKind?: string | null;
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const requestJson = (await event.request.json().catch(() => ({}))) as { titleId?: string };
	const titleId = typeof requestJson.titleId === 'string' ? requestJson.titleId : null;

	const client = await getUserConvexClient(user);
	const chapters = ((await client.query(convexApi.library.listAllMineChapters, {})) ?? []) as LibraryChapter[];
	const scoped = titleId ? chapters.filter((chapter) => chapter.libraryTitleId === titleId) : chapters;

	const response = await fetch(new URL('downloads/reconcile', `${getBridgeBaseUrl()}/`), {
		method: 'POST',
		headers: buildBridgeInternalHeaders({
			'content-type': 'application/json'
		}),
		body: JSON.stringify({
			chapters: scoped.map((chapter) => ({
				chapterId: chapter._id,
				titleId: chapter.libraryTitleId,
				chapterUrl: chapter.chapterUrl,
				currentStatus: chapter.downloadStatus,
				localRelativePath: chapter.localRelativePath ?? null,
				storageKind: chapter.storageKind ?? null
			}))
		}),
		signal: AbortSignal.timeout(30_000)
	}).catch(() => null);

	if (!response) {
		throw error(502, 'Bridge download reconcile is unavailable');
	}

	return json(await response.json(), { status: response.status });
};
