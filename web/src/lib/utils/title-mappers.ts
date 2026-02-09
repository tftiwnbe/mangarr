import type { LibraryChapterResource, LibraryTitleResource, LibraryTitleSummary } from '$lib/api/library';
import type { components } from '$lib/api/v2';
import type { TitleCardItem, TitleChapterItem, TitleDetailItem, TitleStatus, TitleVariantItem } from '$lib/models/title';

type DiscoverItem = components['schemas']['DiscoverItem'];

const FALLBACK_COVER = '/favicon.ico';

function normalizeCover(url: string | null | undefined): string {
	const trimmed = (url ?? '').trim();
	return trimmed.length > 0 ? trimmed : FALLBACK_COVER;
}

function normalizeStatus(status: number): TitleStatus | undefined {
	switch (status) {
		case 1:
			return 'ongoing';
		case 2:
		case 4:
			return 'completed';
		case 6:
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

function discoverHref(item: DiscoverItem): { href?: string; external?: boolean } {
	if (item.imported_library_id) {
		return {
			href: `/title/${item.imported_library_id}`,
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

export function mapDiscoverItemToTitleCard(item: DiscoverItem): TitleCardItem {
	const { href, external } = discoverHref(item);
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
		chapters: item.chapters_count,
		href: `/title/${item.id}`
	};
}

function mapVariant(variant: LibraryTitleResource['variants'][number]): TitleVariantItem {
	return {
		id: variant.id,
		sourceId: variant.source_id,
		sourceName: variant.source_name ?? undefined,
		sourceLang: variant.source_lang ?? undefined,
		titleUrl: variant.title_url,
		title: variant.title
	};
}

function chapterDisplayNumber(chapterNumber: number): number {
	if (Number.isInteger(chapterNumber)) {
		return chapterNumber;
	}
	return Number(chapterNumber.toFixed(1));
}

function mapChapter(chapter: LibraryChapterResource): TitleChapterItem {
	return {
		id: chapter.id,
		chapterUrl: chapter.chapter_url,
		number: chapterDisplayNumber(chapter.chapter_number),
		title: chapter.name,
		uploadDate: chapter.date_upload,
		scanlator: chapter.scanlator ?? undefined,
		isRead: chapter.is_read,
		isDownloaded: chapter.is_downloaded,
		downloadError: chapter.download_error ?? undefined
	};
}

export function mapLibraryTitleToDetail(
	title: LibraryTitleResource,
	chapters: LibraryChapterResource[]
): TitleDetailItem {
	const sortedChapters = [...chapters].sort((left, right) => {
		if (left.chapter_number !== right.chapter_number) {
			return right.chapter_number - left.chapter_number;
		}
		return right.date_upload.localeCompare(left.date_upload);
	});

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
		href: `/title/${title.id}`,
		variants: title.variants.map(mapVariant),
		chapters: sortedChapters.map(mapChapter)
	};
}
