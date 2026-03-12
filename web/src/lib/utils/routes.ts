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

export function buildTitlePath(titleId: string, titleName: string): string {
	const encoded = encodeURIComponent(titleId);
	const slug = slugifySegment(titleName, 'title');
	return `/title/${encoded}--${slug}`;
}

export function parseTitleRouteParam(value: string | null | undefined): string | null {
	if (!value) return null;
	const segment = value.split('--')[0];
	if (!segment) return null;
	try {
		return decodeURIComponent(segment);
	} catch {
		return null;
	}
}
