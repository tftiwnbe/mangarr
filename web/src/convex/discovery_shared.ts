import { normalizeMergeText, scoreMergeSnapshot } from './title_identity';

export const DISCOVERY_FEED_LIMIT = 24;
export const DISCOVERY_POPULAR_MAX_PAGE = 100;
export const DISCOVERY_LATEST_MAX_PAGE = 6;
export const DISCOVERY_SCHEDULER_BATCH_SIZE = 2;
export const DISCOVERY_WARM_MIN_ITEMS = 3;
export const DISCOVERY_FOR_YOU_LIMIT = 24;
export const DISCOVERY_SIMILAR_LIMIT = 12;
export const DISCOVERY_MIN_SIMILARITY_SCORE = 90;
export const DISCOVERY_MIN_SIMILAR_EDGE_SCORE = 12;
export const DISCOVERY_MIN_SIMILAR_TOTAL_SCORE = 105;
export const DISCOVERY_MIN_METADATA_TOTAL_SCORE = 112;
export const DISCOVERY_POPULAR_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DISCOVERY_LATEST_INTERVAL_MS = 8 * 60 * 60 * 1000;
export const DISCOVERY_FAILURE_BASE_DELAY_MS = 60 * 60 * 1000;
export const DISCOVERY_FAILURE_MAX_DELAY_MS = 24 * 60 * 60 * 1000;
export const DISCOVERY_DETAILS_REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

export type DiscoveryFeedType = 'popular' | 'latest';

export type DiscoverySnapshot = {
	title?: string | null;
	author?: string | null;
	description?: string | null;
	genre?: string | null;
	sourcePkg?: string | null;
	sourceLang?: string | null;
	titleUrl?: string | null;
	lastSeenAt?: number | null;
	popularSeenCount?: number | null;
	latestSeenCount?: number | null;
};

export type DiscoveryEdgeWeights = {
	popularCount: number;
	latestCount: number;
	lastObservedAt?: number | null;
};

export const EMPTY_DISCOVERY_EDGE: DiscoveryEdgeWeights = {
	popularCount: 0,
	latestCount: 0,
	lastObservedAt: null
};

export type DiscoveryRankBreakdown = {
	similarity: number;
	edgeScore: number;
	freshnessScore: number;
	preferredLanguageBonus: number;
	titleBonus: number;
	authorBonus: number;
	genreScore: number;
	descriptionScore: number;
	total: number;
};

export function discoveryIntervalMs(feedType: DiscoveryFeedType) {
	return feedType === 'latest' ? DISCOVERY_LATEST_INTERVAL_MS : DISCOVERY_POPULAR_INTERVAL_MS;
}

export function discoveryMaxPage(feedType: DiscoveryFeedType) {
	return feedType === 'latest' ? DISCOVERY_LATEST_MAX_PAGE : DISCOVERY_POPULAR_MAX_PAGE;
}

export function nextDiscoveryPage(feedType: DiscoveryFeedType, page: number, hasNextPage: boolean) {
	if (!hasNextPage || page >= discoveryMaxPage(feedType)) {
		return 1;
	}
	return Math.max(1, page + 1);
}

export function computeDiscoverySuccessState(args: {
	feedType: DiscoveryFeedType;
	page: number;
	hasNextPage: boolean;
	now: number;
}) {
	const dueAt = args.now + discoveryIntervalMs(args.feedType);
	return {
		nextPage: nextDiscoveryPage(args.feedType, args.page, args.hasNextPage),
		dueAt,
		cooldownUntil: dueAt,
		lastSuccessAt: args.now,
		lastErrorAt: undefined,
		consecutiveFailures: 0
	};
}

export function computeDiscoveryFailureState(args: {
	now: number;
	consecutiveFailures: number;
	retryAfterMs?: number | null;
}) {
	const nextFailures = Math.max(1, Math.floor(args.consecutiveFailures) + 1);
	const exponentialDelay = Math.min(
		DISCOVERY_FAILURE_MAX_DELAY_MS,
		DISCOVERY_FAILURE_BASE_DELAY_MS * 2 ** (nextFailures - 1)
	);
	const dueAt = Math.max(args.now + exponentialDelay, args.now + Math.max(0, args.retryAfterMs ?? 0));
	return {
		dueAt,
		cooldownUntil: dueAt,
		lastErrorAt: args.now,
		consecutiveFailures: nextFailures
	};
}

