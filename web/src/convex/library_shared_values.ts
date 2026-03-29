import { DOWNLOAD_STATUS } from './library_shared_access';

export function downloadChapterPercent(row: {
	downloadStatus: (typeof DOWNLOAD_STATUS)[keyof typeof DOWNLOAD_STATUS];
	downloadedPages: number;
	totalPages?: number;
}) {
	if (row.downloadStatus === DOWNLOAD_STATUS.DOWNLOADED) return 100;
	const downloadedPages = Number(row.downloadedPages ?? NaN);
	const totalPages = Number(row.totalPages ?? NaN);
	if (Number.isFinite(downloadedPages) && Number.isFinite(totalPages) && totalPages > 0) {
		return Math.max(0, Math.min(100, Math.round((downloadedPages / totalPages) * 100)));
	}

	return 0;
}

export function cleanExtensionLabel(name: string) {
	return name.replace(/^tachiyomi:\s*/i, '').trim();
}

export function humanizeSourcePkg(sourcePkg: string) {
	const segment = sourcePkg.split('.').filter(Boolean).at(-1) ?? sourcePkg;
	if (segment.toLowerCase() === 'mangadex') return 'MangaDex';
	return segment
		.replace(/[-_]+/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/\b\w/g, (value) => value.toUpperCase());
}

export function slugifyStatusKey(label: string, existingKeys: string[]) {
	const base =
		label
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '') || 'status';
	let candidate = base;
	let index = 2;
	while (existingKeys.includes(candidate)) {
		candidate = `${base}_${index}`;
		index += 1;
	}
	return candidate;
}

export function variantIdentityKey(sourceId: string, titleUrl: string) {
	return `${sourceId}::${titleUrl}`;
}

export function pickString(...values: Array<string | undefined | null>) {
	for (const value of values) {
		const normalized = value?.trim();
		if (normalized) {
			return normalized;
		}
	}
	return undefined;
}

export function pickNumber(...values: Array<number | undefined | null>) {
	for (const value of values) {
		if (value !== undefined && value !== null && Number.isFinite(value)) {
			return value;
		}
	}
	return undefined;
}

export function maxNumber(...values: Array<number | undefined | null>) {
	const finite = values.filter(
		(value): value is number => value !== undefined && value !== null && Number.isFinite(value)
	);
	if (finite.length === 0) {
		return undefined;
	}
	return Math.max(...finite);
}

export function preferredDownloadStatus(
	left: (typeof DOWNLOAD_STATUS)[keyof typeof DOWNLOAD_STATUS],
	right: (typeof DOWNLOAD_STATUS)[keyof typeof DOWNLOAD_STATUS]
) {
	const rank: Record<(typeof DOWNLOAD_STATUS)[keyof typeof DOWNLOAD_STATUS], number> = {
		[DOWNLOAD_STATUS.MISSING]: 0,
		[DOWNLOAD_STATUS.FAILED]: 1,
		[DOWNLOAD_STATUS.QUEUED]: 2,
		[DOWNLOAD_STATUS.DOWNLOADING]: 3,
		[DOWNLOAD_STATUS.DOWNLOADED]: 4
	};
	return rank[right] > rank[left] ? right : left;
}
