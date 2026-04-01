import type { GenericId } from 'convex/values';

import type { QueryCtx } from './_generated/server';
import {
	buildChapterRouteBase,
	buildTitleRouteBase,
	buildUniqueRouteSegmentMap
} from '../lib/utils/route-segments';
import { DOWNLOAD_STATUS } from './library_shared_access';

type ChapterOrderItem = {
	_id: GenericId<'libraryChapters'>;
	sequence: number;
	chapterNumber?: number | null;
	dateUpload?: number | null;
	chapterName?: string | null;
};

export function buildTitleRouteSegments<
	T extends { _id: GenericId<'libraryTitles'>; title: string }
>(titles: readonly T[]) {
	return buildUniqueRouteSegmentMap({
		items: titles,
		getId: (title) => String(title._id),
		getBase: (title) => buildTitleRouteBase(title.title)
	});
}

export function buildChapterRouteSegments<
	T extends {
		_id: GenericId<'libraryChapters'>;
		chapterName: string;
		chapterNumber?: number | null;
	}
>(chapters: readonly T[]) {
	return buildUniqueRouteSegmentMap({
		items: chapters,
		getId: (chapter) => String(chapter._id),
		getBase: (chapter) => buildChapterRouteBase(chapter.chapterName, chapter.chapterNumber ?? null)
	});
}

function compareNullableNumbers(left: number | null, right: number | null) {
	if (left === right) return 0;
	if (left === null) return 1;
	if (right === null) return -1;
	return left - right;
}

export function compareLibraryChaptersInReadingOrder<T extends ChapterOrderItem>(
	left: T,
	right: T
) {
	const chapterNumberComparison = compareNullableNumbers(
		typeof left.chapterNumber === 'number' && Number.isFinite(left.chapterNumber)
			? left.chapterNumber
			: null,
		typeof right.chapterNumber === 'number' && Number.isFinite(right.chapterNumber)
			? right.chapterNumber
			: null
	);
	if (chapterNumberComparison !== 0) return chapterNumberComparison;

	if (left.sequence !== right.sequence) {
		return left.sequence - right.sequence;
	}

	const dateUploadComparison = compareNullableNumbers(
		typeof left.dateUpload === 'number' && Number.isFinite(left.dateUpload) ? left.dateUpload : null,
		typeof right.dateUpload === 'number' && Number.isFinite(right.dateUpload)
			? right.dateUpload
			: null
	);
	if (dateUploadComparison !== 0) return dateUploadComparison;

	const nameComparison = (left.chapterName ?? '').localeCompare(right.chapterName ?? '');
	if (nameComparison !== 0) return nameComparison;

	return String(left._id).localeCompare(String(right._id));
}

export function sortLibraryChaptersInReadingOrder<T extends ChapterOrderItem>(chapters: readonly T[]) {
	return [...chapters].sort(compareLibraryChaptersInReadingOrder);
}

export async function findOwnedTitleByRouteSegment(
	ctx: QueryCtx,
	ownerUserId: GenericId<'users'>,
	routeSegment: string
) {
	const titles = await ctx.db
		.query('libraryTitles')
		.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
		.collect();
	const routeSegments = buildTitleRouteSegments(titles);
	return (
		titles.find(
			(title: (typeof titles)[number]) => routeSegments.get(String(title._id)) === routeSegment
		) ?? null
	);
}

export function summarizeDownloadStats(
	chapters: Array<{
		downloadStatus: (typeof DOWNLOAD_STATUS)[keyof typeof DOWNLOAD_STATUS];
	}>
) {
	let queued = 0;
	let downloading = 0;
	let downloaded = 0;
	let failed = 0;
	for (const chapter of chapters) {
		switch (chapter.downloadStatus) {
			case DOWNLOAD_STATUS.QUEUED:
				queued += 1;
				break;
			case DOWNLOAD_STATUS.DOWNLOADING:
				downloading += 1;
				break;
			case DOWNLOAD_STATUS.DOWNLOADED:
				downloaded += 1;
				break;
			case DOWNLOAD_STATUS.FAILED:
				failed += 1;
				break;
		}
	}

	return {
		total: chapters.length,
		queued,
		downloading,
		downloaded,
		failed
	};
}

export function isOfflineMetadataReady(title: {
	author?: string | null;
	artist?: string | null;
	description?: string | null;
	genre?: string | null;
	status?: number | null;
}) {
	const hasCreator =
		typeof title.author === 'string' && title.author.trim().length > 0
			? true
			: typeof title.artist === 'string' && title.artist.trim().length > 0;
	return (
		hasCreator &&
		typeof title.description === 'string' &&
		title.description.trim().length > 0 &&
		typeof title.genre === 'string' &&
		title.genre.trim().length > 0 &&
		Number(title.status ?? 0) > 0
	);
}

export function summarizeOfflineReadiness(
	title: {
		coverUrl?: string | null;
		localCoverPath?: string | null;
		author?: string | null;
		artist?: string | null;
		description?: string | null;
		genre?: string | null;
		status?: number | null;
	},
	chapters: Array<{
		downloadStatus: (typeof DOWNLOAD_STATUS)[keyof typeof DOWNLOAD_STATUS];
	}>
) {
	const downloadStats = summarizeDownloadStats(chapters);
	const metadataReady = isOfflineMetadataReady(title);
	const cachedCover =
		typeof title.localCoverPath === 'string' && title.localCoverPath.trim().length > 0;
	return {
		titlePageReady: metadataReady && downloadStats.total > 0,
		metadataReady,
		cachedCover,
		downloadedChapters: downloadStats.downloaded,
		totalChapters: downloadStats.total,
		fullyDownloaded: downloadStats.total > 0 && downloadStats.downloaded === downloadStats.total,
		missingCoverCache:
			!cachedCover && typeof title.coverUrl === 'string' && title.coverUrl.trim().length > 0
	};
}
