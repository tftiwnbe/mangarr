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
	localRelativePath?: string | null;
	storageKind?: string | null;
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = (await event.request.json().catch(() => ({}))) as { chapterId?: string };
	if (!body.chapterId) {
		throw error(400, 'chapterId is required');
	}

	const client = await getUserConvexClient(user);
	const chapters = ((await client.query(convexApi.library.listAllMineChapters, {})) ?? []) as LibraryChapter[];
	const chapter = chapters.find((item) => item._id === body.chapterId);
	if (!chapter) {
		throw error(404, 'Chapter not found');
	}

	const response = await fetch(new URL('downloads/delete', `${getBridgeBaseUrl()}/`), {
		method: 'POST',
		headers: buildBridgeInternalHeaders({
			'content-type': 'application/json'
		}),
		body: JSON.stringify({
			chapterId: chapter._id,
			titleId: chapter.libraryTitleId,
			chapterUrl: chapter.chapterUrl,
			localRelativePath: chapter.localRelativePath ?? null,
			storageKind: chapter.storageKind ?? null
		}),
		signal: AbortSignal.timeout(30_000)
	}).catch(() => null);

	if (!response) {
		throw error(502, 'Bridge download delete is unavailable');
	}

	return json(await response.json(), { status: response.status });
};
