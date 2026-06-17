import { normalizeMergeText, scoreMergeSnapshot } from './title_identity';

export const DISCOVERY_FEED_LIMIT = 24;
export const DISCOVERY_POPULAR_MAX_PAGE = 100;
export const DISCOVERY_LATEST_MAX_PAGE = 6;
export const DISCOVERY_SCHEDULER_BATCH_SIZE = 2;
export const DISCOVERY_WARM_MIN_ITEMS = 3;
export const DISCOVERY_FOR_YOU_LIMIT = 24;
export const DISCOVERY_SIMILAR_LIMIT = 12;
export const DISCOVERY_MIN_SIMILARITY_SCORE = 44;
export const DISCOVERY_MIN_SIMILAR_EDGE_SCORE = 12;
export const DISCOVERY_MIN_SIMILAR_TOTAL_SCORE = 82;
export const DISCOVERY_MIN_METADATA_TOTAL_SCORE = 62;
export const DISCOVERY_POPULAR_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DISCOVERY_LATEST_INTERVAL_MS = 8 * 60 * 60 * 1000;
export const DISCOVERY_FAILURE_BASE_DELAY_MS = 60 * 60 * 1000;
export const DISCOVERY_FAILURE_MAX_DELAY_MS = 24 * 60 * 60 * 1000;
export const DISCOVERY_DETAILS_REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

export type DiscoveryFeedType = 'popular' | 'latest';

