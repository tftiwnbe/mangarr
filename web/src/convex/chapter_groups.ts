import type { GenericId } from 'convex/values';

import { DOWNLOAD_STATUS } from './library_shared_access';
import { preferredDownloadStatus } from './library_shared_values';

type DownloadStatus = (typeof DOWNLOAD_STATUS)[keyof typeof DOWNLOAD_STATUS];

type ChapterReleaseBase = {
	_id: GenericId<'libraryChapters'>;
	chapterName: string;
	chapterNumber?: number | null;
	scanlator?: string | null;
	dateUpload?: number | null;
	sequence: number;
	isAvailableFromSource?: boolean;
	downloadStatus: DownloadStatus;
	downloadedPages: number;
	totalPages?: number;
	localRelativePath?: string | null;
	fileSizeBytes?: number | null;
	lastErrorMessage?: string | null;
	downloadedAt?: number | null;
	updatedAt?: number | null;
	chapterGroupKey?: string | null;
};

export type GroupedChapterRelease<T extends ChapterReleaseBase> = T & {
	chapterGroupKey: string;
	releaseCount: number;
	activeReleaseCount: number;
	hasAlternateReleases: boolean;
	scanlators: string[];
	releaseIds: GenericId<'libraryChapters'>[];
	releases: T[];
};

