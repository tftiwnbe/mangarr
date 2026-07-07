import {
	formatChapterNumberValue,
	hasDisplayableChapterNumber,
	parseStructuredChapterName
} from './chapter-display';

const NON_ALNUM_RE = /[^a-z0-9]+/g;
const ROUTE_COLLISION_DELIMITER = '~';
const OPAQUE_ROUTE_SEGMENT_RE = /^[a-z0-9_-]{20,}$/i;
const UUID_ROUTE_SEGMENT_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GENERIC_ROUTE_WORDS = new Set([
	'chapter',
	'chapters',
	'comic',
	'content',
	'gist',
	'index',
	'json',
	'manga',
	'manhua',
	'manhwa',
	'raw',
	'read',
	'series',
	'title',
	'viewer'
]);
const CYRILLIC_ASCII: Record<string, string> = {
	а: 'a',
	б: 'b',
	в: 'v',
	г: 'g',
	д: 'd',
	е: 'e',
	ё: 'e',
	ж: 'zh',
	з: 'z',
	и: 'i',
	й: 'y',
	к: 'k',
	л: 'l',
	м: 'm',
	н: 'n',
	о: 'o',
	п: 'p',
	р: 'r',
	с: 's',
	т: 't',
	у: 'u',
	ф: 'f',
	х: 'kh',
	ц: 'ts',
	ч: 'ch',
	ш: 'sh',
	щ: 'shch',
	ъ: '',
	ы: 'y',
	ь: '',
	э: 'e',
	ю: 'yu',
	я: 'ya',
	є: 'ie',
	і: 'i',
	ї: 'i',
	ґ: 'g',
	ў: 'u'
};

function normalizeWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, ' ');
}

function splitUrlSuffix(value: string) {
	const hashIndex = value.indexOf('#');
	const queryIndex = value.indexOf('?');
	const suffixIndex =
		hashIndex === -1
			? queryIndex
			: queryIndex === -1
				? hashIndex
				: Math.min(hashIndex, queryIndex);
	return suffixIndex === -1
		? { path: value, suffix: '' }
		: { path: value.slice(0, suffixIndex), suffix: value.slice(suffixIndex) };
}

function collapsePathSlashes(path: string) {
	if (!path) return path;
	const protocolRelative = path.startsWith('//') && !path.startsWith('///');
	if (protocolRelative) {
		return `//${path.slice(2).replace(/\/{2,}/g, '/')}`;
	}
	if (path.startsWith('/')) {
		return `/${path.slice(1).replace(/\/{2,}/g, '/')}`;
	}
	return path.replace(/\/{2,}/g, '/');
}

function toRouteAscii(value: string): string {
	return [...value.normalize('NFKD')]
		.map((char) => {
			const lower = char.toLowerCase();
			if (CYRILLIC_ASCII[lower] !== undefined) {
				return CYRILLIC_ASCII[lower];
			}
			return char;
		})
		.join('')
		.replace(/\p{M}+/gu, '');
}

export function slugifySegment(value: string, fallback = 'item'): string {
	const ascii = toRouteAscii(normalizeWhitespace(value)).toLowerCase();
	const slug = ascii.replace(NON_ALNUM_RE, '-').replace(/^-+|-+$/g, '');
	return slug || fallback;
}

function splitSlugWords(slug: string) {
	return slug.split('-').filter(Boolean);
}

function isLowQualityRouteSlug(rawSegment: string, slug: string, fallbackSlug = '') {
	if (!slug) return true;
	if (UUID_ROUTE_SEGMENT_RE.test(rawSegment)) {
		return Boolean(fallbackSlug);
	}
	if (OPAQUE_ROUTE_SEGMENT_RE.test(rawSegment) && !rawSegment.includes('-') && !rawSegment.includes('_')) {
		return true;
	}

	const words = splitSlugWords(slug);
	if (words.length === 0) return true;
	if (words.every((word) => GENERIC_ROUTE_WORDS.has(word))) {
		return true;
	}
	if (words.length === 1 && words[0].length >= 16) {
		return true;
	}

	if (fallbackSlug) {
		const fallbackWords = splitSlugWords(fallbackSlug);
		const overlappingWords = words.filter((word) => fallbackWords.includes(word));
		if (
			words.length < fallbackWords.length &&
			overlappingWords.length === words.length &&
			(fallbackWords.length - words.length >= 2 || words.every((word) => GENERIC_ROUTE_WORDS.has(word)))
		) {
			return true;
		}
	}

	return false;
}

