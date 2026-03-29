import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Id } from '$convex/_generated/dataModel';

import { buildBridgeInternalHeaders, getBridgeBaseUrl } from '$lib/server/bridge';
import { requireUser } from '$lib/server/auth';
import { convexApi } from '$lib/server/convex-api';
import { getUserConvexClient } from '$lib/server/convex';

type LibraryChapter = {
	_id: string;
	libraryTitleId: string;
	title: string;
	chapterUrl: string;
	chapterName: string;
	chapterNumber?: number | null;
	downloadStatus: string;
	sourceId: string;
	sourcePkg: string;
	sourceLang: string;
	localRelativePath?: string | null;
	storageKind?: string | null;
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const requestJson = (await event.request.json().catch(() => ({}))) as { titleId?: string };
	const titleId = typeof requestJson.titleId === 'string' ? requestJson.titleId : null;

	const client = await getUserConvexClient(user);
	const scoped = (
		titleId
			? await client.query(convexApi.library.listTitleChapters, {
					titleId: titleId as Id<'libraryTitles'>
				})
			: await client.query(convexApi.library.listAllMineChapters, {})
	) as LibraryChapter[];

	const response = await fetch(new URL('downloads/reconcile', `${getBridgeBaseUrl()}/`), {
		method: 'POST',
		headers: buildBridgeInternalHeaders({
			'content-type': 'application/json'
		}),
		body: JSON.stringify({
			chapters: scoped.map((chapter) => ({
				chapterId: chapter._id,
				titleId: chapter.libraryTitleId,
				titleName: chapter.title,
				sourceId: chapter.sourceId,
				sourcePkg: chapter.sourcePkg,
				sourceLang: chapter.sourceLang,
				chapterUrl: chapter.chapterUrl,
				chapterName: chapter.chapterName,
				chapterNumber: chapter.chapterNumber ?? null,
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
