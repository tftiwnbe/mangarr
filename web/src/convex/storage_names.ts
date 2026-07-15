import anyAscii from 'any-ascii';

const OPAQUE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_HEX_RE = /^[0-9a-f]{12,}$/i;
const OPAQUE_NUMERIC_RE = /^\d{4,}$/;
const GENERIC_SEGMENTS = new Set(['title', 'titles', 'manga', 'comic', 'series', 'book', 'work']);

export type StorageTitleCandidate = {
	title?: string | null;
	titleUrl?: string | null;
};

function normalizeWhitespace(value: string) {
	return value.trim().replace(/\s+/g, ' ');
}

function normalizeComparableText(value: string | null | undefined) {
	const normalized = normalizeWhitespace(value ?? '');
	if (!normalized) return '';
	return anyAscii(normalized)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function normalizeOpaqueSegment(value: string) {
	return normalizeComparableText(value).replace(/\s+/g, '-');
}

function decodeUrlSegment(value: string) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function extractLastPathSegment(titleUrl: string | null | undefined) {
	const trimmed = titleUrl?.trim();
	if (!trimmed) return null;

	try {
		const parsed = new URL(trimmed, 'https://mangarr.local');
		const segment = parsed.pathname
			.split('/')
			.map((part) => part.trim())
			.filter(Boolean)
			.at(-1);
		return segment ? decodeUrlSegment(segment) : null;
	} catch {
		const segment = trimmed
			.split(/[/?#]/)
			.map((part) => part.trim())
			.filter(Boolean)
			.at(-1);
		return segment ? decodeUrlSegment(segment) : null;
	}
}

function humanizeUrlSegment(segment: string | null) {
	if (!segment) return null;
	const trimmed = segment.trim();
	if (!trimmed) return null;

	const normalized = normalizeOpaqueSegment(trimmed);
	if (
		!normalized ||
		GENERIC_SEGMENTS.has(normalized) ||
		OPAQUE_UUID_RE.test(normalized) ||
		OPAQUE_HEX_RE.test(normalized) ||
		OPAQUE_NUMERIC_RE.test(normalized)
	) {
		return null;
	}

	const words = trimmed.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
	return words || null;
}

function hasLatinLetters(value: string | null | undefined) {
	return /[A-Za-z]/.test(value ?? '');
}

function transliteratedTitle(value: string | null | undefined) {
	const normalized = normalizeWhitespace(value ?? '');
	if (!normalized) return null;
	const transliterated = normalizeWhitespace(anyAscii(normalized));
	return transliterated || null;
}

function scoreTitleCandidate(raw: string) {
	const normalized = normalizeComparableText(raw);
	if (!normalized) return -1;
	const wordCount = normalized.split(' ').filter(Boolean).length;
	return 300 + Math.min(normalized.length, 120) + wordCount * 4;
}

function scoreUrlCandidate(raw: string) {
	const normalized = normalizeComparableText(raw);
	if (!normalized) return -1;
	const wordCount = normalized.split(' ').filter(Boolean).length;
	return 200 + Math.min(normalized.length, 96) + wordCount * 3;
}

export function pickStorageTitleBase(input: {
	canonicalTitle?: string | null;
	canonicalTitleUrl?: string | null;
	variants?: readonly StorageTitleCandidate[];
}) {
	const ranked = new Map<string, { value: string; score: number }>();

	function addCandidate(value: string | null | undefined, score: number) {
		const trimmed = normalizeWhitespace(value ?? '');
		if (!trimmed) return;
		const key = normalizeComparableText(trimmed);
		if (!key) return;
		const existing = ranked.get(key);
		if (!existing || score > existing.score) {
			ranked.set(key, { value: trimmed, score });
		}
	}

	const allTitleCandidates = [
		input.canonicalTitle,
		...(input.variants?.map((variant) => variant.title) ?? [])
	];
	for (const title of allTitleCandidates) {
		if (!hasLatinLetters(title)) continue;
		addCandidate(title, scoreTitleCandidate(title ?? ''));
	}

	for (const title of allTitleCandidates) {
		if (hasLatinLetters(title)) continue;
		const candidate = transliteratedTitle(title);
		if (!candidate) continue;
		addCandidate(candidate, 250 + Math.min(normalizeComparableText(candidate).length, 108));
	}

	const allUrlCandidates = [
		input.canonicalTitleUrl,
		...(input.variants?.map((variant) => variant.titleUrl) ?? [])
	];
	for (const titleUrl of allUrlCandidates) {
		const candidate = humanizeUrlSegment(extractLastPathSegment(titleUrl));
		if (!candidate) continue;
		addCandidate(candidate, scoreUrlCandidate(candidate));
	}

	for (const title of allTitleCandidates) {
		addCandidate(title, 100 + Math.min(normalizeComparableText(title).length, 96));
	}

	const best = [...ranked.values()].sort((left, right) => {
		if (left.score !== right.score) {
			return right.score - left.score;
		}
		return left.value.localeCompare(right.value);
	})[0]?.value;

	const fallback = normalizeWhitespace(input.canonicalTitle ?? '');
	return best ?? (fallback || 'title');
}