function finiteNumber(value: number | null | undefined) {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeNumber(value: number | null | undefined) {
	const normalized = finiteNumber(value);
	if (normalized === null) return '';
	return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(3).replace(/\.?0+$/, '');
}

function normalizeString(value: string | null | undefined) {
	return (value ?? '')
		.normalize('NFKD')
		.replace(/\p{M}+/gu, '')
		.toLowerCase()
		.replace(/[\p{P}\p{S}]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function normalizeScanlatorName(scanlator: string | null | undefined) {
	return normalizeString(scanlator);
}

export function buildChapterGroupKey(args: {
	chapterName: string;
	chapterNumber?: number | null;
}) {
	const chapterNumberToken = normalizeNumber(args.chapterNumber);
	const normalizedName = normalizeString(args.chapterName);

	if (chapterNumberToken) {
		return `chapter:${chapterNumberToken}`;
	}

	return normalizedName ? `name:${normalizedName}` : 'name:chapter';
}

export function chapterGroupKeyForRow<T extends Pick<ChapterReleaseBase, 'chapterGroupKey' | 'chapterName' | 'chapterNumber'>>(
	chapter: T
) {
	return chapter.chapterGroupKey?.trim() || buildChapterGroupKey(chapter);
}

function compareNullableNumbers(left: number | null, right: number | null) {
	if (left === right) return 0;
	if (left === null) return 1;
	if (right === null) return -1;
	return left - right;
}

function compareReadingOrder<T extends Pick<ChapterReleaseBase, '_id' | 'chapterName' | 'chapterNumber' | 'dateUpload' | 'sequence'>>(
	left: T,
	right: T
) {
	const chapterNumberComparison = compareNullableNumbers(
		finiteNumber(left.chapterNumber),
		finiteNumber(right.chapterNumber)
	);
	if (chapterNumberComparison !== 0) return chapterNumberComparison;
	if (left.sequence !== right.sequence) return left.sequence - right.sequence;
	const dateUploadComparison = compareNullableNumbers(
		finiteNumber(left.dateUpload),
		finiteNumber(right.dateUpload)
	);
	if (dateUploadComparison !== 0) return dateUploadComparison;
	const nameComparison = (left.chapterName ?? '').localeCompare(right.chapterName ?? '');
	if (nameComparison !== 0) return nameComparison;
	return String(left._id).localeCompare(String(right._id));
}

function comparePreferredRelease<T extends ChapterReleaseBase>(left: T, right: T) {
	const localLeft = typeof left.localRelativePath === 'string' && left.localRelativePath.trim() ? 1 : 0;
	const localRight =
		typeof right.localRelativePath === 'string' && right.localRelativePath.trim() ? 1 : 0;
	if (localLeft !== localRight) return localRight - localLeft;

	const statusLeft =
		left.downloadStatus === DOWNLOAD_STATUS.DOWNLOADED
			? 4
			: left.downloadStatus === DOWNLOAD_STATUS.DOWNLOADING
				? 3
				: left.downloadStatus === DOWNLOAD_STATUS.QUEUED
					? 2
					: left.downloadStatus === DOWNLOAD_STATUS.FAILED
						? 1
						: 0;
	const statusRight =
		right.downloadStatus === DOWNLOAD_STATUS.DOWNLOADED
			? 4
			: right.downloadStatus === DOWNLOAD_STATUS.DOWNLOADING
				? 3
				: right.downloadStatus === DOWNLOAD_STATUS.QUEUED
					? 2
					: right.downloadStatus === DOWNLOAD_STATUS.FAILED
						? 1
						: 0;
	if (statusLeft !== statusRight) return statusRight - statusLeft;

	const availableLeft = left.isAvailableFromSource !== false ? 1 : 0;
	const availableRight = right.isAvailableFromSource !== false ? 1 : 0;
	if (availableLeft !== availableRight) return availableRight - availableLeft;

	const downloadTimeComparison = compareNullableNumbers(
		finiteNumber(right.downloadedAt) ?? finiteNumber(right.updatedAt),
		finiteNumber(left.downloadedAt) ?? finiteNumber(left.updatedAt)
	);
	if (downloadTimeComparison !== 0) return downloadTimeComparison;

	const dateUploadComparison = compareNullableNumbers(
		finiteNumber(right.dateUpload),
		finiteNumber(left.dateUpload)
	);
	if (dateUploadComparison !== 0) return dateUploadComparison;

	const scanlatorComparison = normalizeScanlatorName(left.scanlator).localeCompare(
		normalizeScanlatorName(right.scanlator)
	);
	if (scanlatorComparison !== 0) return scanlatorComparison;

	return compareReadingOrder(left, right);
}

export function selectPreferredChapterRelease<T extends ChapterReleaseBase>(releases: readonly T[]) {
	if (releases.length === 0) return null;
	return [...releases].sort(comparePreferredRelease)[0] ?? null;
}

export function collapseChapterReleases<T extends ChapterReleaseBase>(releases: readonly T[]) {
	const grouped = new Map<string, T[]>();
	for (const release of releases) {
		const groupKey = chapterGroupKeyForRow(release);
		const current = grouped.get(groupKey) ?? [];
		current.push(release);
		grouped.set(groupKey, current);
	}

	return [...grouped.entries()]
		.map(([groupKey, groupReleases]) => {
			const preferred = selectPreferredChapterRelease(groupReleases);
			if (!preferred) {
				return null;
			}
			const scanlators = [
				...new Set(
					groupReleases
						.map((release) => release.scanlator?.trim())
						.filter((scanlator): scanlator is string => Boolean(scanlator))
				)
			].sort((left, right) => left.localeCompare(right));
			return {
				...preferred,
				chapterGroupKey: groupKey,
				releaseCount: groupReleases.length,
				activeReleaseCount: groupReleases.filter((release) => release.isAvailableFromSource !== false)
					.length,
				hasAlternateReleases: groupReleases.length > 1,
				scanlators,
				releaseIds: groupReleases.map((release) => release._id),
				releases: [...groupReleases].sort(compareReadingOrder)
			} satisfies GroupedChapterRelease<T>;
		})
		.filter((chapter): chapter is GroupedChapterRelease<T> => chapter !== null)
		.sort(compareReadingOrder);
}

export function summarizeGroupedChapterStatuses<T extends ChapterReleaseBase>(
	releases: readonly T[]
) {
	const groups = collapseChapterReleases(releases).filter(
		(group) => group.releases.some((release) => release.isAvailableFromSource !== false)
	);

	let queued = 0;
	let downloading = 0;
	let downloaded = 0;
	let failed = 0;
	let downloadedBytes = 0;

	for (const group of groups) {
		let status: DownloadStatus = DOWNLOAD_STATUS.MISSING;
		let downloadedGroupBytes = 0;
		for (const release of group.releases) {
			status = preferredDownloadStatus(status, release.downloadStatus);
			if (release.downloadStatus === DOWNLOAD_STATUS.DOWNLOADED) {
				downloadedGroupBytes = Math.max(downloadedGroupBytes, release.fileSizeBytes ?? 0);
			}
		}
		switch (status) {
			case DOWNLOAD_STATUS.QUEUED:
				queued += 1;
				break;
			case DOWNLOAD_STATUS.DOWNLOADING:
				downloading += 1;
				break;
			case DOWNLOAD_STATUS.DOWNLOADED:
				downloaded += 1;
				downloadedBytes += downloadedGroupBytes;
				break;
			case DOWNLOAD_STATUS.FAILED:
				failed += 1;
				break;
		}
	}

	return {
		total: groups.length,
		queued,
		downloading,
		downloaded,
		failed,
		downloadedBytes
	};
}