export type DiscoverySnapshot = {
	title?: string | null;
	author?: string | null;
	artist?: string | null;
	description?: string | null;
	genre?: string | null;
	sourceId?: string | null;
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
	const dueAt = Math.max(
		args.now + exponentialDelay,
		args.now + Math.max(0, args.retryAfterMs ?? 0)
	);
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

const DESCRIPTION_STOP_TOKENS = new Set([
	'the',
	'and',
	'that',
	'with',
	'from',
	'into',
	'about',
	'after',
	'before',
	'while',
	'where',
	'when',
	'theirs',
	'their',
	'there',
	'this',
	'have',
	'been',
	'will',
	'then',
	'than',
	'they',
	'them',
	'into',
	'over',
	'under',
	'through',
	'story',
	'manga',
	'comic',
	'manhwa',
	'manhua'
]);

function splitRecommendationTokens(
	value: string | null | undefined,
	options?: { minLength?: number; stopTokens?: Set<string> }
) {
	const minLength = options?.minLength ?? 3;
	const stopTokens = options?.stopTokens ?? new Set<string>();
	return [
		...new Set(
			normalizeMergeText(value)
				.split(/[\s,/|;:.!?()[\]{}'"`-]+/)
				.map((token) => token.trim())
				.filter((token) => token.length >= minLength && !stopTokens.has(token))
		)
	];
}

function tokenSetOverlap(leftTokens: string[], rightTokens: string[]) {
	if (leftTokens.length === 0 || rightTokens.length === 0) {
		return { overlapCount: 0, overlapRatio: 0, coverage: 0 };
	}
	const left = new Set(leftTokens);
	const right = new Set(rightTokens);
	let overlapCount = 0;
	for (const token of left) {
		if (right.has(token)) {
			overlapCount += 1;
		}
	}
	return {
		overlapCount,
		overlapRatio: overlapCount / Math.max(left.size, right.size),
		coverage: overlapCount / Math.min(left.size, right.size)
	};
}

function stripTitleTail(value: string | null | undefined) {
	const normalized = normalizeMergeText(value);
	if (!normalized) return '';
	return normalized
		.replace(
			/\b(side story|sidestory|special|extra|oneshot|one shot|season \d+|part \d+|volume \d+)\b/g,
			' '
		)
		.replace(/\s+/g, ' ')
		.trim();
}

function scoreTitleSimilarity(left: string | null | undefined, right: string | null | undefined) {
	const normalizedLeft = normalizeMergeText(left);
	const normalizedRight = normalizeMergeText(right);
	if (!normalizedLeft || !normalizedRight) return 0;
	if (normalizedLeft === normalizedRight) return 120;

	const strippedLeft = stripTitleTail(left);
	const strippedRight = stripTitleTail(right);
	if (
		strippedLeft &&
		strippedLeft === strippedRight &&
		(strippedLeft !== normalizedLeft || strippedRight !== normalizedRight)
	) {
		return 108;
	}

	const leftTokens = splitRecommendationTokens(left);
	const rightTokens = splitRecommendationTokens(right);
	const significantLeftTokens = splitRecommendationTokens(left, { minLength: 4 });
	const significantRightTokens = splitRecommendationTokens(right, { minLength: 4 });
	const allOverlap = tokenSetOverlap(leftTokens, rightTokens);
	const significantOverlap = tokenSetOverlap(significantLeftTokens, significantRightTokens);

	if (
		significantOverlap.overlapCount >= 2 &&
		significantOverlap.coverage >= 1 &&
		significantOverlap.overlapRatio >= 0.75
	) {
		return 100;
	}
	if (
		significantOverlap.overlapCount >= 2 &&
		(strippedLeft.includes(strippedRight) || strippedRight.includes(strippedLeft))
	) {
		return 92;
	}
	if (significantOverlap.overlapCount >= 3 && significantOverlap.overlapRatio >= 0.6) {
		return 82;
	}
	if (allOverlap.overlapCount >= 3 && allOverlap.overlapRatio >= 0.55) {
		return 66;
	}
	if (allOverlap.overlapCount >= 2 && allOverlap.coverage >= 0.66) {
		return 54;
	}
	if (allOverlap.overlapCount >= 2) {
		return 42;
	}
	return 0;
}

function scoreGenreOverlap(left: string | null | undefined, right: string | null | undefined) {
	const ratio = overlapRatio(splitMetadataTokens(left), splitMetadataTokens(right));
	if (ratio >= 0.8) return 42;
	if (ratio >= 0.55) return 26;
	if (ratio >= 0.35) return 14;
	return 0;
}

function scoreAuthorMatch(left: string | null | undefined, right: string | null | undefined) {
	const normalizedLeft = normalizeMergeText(left);
	const normalizedRight = normalizeMergeText(right);
	if (!normalizedLeft || !normalizedRight) return 0;
	if (normalizedLeft === normalizedRight) return 38;
	if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
		return 18;
	return 0;
}

function scoreDescriptionOverlap(
	left: string | null | undefined,
	right: string | null | undefined
) {
	const overlap = tokenSetOverlap(
		splitRecommendationTokens(left, {
			minLength: 4,
			stopTokens: DESCRIPTION_STOP_TOKENS
		}),
		splitRecommendationTokens(right, {
			minLength: 4,
			stopTokens: DESCRIPTION_STOP_TOKENS
		})
	);
	if (overlap.overlapCount >= 8 && overlap.overlapRatio >= 0.28) return 10;
	if (overlap.overlapCount >= 5 && overlap.overlapRatio >= 0.18) return 6;
	if (overlap.overlapCount >= 3 && overlap.overlapRatio >= 0.12) return 3;
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

export function rankSimilarCandidateAcrossAnchors(args: {
	anchors: DiscoverySnapshot[];
	candidate: DiscoverySnapshot;
	edge: DiscoveryEdgeWeights;
	preferredLanguages?: string[];
	now?: number;
}) {
	const anchors = args.anchors.length > 0 ? args.anchors : [{}];
	let best = Number.NEGATIVE_INFINITY;
	for (const anchor of anchors) {
		best = Math.max(
			best,
			rankSimilarCandidate({
				anchor,
				candidate: args.candidate,
				edge: args.edge,
				preferredLanguages: args.preferredLanguages,
				now: args.now
			})
		);
	}
	return Number.isFinite(best) ? best : 0;
}

export function rankSimilarBreakdownAcrossAnchors(args: {
	anchors: DiscoverySnapshot[];
	candidate: DiscoverySnapshot;
	edge: DiscoveryEdgeWeights;
	preferredLanguages?: string[];
	now?: number;
}) {
	const anchors = args.anchors.length > 0 ? args.anchors : [{}];
	let best = rankSimilarCandidateBreakdown({
		anchor: anchors[0] ?? {},
		candidate: args.candidate,
		edge: args.edge,
		preferredLanguages: args.preferredLanguages,
		now: args.now
	});
	for (const anchor of anchors.slice(1)) {
		const breakdown = rankSimilarCandidateBreakdown({
			anchor,
			candidate: args.candidate,
			edge: args.edge,
			preferredLanguages: args.preferredLanguages,
			now: args.now
		});
		if (breakdown.total > best.total) {
			best = breakdown;
		}
	}
	return best;
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
	const titleSimilarity = scoreTitleSimilarity(args.anchor.title, args.candidate.title);
	const genreScore = scoreGenreOverlap(args.anchor.genre ?? null, args.candidate.genre ?? null);
	const descriptionScore = scoreDescriptionOverlap(
		args.anchor.description ?? null,
		args.candidate.description ?? null
	);
	const authorBonus = scoreAuthorMatch(args.anchor.author, args.candidate.author);
	const similarity =
		Math.floor(titleSimilarity * 0.45) +
		Math.floor(genreScore * 1.35) +
		Math.floor(authorBonus * 1.4) +
		descriptionScore;
	const edgeScore = Math.min(42, args.edge.popularCount * 6 + args.edge.latestCount * 4);
	const freshnessScore = scoreFreshness(
		args.candidate.lastSeenAt ?? args.edge.lastObservedAt ?? null,
		args.now
	);
	const preferredLanguageBonus =
		preferredLanguages.size > 0 &&
		preferredLanguages.has(normalizeMergeText(args.candidate.sourceLang))
			? 18
			: 0;
	const titleBonus = Math.min(28, Math.floor(titleSimilarity / 4));
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
		(breakdown.similarity >= DISCOVERY_MIN_SIMILARITY_SCORE &&
			breakdown.edgeScore >= DISCOVERY_MIN_SIMILAR_EDGE_SCORE &&
			breakdown.total >= DISCOVERY_MIN_SIMILAR_TOTAL_SCORE) ||
		(breakdown.edgeScore >= DISCOVERY_MIN_SIMILAR_EDGE_SCORE &&
			(breakdown.authorBonus >= 38 || breakdown.genreScore >= 14) &&
			breakdown.total >= 76)
	);
}

export function isDiscoveryRecommendationStrongAcrossAnchors(args: {
	anchors: DiscoverySnapshot[];
	candidate: DiscoverySnapshot;
	edge: DiscoveryEdgeWeights;
	preferredLanguages?: string[];
	now?: number;
}) {
	const anchors = args.anchors.length > 0 ? args.anchors : [{}];
	return anchors.some((anchor) =>
		isDiscoveryRecommendationStrong({
			anchor,
			candidate: args.candidate,
			edge: args.edge,
			preferredLanguages: args.preferredLanguages,
			now: args.now
		})
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
		(breakdown.similarity >= DISCOVERY_MIN_SIMILARITY_SCORE &&
			(breakdown.genreScore > 0 || (breakdown.authorBonus > 0 && breakdown.similarity >= 56)) &&
			breakdown.total >= DISCOVERY_MIN_METADATA_TOTAL_SCORE) ||
		(((breakdown.authorBonus >= 38 && breakdown.genreScore >= 14) || breakdown.genreScore >= 26) &&
			breakdown.total >= 56)
	);
}

export function isDiscoveryMetadataRecommendationStrongAcrossAnchors(args: {
	anchors: DiscoverySnapshot[];
	candidate: DiscoverySnapshot;
	preferredLanguages?: string[];
	now?: number;
}) {
	const anchors = args.anchors.length > 0 ? args.anchors : [{}];
	return anchors.some((anchor) =>
		isDiscoveryMetadataRecommendationStrong({
			anchor,
			candidate: args.candidate,
			preferredLanguages: args.preferredLanguages,
			now: args.now
		})
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
