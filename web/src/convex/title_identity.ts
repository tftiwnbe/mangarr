import anyAscii from 'any-ascii';

const NON_ALNUM_RE = /[^a-z0-9]+/g;
const UUID_SEGMENT_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LONG_HEX_SEGMENT_RE = /^[0-9a-f]{12,}$/;
const NUMERIC_SEGMENT_RE = /^\d{4,}$/;
const STABLE_PATH_PREFIXES = new Set([
	'title',
	'titles',
	'manga',
	'comic',
	'series',
	'book',
	'work',
	'detail',
	'details'
]);

export type MergeIdentitySnapshot = {
	title?: string | null;
	author?: string | null;
	artist?: string | null;
	sourcePkg?: string | null;
	sourceLang?: string | null;
	titleUrl?: string | null;
};

export type MergeIdentityCandidate<T> = {
	item: T;
	snapshots: MergeIdentitySnapshot[];
};

function normalizeWhitespace(value: string) {
	return value.trim().replace(/\s+/g, ' ');
}

export function normalizeMergeText(value: string | null | undefined): string {
	const normalized = normalizeWhitespace(value ?? '');
	if (!normalized) return '';
	return anyAscii(normalized).toLowerCase().replace(NON_ALNUM_RE, ' ').trim();
}

function normalizedTokens(value: string | null | undefined): string[] {
	const normalized = normalizeMergeText(value);
	return normalized ? normalized.split(' ').filter(Boolean) : [];
}

function tokenOverlapScore(left: string | null | undefined, right: string | null | undefined): number {
	const leftTokens = normalizedTokens(left);
	const rightTokens = normalizedTokens(right);
	if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

	const leftSet = new Set(leftTokens);
	const rightSet = new Set(rightTokens);
	let overlap = 0;
	for (const token of leftSet) {
		if (rightSet.has(token)) overlap += 1;
	}
	if (overlap === 0) return 0;

	const ratio = overlap / Math.max(leftSet.size, rightSet.size);
	if (ratio >= 0.95) return 90;
	if (ratio >= 0.8) return 60;
	if (ratio >= 0.65) return 35;
	return 0;
}

function textContainmentScore(left: string | null | undefined, right: string | null | undefined): number {
	const normalizedLeft = normalizeMergeText(left);
	const normalizedRight = normalizeMergeText(right);
	if (!normalizedLeft || !normalizedRight) return 0;
	if (normalizedLeft === normalizedRight) return 120;
	if (
		normalizedLeft.length >= 10 &&
		normalizedRight.length >= 10 &&
		(normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
	) {
		return 55;
	}
	return tokenOverlapScore(normalizedLeft, normalizedRight);
}

function contributorScore(
	leftAuthor: string | null | undefined,
	leftArtist: string | null | undefined,
	rightAuthor: string | null | undefined,
	rightArtist: string | null | undefined
): number {
	const leftPeople = [leftAuthor, leftArtist].map(normalizeMergeText).filter(Boolean);
	const rightPeople = [rightAuthor, rightArtist].map(normalizeMergeText).filter(Boolean);
	if (leftPeople.length === 0 || rightPeople.length === 0) return 0;

	let best = 0;
	for (const left of leftPeople) {
		for (const right of rightPeople) {
			if (!left || !right) continue;
			if (left === right) {
				best = Math.max(best, 90);
				continue;
			}
			if (
				left.length >= 8 &&
				right.length >= 8 &&
				(left.includes(right) || right.includes(left))
			) {
				best = Math.max(best, 50);
				continue;
			}
			best = Math.max(best, tokenOverlapScore(left, right));
		}
	}

	return best;
}

function safeDecodeUriPart(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function isStableIdSegment(value: string): boolean {
	const segment = normalizeMergeText(value).replace(/\s+/g, '');
	return (
		UUID_SEGMENT_RE.test(segment) ||
		LONG_HEX_SEGMENT_RE.test(segment) ||
		NUMERIC_SEGMENT_RE.test(segment)
	);
}

export function titleUrlIdentity(value: string | null | undefined): string {
	let raw = (value ?? '').trim();
	if (!raw) return '';

	try {
		const parsed = new URL(raw);
		raw = `${parsed.pathname}${parsed.search}`;
	} catch {
		raw = raw.replace(/^https?:\/\//i, '/');
	}

	const pathOnly = (raw.split('#', 1)[0] ?? raw).split('?', 1)[0] ?? raw;
	const normalizedPath = pathOnly.replace(/\\/g, '/').replace(/^\/+/, '');
	const segments = normalizedPath
		.split('/')
		.map((part) => normalizeMergeText(safeDecodeUriPart(part)).replace(/\s+/g, '-'))
		.filter(Boolean);

	if (segments.length === 0) return '';

	for (let index = 0; index < segments.length - 1; index += 1) {
		const prefix = segments[index];
		if (!STABLE_PATH_PREFIXES.has(prefix)) continue;
		const candidate = segments[index + 1];
		if (!candidate) continue;
		if (isStableIdSegment(candidate) || candidate.length >= 8) {
			return `${prefix}/${candidate}`;
		}
	}

	const idSegment = segments.find((segment) => isStableIdSegment(segment));
	if (idSegment) return `id:${idSegment}`;
	return segments.join('/');
}

export function scoreMergeSnapshot(
	source: MergeIdentitySnapshot,
	candidate: MergeIdentitySnapshot
): number {
	const sourceUrlIdentity = titleUrlIdentity(source.titleUrl);
	const candidateUrlIdentity = titleUrlIdentity(candidate.titleUrl);
	if (
		sourceUrlIdentity &&
		sourceUrlIdentity === candidateUrlIdentity &&
		normalizeMergeText(source.sourcePkg) &&
		normalizeMergeText(source.sourcePkg) === normalizeMergeText(candidate.sourcePkg)
	) {
		return 260;
	}

	const titleScore = textContainmentScore(source.title, candidate.title);
	const personScore = contributorScore(
		source.author,
		source.artist,
		candidate.author,
		candidate.artist
	);
	const langScore =
		normalizeMergeText(source.sourceLang) &&
		normalizeMergeText(source.sourceLang) === normalizeMergeText(candidate.sourceLang)
			? 10
			: 0;

	if (titleScore >= 120 && personScore >= 50) return titleScore + personScore + langScore;
	if (titleScore >= 120 && langScore > 0) return titleScore + langScore;
	if (titleScore >= 90 && personScore >= 90) return titleScore + personScore;
	return titleScore + personScore;
}

export function pickBestMergeCandidate<T>(
	source: MergeIdentitySnapshot,
	candidates: Array<MergeIdentityCandidate<T>>
): { item: T; score: number } | null {
	let best: { item: T; score: number } | null = null;
	let secondBestScore = 0;

	for (const candidate of candidates) {
		let score = 0;
		for (const snapshot of candidate.snapshots) {
			score = Math.max(score, scoreMergeSnapshot(source, snapshot));
		}
		if (!best || score > best.score) {
			secondBestScore = best?.score ?? secondBestScore;
			best = { item: candidate.item, score };
			continue;
		}
		if (score > secondBestScore) {
			secondBestScore = score;
		}
	}

	if (!best) return null;
	if (best.score >= 260) return best;
	if (best.score >= 190) return best;
	if (best.score >= 150 && best.score - secondBestScore >= 25) return best;
	return null;
}
