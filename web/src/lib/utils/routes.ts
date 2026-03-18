import anyAscii from 'any-ascii';

const NON_ALNUM_RE = /[^a-z0-9]+/g;

function normalizeWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, ' ');
}

export function slugifySegment(value: string, fallback = 'item'): string {
	const ascii = anyAscii(normalizeWhitespace(value)).toLowerCase();
	const slug = ascii.replace(NON_ALNUM_RE, '-').replace(/^-+|-+$/g, '');
	return slug || fallback;
}

export function buildTitlePath(titleId: string, _titleName: string): string {
	const encoded = encodeURIComponent(titleId);
	return `/title/${encoded}`;
}

export function parseTitleRouteParam(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}

export function buildReaderPath(params: { titleId: string; chapterId: string }): string {
	return `/reader/${encodeURIComponent(params.titleId)}/${encodeURIComponent(params.chapterId)}`;
}

export function parseReaderChapterParam(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}
