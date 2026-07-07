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
	downloadedPages?: number;
	totalPages?: number;
	localRelativePath?: string | null;
	storageKind?: string | null;
	fileSizeBytes?: number | null;
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	let requestJson: {
		titleId?: string;
		cursor?: number;
		maxTitles?: number;
		repairMissing?: boolean;
	} = {};
	try {
		requestJson = (await event.request.json()) as {
			titleId?: string;
			cursor?: number;
			maxTitles?: number;
			repairMissing?: boolean;
		};
	} catch {
		throw error(400, 'Request body must be valid JSON');
	}
	const titleId = typeof requestJson.titleId === 'string' ? requestJson.titleId : null;
	const cursor =
		typeof requestJson.cursor === 'number' && Number.isFinite(requestJson.cursor) && requestJson.cursor >= 0
			? Math.floor(requestJson.cursor)
			: 0;
	const maxTitles =
		titleId !== null
			? 1
			: Math.min(
					25,
					Math.max(
						1,
						typeof requestJson.maxTitles === 'number' && Number.isFinite(requestJson.maxTitles)
							? Math.floor(requestJson.maxTitles)
							: 8
					)
				);
	const repairMissing = requestJson.repairMissing !== false;

	const client = await getUserConvexClient(user);
	const titles = (await client.query(convexApi.library.listReconcileDownloadTitles, {
		titleId: titleId ? (titleId as Id<'libraryTitles'>) : undefined
	})) as Array<{ titleId: Id<'libraryTitles'>; title: string; updatedAt: number }>;
	const batch = titleId !== null ? titles : titles.slice(cursor, cursor + maxTitles);

	const chapterSets = await Promise.all(
		batch.map((entry) =>
			client.query(convexApi.library.listAllMineChaptersForTitle, {
				titleId: entry.titleId
			}) as Promise<LibraryChapter[]>
		)
	);
	const scoped = chapterSets.flat();

	const startedAt = Date.now();
	const response = await fetch(new URL('downloads/reconcile', `${getBridgeBaseUrl()}/`), {
		method: 'POST',
		headers: buildBridgeInternalHeaders(
			{
				'content-type': 'application/json'
			},
			event.locals.requestId
		),
		body: JSON.stringify({
			repairMissing,
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
				downloadedPages: chapter.downloadedPages ?? 0,
				totalPages: chapter.totalPages ?? null,
				localRelativePath: chapter.localRelativePath ?? null,
				storageKind: chapter.storageKind ?? null,
				fileSizeBytes: chapter.fileSizeBytes ?? null
			}))
		}),
		signal: AbortSignal.timeout(30_000)
	}).catch(() => null);

	if (!response) {
		throw error(502, 'Bridge download reconcile is unavailable');
	}

	const payload = await response.json();
	return json(
		{
			...payload,
			nextCursor: titleId !== null || cursor + batch.length >= titles.length ? null : cursor + batch.length,
			totalTitles: titles.length,
			processedTitles: batch.length
		},
		{ status: response.status }
	);
};
