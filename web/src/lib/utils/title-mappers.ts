import type {
	LibraryChapterResource,
	LibraryTitleResource,
	LibraryTitleSummary
} from '$lib/api/library';
import { getCachedCoverUrl } from '$lib/api/covers';
import type { components } from '$lib/api/v2';
import { buildTitlePath, inferChapterNumber } from '$lib/utils/routes';
import { TITLE_STATUS } from '$lib/utils/title-status';

export type TitleStatus = 'ongoing' | 'completed' | 'hiatus';

export interface TitleCardItem {
	id: string;
	title: string;
	cover: string;
	author?: string;
	artist?: string;
	description?: string;
	genres?: string[];
	status?: TitleStatus;
	chapters?: number;
	href?: string;
	external?: boolean;
	userRating?: number;
	userStatusLabel?: string;
	userStatusColor?: string;
}

interface TitleDetailBase {
	id: string;
	title: string;
	cover: string;
	author?: string;
	artist?: string;
	description?: string;
	genres?: string[];
	status?: TitleStatus;
	href?: string;
	external?: boolean;
}

interface TitleVariantItem {
	id: number;
	sourceId: string;
	sourceName?: string;
	sourceLang?: string;
	titleUrl: string;
	title: string;
	description?: string;
	artist?: string;
	author?: string;
	genre?: string;
	status?: TitleStatus;
	cover?: string;
	availability?: {
		state: VariantAvailabilityState;
		chapterCount: number;
		startsFromChapterOne: boolean;
		hasMajorGaps: boolean;
		firstChapterNumber?: number;
		lastChapterNumber?: number;
		globalLastChapterNumber?: number;
	};
}

type VariantAvailabilityState = 'full' | 'behind' | 'partial' | 'unknown';

function normalizeVariantAvailabilityState(
	value: string | null | undefined
): VariantAvailabilityState {
	if (value === 'full' || value === 'behind' || value === 'partial' || value === 'unknown') {
		return value;
	}
	return 'unknown';
}

export interface TitleCollectionItem {
	id: number;
	name: string;
	color: string;
}

export interface TitleUserStatusItem {
	id: number;
	key: string;
	label: string;
	color: string;
	position: number;
	isDefault: boolean;
}

export interface TitleChapterItem {
	id: number;
	chapterUrl: string;
	number: number | null;
	title: string;
	uploadDate: string;
	scanlator?: string;
	isRead: boolean;
	isDownloaded: boolean;
	downloadError?: string;
}

export interface TitleDetailItem extends TitleDetailBase {
	libraryId: number;
	variants: TitleVariantItem[];
	preferredVariantId?: number;
	chapters: TitleChapterItem[];
	/** Set when the chapters request failed; chapters will be empty. */
	chaptersError?: string;
	userStatus?: TitleUserStatusItem;
	userRating?: number;
	collections: TitleCollectionItem[];
	updatesEnabled: boolean;
	watchedVariantIds: number[];
}

type ExploreItem = components['schemas']['ExploreItem'];

function normalizeCover(url: string | null | undefined): string {
	return getCachedCoverUrl(url);
}

function normalizeStatus(status: number): TitleStatus | undefined {
	switch (status) {
		case TITLE_STATUS.ONGOING:
			return 'ongoing';
		case TITLE_STATUS.COMPLETED:
		case TITLE_STATUS.COMPLETED_ALT:
			return 'completed';
		case TITLE_STATUS.HIATUS:
			return 'hiatus';
		default:
			return undefined;
	}
}