export function computeDiscoveryMetadataSuccessState(now: number) {
	return {
		detailsHydratedAt: now,
		detailsNextHydrateAt: now + DISCOVERY_DETAILS_REFRESH_INTERVAL_MS,
		detailsLastErrorAt: undefined,
		detailsFailureCount: 0
	};
}

export function computeDiscoveryMetadataFailureState(args: {
	now: number;
	detailsFailureCount?: number | null;
	retryAfterMs?: number | null;
}) {
	const failureState = computeDiscoveryFailureState({
		now: args.now,
		consecutiveFailures: args.detailsFailureCount ?? 0,
		retryAfterMs: args.retryAfterMs
	});
	return {
		detailsHydratedAt: undefined,
		detailsNextHydrateAt: failureState.dueAt,
		detailsLastErrorAt: args.now,
		detailsFailureCount: failureState.consecutiveFailures
	};
}

export function discoveryPairKey(leftCanonicalKey: string, rightCanonicalKey: string) {
	return [leftCanonicalKey.trim(), rightCanonicalKey.trim()].sort().join('::');
}

export function buildDiscoveryCanonicalKey(sourceId: string, titleUrl: string) {
	return `${sourceId.trim()}::${titleUrl.trim()}`;
}

export function buildDiscoveryNormalizedTitle(title: string | null | undefined) {
	return normalizeMergeText(title);
}

export function buildDiscoveryNormalizedAuthor(author: string | null | undefined) {
	return normalizeMergeText(author);
}

function normalizedTokenSet(value: string | null | undefined) {
	const normalized = normalizeMergeText(value);
	if (!normalized) {
		return new Set<string>();
	}
	return new Set(normalized.split(' ').filter((token) => token.length >= 3));
}

function overlapRatio(left: Set<string>, right: Set<string>) {
	if (left.size === 0 || right.size === 0) {
		return 0;
	}
	let overlap = 0;
	for (const token of left) {
		if (right.has(token)) {
			overlap += 1;
		}
	}
	return overlap / Math.max(left.size, right.size);
}

function splitMetadataTokens(value: string | null | undefined) {
	return new Set(
		normalizeMergeText(value)
			.split(/[\s,/|;]+/)
			.map((token) => token.trim())
			.filter((token) => token.length >= 3)
	);
}

function scoreGenreOverlap(left: string | null | undefined, right: string | null | undefined) {
	const ratio = overlapRatio(splitMetadataTokens(left), splitMetadataTokens(right));
	if (ratio >= 0.8) return 42;
	if (ratio >= 0.55) return 26;
	if (ratio >= 0.35) return 14;
	return 0;
}

function scoreDescriptionOverlap(left: string | null | undefined, right: string | null | undefined) {
	const ratio = overlapRatio(normalizedTokenSet(left), normalizedTokenSet(right));
	if (ratio >= 0.6) return 36;
	if (ratio >= 0.4) return 22;
	if (ratio >= 0.25) return 10;
	return 0;
}

function scoreAuthorMatch(left: string | null | undefined, right: string | null | undefined) {
	const normalizedLeft = normalizeMergeText(left);
	const normalizedRight = normalizeMergeText(right);
	if (!normalizedLeft || !normalizedRight) return 0;
	if (normalizedLeft === normalizedRight) return 38;
	if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 18;
	return 0;
}

export function rankSimilarCandidate(args: {
	anchor: DiscoverySnapshot;
	candidate: DiscoverySnapshot;
	edge: DiscoveryEdgeWeights;
	preferredLanguages?: string[];
	now?: number;
}) {
	return rankSimilarCandidateBreakdown(args).total;
}

export function rankSimilarCandidateBreakdown(args: {
	anchor: DiscoverySnapshot;
	candidate: DiscoverySnapshot;
	edge: DiscoveryEdgeWeights;
	preferredLanguages?: string[];
	now?: number;
}): DiscoveryRankBreakdown {
	const preferredLanguages = new Set(
		(args.preferredLanguages ?? []).map((language) => normalizeMergeText(language)).filter(Boolean)
	);
	const similarity = scoreMergeSnapshot(args.anchor, args.candidate);
	const edgeScore = Math.min(42, args.edge.popularCount * 6 + args.edge.latestCount * 4);
	const freshnessScore = scoreFreshness(args.candidate.lastSeenAt ?? args.edge.lastObservedAt ?? null, args.now);
	const preferredLanguageBonus =
		preferredLanguages.size > 0 &&
		preferredLanguages.has(normalizeMergeText(args.candidate.sourceLang))
			? 18
			: 0;
	const titleBonus = Math.min(52, Math.floor(similarity / 4));
	const authorBonus = scoreAuthorMatch(args.anchor.author, args.candidate.author);
	const genreScore = scoreGenreOverlap(
		args.anchor.genre ?? null,
		args.candidate.genre ?? null
	);
	const descriptionScore = scoreDescriptionOverlap(
		args.anchor.description ?? null,
		args.candidate.description ?? null
	);
	return {
		similarity,
		edgeScore,
		freshnessScore,
		preferredLanguageBonus,
		titleBonus,
		authorBonus,
		genreScore,
		descriptionScore,
		total:
			edgeScore +
			freshnessScore +
			preferredLanguageBonus +
			titleBonus +
			authorBonus +
			genreScore +
			descriptionScore
	};
}

