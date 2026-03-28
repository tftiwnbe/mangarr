import anyAscii from 'any-ascii';

import {
	formatChapterNumberValue,
	hasDisplayableChapterNumber,
	parseStructuredChapterName
} from '$lib/utils/chapter-display';

const NON_ALNUM_RE = /[^a-z0-9]+/g;
const ROUTE_SLUG_DELIMITER = '--';
const ROUTE_ID_DELIMITER = '~';

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
	return encodeURIComponent(slug ? `${slug}${ROUTE_ID_DELIMITER}${id}` : id);
}

function decodeRouteId(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		const decoded = decodeURIComponent(value);
		if (decoded.includes(ROUTE_ID_DELIMITER)) {
			return decoded.substring(decoded.lastIndexOf(ROUTE_ID_DELIMITER) + 1) || null;
		}
		return decoded.split(ROUTE_SLUG_DELIMITER, 1)[0] || null;
	} catch {
		return null;
	}
}

function buildChapterRouteSlug(
	chapterName: string | null | undefined,
	chapterNumber?: number | null
): string {
	if (hasDisplayableChapterNumber(chapterNumber)) {
		return `ch-${formatChapterNumberValue(chapterNumber)}`;
	}

	const parsed = parseStructuredChapterName(chapterName ?? '');
	if (parsed?.chapterNumber) {
		const chapterLabel = `ch-${parsed.chapterNumber}`;
		return parsed.volumeNumber ? `v${parsed.volumeNumber}-${chapterLabel}` : chapterLabel;
	}

	const namedPart = (chapterName ?? '').trim();
	return namedPart ? slugifySegment(namedPart, 'chapter').slice(0, 48) : 'chapter';
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