function splitGenres(genre: string | null | undefined): string[] {
	if (!genre) {
		return [];
	}
	return genre
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function exploreHref(item: ExploreItem): { href?: string; external?: boolean } {
	if (item.imported_library_id) {
		return {
			href: buildTitlePath(item.imported_library_id, item.title),
			external: false
		};
	}
	const href = item.links[0]?.title_url;
	if (!href) {
		return {};
	}
	return {
		href,
		external: /^https?:\/\//i.test(href)
	};
}

export function mapExploreItemToTitleCard(item: ExploreItem): TitleCardItem {
	const { href, external } = exploreHref(item);
	return {
		id: item.imported_library_id ? String(item.imported_library_id) : item.dedupe_key,
		title: item.title,
		cover: normalizeCover(item.thumbnail_url),
		author: item.author ?? undefined,
		artist: item.artist ?? undefined,
		description: item.description ?? undefined,
		genres: splitGenres(item.genre),
		status: normalizeStatus(item.status),
		href,
		external
	};
}

export function mapLibrarySummaryToTitleCard(item: LibraryTitleSummary): TitleCardItem {
	return {
		id: String(item.id),
		title: item.title,
		cover: normalizeCover(item.thumbnail_url),
		status: normalizeStatus(item.status),
		userRating: item.user_rating ?? undefined,
		userStatusLabel: item.user_status?.label ?? undefined,
		userStatusColor: item.user_status?.color ?? undefined,
		chapters: item.chapters_count,
		href: buildTitlePath(item.id, item.title)
	};
}

function mapVariant(variant: LibraryTitleResource['variants'][number]): TitleVariantItem {
	const availability =
		variant.availability && typeof variant.availability.state === 'string'
			? {
					state: normalizeVariantAvailabilityState(variant.availability.state),
					chapterCount: variant.availability.chapter_count ?? 0,
					startsFromChapterOne: variant.availability.starts_from_chapter_one ?? false,
					hasMajorGaps: variant.availability.has_major_gaps ?? false,
					firstChapterNumber: variant.availability.first_chapter_number ?? undefined,
					lastChapterNumber: variant.availability.last_chapter_number ?? undefined,
					globalLastChapterNumber: variant.availability.global_last_chapter_number ?? undefined
				}
			: undefined;
	return {
		id: variant.id,
		sourceId: variant.source_id,
		sourceName: variant.source_name ?? undefined,
		sourceLang: variant.source_lang ?? undefined,
		titleUrl: variant.title_url,
		title: variant.title,
		description: variant.description ?? undefined,
		artist: variant.artist ?? undefined,
		author: variant.author ?? undefined,
		genre: variant.genre ?? undefined,
		status: normalizeStatus(variant.status),
		cover: normalizeCover(variant.thumbnail_url),
		availability
	};
}

function chapterDisplayNumber(chapterNumber: number, chapterName: string): number | null {
	if (Number.isFinite(chapterNumber) && chapterNumber > 0) {
		if (Number.isInteger(chapterNumber)) {
			return chapterNumber;
		}
		return Number(chapterNumber.toFixed(1));
	}
	return inferChapterNumber(chapterName);
}

function mapChapter(
	chapter: LibraryChapterResource,
	displayNumber: number | null
): TitleChapterItem {
	return {
		id: chapter.id,
		chapterUrl: chapter.chapter_url,
		number: displayNumber,
		title: chapter.name,
		uploadDate: chapter.date_upload,
		scanlator: chapter.scanlator ?? undefined,
		isRead: chapter.is_read,
		isDownloaded: chapter.is_downloaded,
		downloadError: chapter.download_error ?? undefined
	};
}

export function mapLibraryChapterResources(chapters: LibraryChapterResource[]): TitleChapterItem[] {
	const mappedChapters = chapters.map((chapter) => ({
		chapter,
		displayNumber: chapterDisplayNumber(chapter.chapter_number, chapter.name)
	}));

	mappedChapters.sort((left, right) => {
		if (left.displayNumber !== null && right.displayNumber !== null) {
			if (left.displayNumber !== right.displayNumber) {
				return right.displayNumber - left.displayNumber;
			}
		} else if (left.displayNumber !== null) {
			return -1;
		} else if (right.displayNumber !== null) {
			return 1;
		}
		return right.chapter.date_upload.localeCompare(left.chapter.date_upload);
	});

	return mappedChapters.map(({ chapter, displayNumber }) => mapChapter(chapter, displayNumber));
}

function mapUserStatus(
	status: LibraryTitleResource['user_status'] | null | undefined
): TitleUserStatusItem | undefined {
	if (!status) {
		return undefined;
	}
	return {
		id: status.id,
		key: status.key,
		label: status.label,
		color: status.color,
		position: status.position,
		isDefault: status.is_default
	};
}

function mapCollection(
	collection: LibraryTitleResource['collections'][number]
): TitleCollectionItem {
	return {
		id: collection.id,
		name: collection.name,
		color: collection.color
	};
}

export function mapLibraryTitleToDetail(
	title: LibraryTitleResource,
	chapters: LibraryChapterResource[],
	chaptersError?: string
): TitleDetailItem {
	return {
		id: String(title.id),
		libraryId: title.id,
		title: title.title,
		cover: normalizeCover(title.thumbnail_url),
		author: title.author ?? undefined,
		artist: title.artist ?? undefined,
		description: title.description ?? undefined,
		genres: splitGenres(title.genre),
		status: normalizeStatus(title.status),
		href: buildTitlePath(title.id, title.title),
		variants: title.variants.map(mapVariant),
		preferredVariantId: title.preferred_variant_id ?? undefined,
		chapters: mapLibraryChapterResources(chapters),
		chaptersError,
		userStatus: mapUserStatus(title.user_status),
		userRating: title.user_rating ?? undefined,
		collections: title.collections.map(mapCollection),
		updatesEnabled: title.updates_enabled,
		watchedVariantIds: title.watched_variant_ids ?? []
	};
}