export function scoreSeedWeight(args: {
	statusKey?: string | null;
	userRating?: number | null;
	lastReadAt?: number | null;
	now?: number;
}) {
	const now = args.now ?? Date.now();
	let weight = 1;
	switch (args.statusKey) {
		case 'reading':
			weight += 4;
			break;
		case 'plan_to_read':
			weight += 2;
			break;
		case 'completed':
			weight += 1;
			break;
		case 'on_hold':
			weight += 1;
			break;
		case 'dropped':
			weight -= 1;
			break;
	}

	if (typeof args.userRating === 'number' && Number.isFinite(args.userRating)) {
		weight += Math.max(0, Math.min(5, args.userRating)) * 0.6;
	}

	if (typeof args.lastReadAt === 'number' && Number.isFinite(args.lastReadAt)) {
		const ageMs = Math.max(0, now - args.lastReadAt);
		if (ageMs <= 7 * 24 * 60 * 60 * 1000) {
			weight += 3;
		} else if (ageMs <= 30 * 24 * 60 * 60 * 1000) {
			weight += 1.5;
		}
	}

	return Math.max(0.5, weight);
}

export function rankForYouCandidate(args: {
	seedWeight: number;
	anchor: DiscoverySnapshot;
	candidate: DiscoverySnapshot;
	edge: DiscoveryEdgeWeights;
	preferredLanguages?: string[];
	now?: number;
}) {
	return args.seedWeight * rankSimilarCandidate(args);
}

export function isDiscoverySameWork(anchor: DiscoverySnapshot, candidate: DiscoverySnapshot) {
	return scoreMergeSnapshot(anchor, candidate) >= 190;
}

export function isDiscoveryRecommendationStrong(args: {
	anchor: DiscoverySnapshot;
	candidate: DiscoverySnapshot;
	edge: DiscoveryEdgeWeights;
	preferredLanguages?: string[];
	now?: number;
}) {
	const breakdown = rankSimilarCandidateBreakdown(args);
	if (breakdown.similarity >= 190) {
		return true;
	}
	return (
		breakdown.similarity >= DISCOVERY_MIN_SIMILARITY_SCORE &&
		breakdown.edgeScore >= DISCOVERY_MIN_SIMILAR_EDGE_SCORE &&
		breakdown.total >= DISCOVERY_MIN_SIMILAR_TOTAL_SCORE
	);
}

export function isDiscoveryMetadataRecommendationStrong(args: {
	anchor: DiscoverySnapshot;
	candidate: DiscoverySnapshot;
	preferredLanguages?: string[];
	now?: number;
}) {
	const breakdown = rankSimilarCandidateBreakdown({
		...args,
		edge: EMPTY_DISCOVERY_EDGE
	});
	if (breakdown.similarity >= 190) {
		return true;
	}
	return (
		breakdown.similarity >= DISCOVERY_MIN_SIMILARITY_SCORE &&
		(breakdown.authorBonus > 0 || breakdown.genreScore > 0 || breakdown.descriptionScore > 0) &&
		breakdown.total >= DISCOVERY_MIN_METADATA_TOTAL_SCORE
	);
}

export function scoreFreshness(timestamp: number | null | undefined, now: number = Date.now()) {
	if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
		return 0;
	}
	const ageMs = Math.max(0, now - timestamp);
	if (ageMs <= 3 * 24 * 60 * 60 * 1000) return 36;
	if (ageMs <= 14 * 24 * 60 * 60 * 1000) return 20;
	if (ageMs <= 45 * 24 * 60 * 60 * 1000) return 8;
	return 0;
}
