import {
	formatChapterNumberValue,
	hasDisplayableChapterNumber,
	parseStructuredChapterName
} from './chapter-display';

const NON_ALNUM_RE = /[^a-z0-9]+/g;
const ROUTE_COLLISION_DELIMITER = '~';
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
	if (!trimmed) {
		return buildTitleRouteBase(fallbackTitle);
	}

	let routeSource = trimmed;
	try {
		const parsed = new URL(trimmed, 'https://mangarr.local');
		const pathSegment = parsed.pathname
			.split('/')
			.map((segment) => segment.trim())
			.filter(Boolean)
			.at(-1);
		routeSource = pathSegment || parsed.hostname || trimmed;
	} catch {
		const pathSegment = trimmed
			.split(/[/?#]/)
			.map((segment) => segment.trim())
			.filter(Boolean)
			.at(-1);
		routeSource = pathSegment || trimmed;
	}

	try {
		routeSource = decodeURIComponent(routeSource);
	} catch {
		// Keep the raw source when a source extension returns a malformed escape.
	}

	return slugifySegment(routeSource, slugifySegment(fallbackTitle ?? '', 'title')).slice(0, 96);
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