function decodeUrlCandidate(value: string) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function normalizeSourceUrlPath(rawUrl: string) {
	const trimmed = rawUrl.trim();
	if (!trimmed) return trimmed;

	try {
		const parsed = new URL(trimmed);
		parsed.pathname = collapsePathSlashes(parsed.pathname || '/');
		return parsed.toString();
	} catch {
		const { path, suffix } = splitUrlSuffix(trimmed);
		return `${collapsePathSlashes(path)}${suffix}`;
	}
}

export function decodeRouteSegment(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		return decodeURIComponent(value) || null;
	} catch {
		return null;
	}
}

export function buildTitleRouteBase(titleName: string | null | undefined): string {
	return slugifySegment(titleName ?? '', 'title').slice(0, 80);
}

export function buildTitleRouteBaseFromUrl(
	titleUrl: string | null | undefined,
	fallbackTitle?: string | null
): string {
	const trimmed = titleUrl?.trim();
	const fallbackSlug = fallbackTitle?.trim() ? buildTitleRouteBase(fallbackTitle) : '';
	if (!trimmed) {
		return fallbackSlug || buildTitleRouteBase(fallbackTitle);
	}

	const normalizedUrl = normalizeSourceUrlPath(trimmed);
	let fallbackRouteSource = normalizedUrl;
	try {
		const parsed = new URL(normalizedUrl, 'https://mangarr.local');
		const pathSegments = parsed.pathname
			.split('/')
			.map((segment) => segment.trim())
			.filter(Boolean);
		for (const pathSegment of [...pathSegments].reverse()) {
			const decodedSegment = decodeUrlCandidate(pathSegment);
			const candidateSlug = slugifySegment(decodedSegment, '');
			if (!candidateSlug) continue;
			fallbackRouteSource ||= decodedSegment;
			if (!isLowQualityRouteSlug(decodedSegment, candidateSlug, fallbackSlug)) {
				return candidateSlug.slice(0, 96);
			}
		}
		fallbackRouteSource = parsed.hostname || normalizedUrl;
	} catch {
		const pathSegments = normalizedUrl
			.split(/[/?#]/)
			.map((segment) => segment.trim())
			.filter(Boolean);
		for (const pathSegment of [...pathSegments].reverse()) {
			const decodedSegment = decodeUrlCandidate(pathSegment);
			const candidateSlug = slugifySegment(decodedSegment, '');
			if (!candidateSlug) continue;
			fallbackRouteSource ||= decodedSegment;
			if (!isLowQualityRouteSlug(decodedSegment, candidateSlug, fallbackSlug)) {
				return candidateSlug.slice(0, 96);
			}
		}
	}

	if (fallbackSlug) {
		return fallbackSlug;
	}

	return slugifySegment(decodeUrlCandidate(fallbackRouteSource), 'title').slice(0, 96);
}

export function buildChapterRouteBase(
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

export function shortRouteToken(value: string, length = 6): string {
	const normalized = value.replace(/[^a-z0-9]/gi, '').toLowerCase();
	return (normalized.slice(-length) || normalized || 'item').slice(-length);
}

export function buildUniqueRouteSegmentMap<T>(args: {
	items: readonly T[];
	getId: (item: T) => string;
	getBase: (item: T) => string;
}): Map<string, string> {
	const idsByBase = new Map<string, string[]>();
	for (const item of args.items) {
		const base = args.getBase(item);
		const existing = idsByBase.get(base);
		if (existing) {
			existing.push(args.getId(item));
		} else {
			idsByBase.set(base, [args.getId(item)]);
		}
	}

	const segments = new Map<string, string>();
	for (const item of args.items) {
		const id = args.getId(item);
		const base = args.getBase(item);
		const collisions = idsByBase.get(base) ?? [];
		if (collisions.length <= 1) {
			segments.set(id, base);
			continue;
		}

		let length = 6;
		let segment = `${base}${ROUTE_COLLISION_DELIMITER}${shortRouteToken(id, length)}`;
		while (
			collisions.some((candidateId) => {
				if (candidateId === id) return false;
				const candidate = `${base}${ROUTE_COLLISION_DELIMITER}${shortRouteToken(candidateId, length)}`;
				return candidate === segment;
			})
		) {
			length += 2;
			segment = `${base}${ROUTE_COLLISION_DELIMITER}${shortRouteToken(id, length)}`;
		}
		segments.set(id, segment);
	}

	return segments;
}
