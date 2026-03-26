import anyAscii from 'any-ascii';

import { formatChapterNumberValue, hasDisplayableChapterNumber } from '$lib/utils/chapter-display';

const NON_ALNUM_RE = /[^a-z0-9]+/g;
const ROUTE_SLUG_DELIMITER = '--';

function normalizeWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, ' ');
}

export function slugifySegment(value: string, fallback = 'item'): string {
	const ascii = anyAscii(normalizeWhitespace(value)).toLowerCase();
	const slug = ascii.replace(NON_ALNUM_RE, '-').replace(/^-+|-+$/g, '');
	return slug || fallback;
}

function encodeRouteSegment(id: string, label: string | null | undefined): string {
	const slug = (label ?? '').trim() ? slugifySegment(label!, 'item').slice(0, 80) : '';
	return encodeURIComponent(slug ? `${id}${ROUTE_SLUG_DELIMITER}${slug}` : id);
}

function decodeRouteId(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		const decoded = decodeURIComponent(value);
		return decoded.split(ROUTE_SLUG_DELIMITER, 1)[0] || null;
	} catch {
		return null;
	}
}

function buildChapterRouteSlug(chapterName: string | null | undefined, chapterNumber?: number | null): string {
	const numericPart = hasDisplayableChapterNumber(chapterNumber)
		? `chapter-${formatChapterNumberValue(chapterNumber)}`
		: 'chapter';
	const namedPart = (chapterName ?? '').trim();
	return namedPart ? `${numericPart}-${namedPart}` : numericPart;
}

export function buildTitlePath(titleId: string, titleName: string): string {
	const encoded = encodeRouteSegment(titleId, titleName);
	return `/title/${encoded}`;
}

export function parseTitleRouteParam(value: string | null | undefined): string | null {
	return decodeRouteId(value);
}

export function buildReaderPath(params: {
	titleId: string;
	titleName?: string | null;
	chapterId: string;
	chapterName?: string | null;
	chapterNumber?: number | null;
}): string {
	return `/reader/${encodeRouteSegment(params.titleId, params.titleName)}/${encodeRouteSegment(
		params.chapterId,
		buildChapterRouteSlug(params.chapterName, params.chapterNumber)
	)}`;
}

export function parseReaderChapterParam(value: string | null | undefined): string | null {
	return decodeRouteId(value);
}
