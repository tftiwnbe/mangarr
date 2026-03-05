import anyAscii from 'any-ascii';

const NON_ALNUM_RE = /[^a-z0-9]+/g;
const CHAPTER_NUMBER_RE = /(?:^|[\s[(])ch(?:apter)?[.\s:_-]*(\d+(?:\.\d+)?)/i;
const NUMBER_FALLBACK_RE = /(\d+(?:\.\d+)?)/;
const CHAPTER_PARAM_RE = /^ch(\d+(?:\.\d+)?)$/i;
const CHAPTER_ID_PARAM_RE = /^c(\d+)$/i;

// ---------------------------------------------------------------------------
// ID obfuscation — keeps sequential DB integers out of public URLs.
// Algorithm: XOR with mask → reverse 24 bits → base-36.
// Fully reversible (both steps are self-inverse), no DB lookup needed.
// Handles IDs up to 16 777 215 (2^24 − 1), well above any realistic library size.
// ---------------------------------------------------------------------------
const _ENC_MASK = 0x96f5a2;

function _rev24(x: number): number {
	let r = 0;
	for (let i = 0; i < 24; i++, x >>= 1) r = (r << 1) | (x & 1);
	return r;
}

export function encodeId(id: number): string {
	return _rev24((id ^ _ENC_MASK) & 0xffffff).toString(36);
}

export function decodeId(s: string): number | null {
	const n = parseInt(s, 36);
	if (!Number.isFinite(n) || n < 0 || n > 0xffffff) return null;
	const id = _rev24(n) ^ _ENC_MASK;
	return id > 0 ? id : null;
}

// ---------------------------------------------------------------------------

function normalizeWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, ' ');
}

export function slugifySegment(value: string, fallback = 'item'): string {
	const ascii = anyAscii(normalizeWhitespace(value)).toLowerCase();
	const slug = ascii.replace(NON_ALNUM_RE, '-').replace(/^-+|-+$/g, '');
	return slug || fallback;
}

/** Parse an obfuscated title ID from a route param like "7dwrd--bleach". */
export function parseTitleRouteParam(value: string | null | undefined): number | null {
	if (!value) return null;
	const segment = value.split('--')[0];
	return decodeId(segment);
}

/** Parse a raw integer from a route param — used for chapter IDs (c42, ch5). */
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
	const encoded = encodeId(titleId);
	const slug = slugifySegment(titleName, `t-${encoded}`);
	return `/title/${encoded}--${slug}`;
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
	const encoded = encodeId(params.titleId);
	const titleSlug = `${encoded}--${slugifySegment(params.titleName, `t-${encoded}`)}`;
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
