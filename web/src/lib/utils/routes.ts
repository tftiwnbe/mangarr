const NON_ALNUM_RE = /[^a-z0-9]+/g;
const CHAPTER_NUMBER_RE = /(?:^|[\s[(])ch(?:apter)?[.\s:_-]*(\d+(?:\.\d+)?)/i;
const NUMBER_FALLBACK_RE = /(\d+(?:\.\d+)?)/;
const CHAPTER_PARAM_RE = /^ch(\d+(?:\.\d+)?)$/i;
const CHAPTER_ID_PARAM_RE = /^c(\d+)$/i;

function normalizeWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, ' ');
}

export function slugifySegment(value: string, fallback = 'item'): string {
	const normalized = normalizeWhitespace(value).toLowerCase();
	const slug = normalized.replace(NON_ALNUM_RE, '-').replace(/^-+|-+$/g, '');
	return slug || fallback;
}

export function parseIdFromRouteParam(value: string | null | undefined): number | null {
	if (!value) return null;
	const match = value.match(/^(\d+)/);
	if (!match) return null;
	const parsed = Number(match[1]);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeChapterNumber(value: number | null | undefined): number | null {
	if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
		return null;
	}
	return Number(value.toString());
}

export function formatChapterNumber(value: number | null | undefined): string | null {
	const normalized = normalizeChapterNumber(value);
	if (normalized === null) return null;
	if (Number.isInteger(normalized)) return String(normalized);
	return String(normalized).replace(/\.0+$/, '');
}

export function buildTitlePath(titleId: number, titleName: string): string {
	const slug = slugifySegment(titleName, `title-${titleId}`);
	return `/title/${titleId}--${slug}`;
}

export function inferChapterNumber(chapterName: string): number | null {
	const name = chapterName.trim();
	if (!name) return null;

	const chapterMatch = name.match(CHAPTER_NUMBER_RE);
	if (chapterMatch) {
		const value = Number(chapterMatch[1]);
		if (Number.isFinite(value) && value > 0) return value;
	}

	const fallbackMatch = name.match(NUMBER_FALLBACK_RE);
	if (!fallbackMatch) return null;
	const fallback = Number(fallbackMatch[1]);
	return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

export function buildReaderPath(params: {
	titleId: number;
	titleName: string;
	chapterId: number;
	chapterName?: string | null;
	chapterNumber?: number | null;
}): string {
	const titleSlug = `${params.titleId}--${slugifySegment(params.titleName, `title-${params.titleId}`)}`;
	const chapterNumber = formatChapterNumber(params.chapterNumber ?? null);
	const chapterSegment = chapterNumber ? `ch${chapterNumber}` : `c${params.chapterId}`;
	return `/reader/${titleSlug}/${chapterSegment}`;
}

export function parseReaderChapterParam(value: string | null | undefined): {
	id: number | null;
	number: number | null;
} {
	if (!value) return { id: null, number: null };
	const fromId = parseIdFromRouteParam(value);
	if (fromId !== null) return { id: fromId, number: null };

	const idMatch = value.match(CHAPTER_ID_PARAM_RE);
	if (idMatch) {
		const parsed = Number(idMatch[1]);
		if (Number.isInteger(parsed) && parsed > 0) {
			return { id: parsed, number: null };
		}
	}

	const numberMatch = value.match(CHAPTER_PARAM_RE);
	if (!numberMatch) return { id: null, number: null };
	const number = Number(numberMatch[1]);
	return { id: null, number: normalizeChapterNumber(number) };
}
