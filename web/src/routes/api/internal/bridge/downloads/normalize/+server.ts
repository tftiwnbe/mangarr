import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Id } from '$convex/_generated/dataModel';

import { buildBridgeInternalHeaders, getBridgeBaseUrl } from '$lib/server/bridge';
import { requireUser } from '$lib/server/auth';
import { convexApi } from '$lib/server/convex-api';
import { getUserConvexClient } from '$lib/server/convex';
import { collapseChapterReleases } from '$convex/chapter_groups';

type LibraryChapter = {
	_id: Id<'libraryChapters'>;
	libraryTitleId: Id<'libraryTitles'>;
	title?: string;
	titleUrl: string;
	chapterUrl: string;
	chapterName: string;
	chapterNumber?: number | null;
	downloadStatus: 'missing' | 'queued' | 'downloading' | 'downloaded' | 'failed';
	sourceId: string;
	sourcePkg: string;
	sourceLang: string;
	localRelativePath?: string | null;
	storageKind?: string | null;
	chapterGroupKey?: string | null;
	downloadedPages: number;
	totalPages?: number;
	scanlator?: string | null;
	dateUpload?: number | null;
	sequence: number;
	fileSizeBytes?: number | null;
	lastErrorMessage?: string | null;
	downloadedAt?: number | null;
	updatedAt?: number | null;
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = (await event.request.json().catch(() => ({}))) as {
		titleId?: string;
		dryRun?: boolean;
		cursor?: number;
		maxTitles?: number;
	};
	const titleId = typeof body.titleId === 'string' ? body.titleId : null;
	const dryRun = body.dryRun === true;
	const cursor =
		typeof body.cursor === 'number' && Number.isFinite(body.cursor) && body.cursor >= 0
			? Math.floor(body.cursor)
			: 0;
	const maxTitles =
		titleId !== null
			? 1
			: Math.min(
					25,
					Math.max(
						1,
						typeof body.maxTitles === 'number' && Number.isFinite(body.maxTitles)
							? Math.floor(body.maxTitles)
							: 8
					)
				);

	const client = await getUserConvexClient(user);
	let scanned = 0;
	let normalizeCandidates = 0;
	let pruneCandidates = 0;
	let normalized = 0;
	let pruned = 0;
	let conflicts = 0;
	let missing = 0;
	let fixed = 0;

	const titles = (await client.query(convexApi.library.listNormalizeDownloadTitles, {
		titleId: titleId ? (titleId as Id<'libraryTitles'>) : undefined
	})) as Array<{
		titleId: Id<'libraryTitles'>;
		storageTitleBase: string;
		downloadedChapterCount: number;
	}>;

	const batch = titleId !== null ? titles : titles.slice(cursor, cursor + maxTitles);
	const startedAt = Date.now();
	const processedTitleIds: Id<'libraryTitles'>[] = [];
	for (const title of batch) {
		processedTitleIds.push(title.titleId);
		const chapters = (await client.query(convexApi.library.listDownloadedMineChapters, {
			titleId: title.titleId,
			limit: 10_000
		})) as LibraryChapter[];
		scanned += chapters.length;
		const normalizeChapters: Array<LibraryChapter & { title: string }> = [];
		const pruneChapters: Array<LibraryChapter & { title: string }> = [];

		const buckets = new Map<string, LibraryChapter[]>();
		for (const chapter of chapters) {
			const key = `${chapter.libraryTitleId}::${chapter.sourceId}::${chapter.titleUrl}`;
			const current = buckets.get(key) ?? [];
			current.push(chapter);
			buckets.set(key, current);
		}

		for (const bucket of buckets.values()) {
			for (const group of collapseChapterReleases<LibraryChapter>(bucket)) {
				const downloaded = group.releases.filter(
					(release) =>
						release.downloadStatus === 'downloaded' &&
						typeof release.localRelativePath === 'string' &&
						release.localRelativePath.length > 0
				);
				if (downloaded.length === 0) {
					continue;
				}
				const primary = downloaded.find((release) => release._id === group._id) ?? downloaded[0]!;
				normalizeChapters.push({
					...primary,
					title: title.storageTitleBase
				});
				for (const alternate of downloaded) {
					if (alternate._id === primary._id) continue;
					pruneChapters.push({
						...alternate,
						title: title.storageTitleBase
					});
				}
			}
		}
		normalizeCandidates += normalizeChapters.length;
		pruneCandidates += pruneChapters.length;

		if (normalizeChapters.length === 0 && pruneChapters.length === 0) {
			continue;
		}

		const response = await fetch(new URL('downloads/normalize', `${getBridgeBaseUrl()}/`), {
			method: 'POST',
			headers: buildBridgeInternalHeaders(
				{
					'content-type': 'application/json'
				},
				event.locals.requestId
			),
			body: JSON.stringify({
				dryRun,
				normalizeChapters: normalizeChapters.map((chapter) => ({
					chapterId: chapter._id,
					titleId: chapter.libraryTitleId,
					titleName: chapter.title ?? String(chapter.libraryTitleId),
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
				})),
				pruneChapters: pruneChapters.map((chapter) => ({
					chapterId: chapter._id,
					titleId: chapter.libraryTitleId,
					titleName: chapter.title ?? String(chapter.libraryTitleId),
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
			signal: AbortSignal.timeout(120_000)
		}).catch(() => null);

		if (!response) {
			throw error(502, 'Bridge download normalize is unavailable');
		}
		if (!response.ok) {
			return json(await response.json(), { status: response.status });
		}
		const payload = (await response.json()) as {
			ok?: boolean;
			normalized?: number;
			pruned?: number;
			conflicts?: number;
			missing?: number;
			fixed?: number;
		};
		normalized += payload.normalized ?? 0;
		pruned += payload.pruned ?? 0;
		conflicts += payload.conflicts ?? 0;
		missing += payload.missing ?? 0;
		fixed += payload.fixed ?? 0;
	}

	if (processedTitleIds.length > 0) {
		await client.mutation(convexApi.library.refreshMyTitleStats, {
			titleIds: processedTitleIds
		});
	}

	return json({
		ok: true,
		dryRun,
		normalized,
		pruned,
		conflicts,
		missing,
		fixed,
		scanned,
		normalizeCandidates,
		pruneCandidates,
		nextCursor: titleId !== null || cursor + batch.length >= titles.length ? null : cursor + batch.length,
		totalTitles: titles.length,
		processedTitles: batch.length
	});
};
