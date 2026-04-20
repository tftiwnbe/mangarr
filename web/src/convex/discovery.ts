import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { STATUS } from './commands';
import { requireBridgeIdentity } from './bridge_auth';
import { requireOwnedTitle, requireViewerUserId } from './library_shared_access';
import {
	DISCOVERY_FEED_LIMIT,
	DISCOVERY_FOR_YOU_LIMIT,
	DISCOVERY_SCHEDULER_BATCH_SIZE,
	DISCOVERY_SIMILAR_LIMIT,
	DISCOVERY_WARM_MIN_ITEMS,
	EMPTY_DISCOVERY_EDGE,
	buildDiscoveryCanonicalKey,
	buildDiscoveryNormalizedAuthor,
	buildDiscoveryNormalizedTitle,
	computeDiscoveryFailureState,
	computeDiscoveryMetadataFailureState,
	computeDiscoveryMetadataSuccessState,
	computeDiscoverySuccessState,
	discoveryPairKey,
	isDiscoveryMetadataRecommendationStrong,
	isDiscoveryRecommendationStrong,
	isDiscoverySameWork,
	rankForYouCandidate,
	rankSimilarCandidate,
	rankSimilarCandidateBreakdown,
	scoreSeedWeight,
	type DiscoveryFeedType
} from './discovery_shared';
import { normalizeMergeText } from './title_identity';

const DISCOVERY_HYDRATE_CANDIDATE_SCAN_LIMIT = 256;
const DISCOVERY_HYDRATE_BATCH_SIZE = 6;
const DISCOVERY_HYDRATE_MIN_SEEN_COUNT = 1;
const DISCOVERY_HYDRATE_MAX_PER_SOURCE = 2;
const DISCOVERY_SIMILAR_CANDIDATE_SCAN_LIMIT = 256;
const DISCOVERY_SIMILAR_LIBRARY_FALLBACK_LIMIT = 256;
const DISCOVERY_SIMILAR_SOFT_LIBRARY_MIN_SCORE = 24;
const DISCOVERY_FOR_YOU_SEED_LIMIT = 6;
const DISCOVERY_FOR_YOU_CANDIDATE_SCAN_LIMIT = 96;

type DiscoveryItemPayload = {
	canonicalKey: string;
	sourceId: string;
	sourcePkg?: string | null;
	sourceLang?: string | null;
	sourceName?: string | null;
	titleUrl: string;
	title: string;
	description?: string | null;
	coverUrl?: string | null;
	author?: string | null;
	genre?: string | null;
	status?: number | null;
};

type DiscoveryTitleDoc = {
	_id: GenericId<'discoveryTitles'>;
	canonicalKey: string;
	sourceId: string;
	sourcePkg?: string;
	sourceLang?: string;
	sourceName?: string;
	titleUrl: string;
	title: string;
	normalizedTitle: string;
	normalizedAuthor?: string;
	description?: string;
	coverUrl?: string;
	author?: string;
	genre?: string;
	status?: number;
	popularSeenCount: number;
	latestSeenCount: number;
	firstSeenAt: number;
	lastSeenAt: number;
	lastPopularSeenAt?: number;
	lastLatestSeenAt?: number;
	detailsHydratedAt?: number;
	detailsNextHydrateAt?: number;
	detailsLastErrorAt?: number;
	detailsFailureCount?: number;
	createdAt: number;
	updatedAt: number;
};

function sanitizeDiscoveryItem(item: DiscoveryItemPayload): DiscoveryItemPayload | null {
	const sourceId = item.sourceId.trim();
	const titleUrl = item.titleUrl.trim();
	const title = item.title.trim();
	if (!sourceId || !titleUrl || !title) {
		return null;
	}
	return {
		canonicalKey: (item.canonicalKey?.trim() || buildDiscoveryCanonicalKey(sourceId, titleUrl)).trim(),
		sourceId,
		sourcePkg: item.sourcePkg?.trim() || undefined,
		sourceLang: item.sourceLang?.trim() || undefined,
		sourceName: item.sourceName?.trim() || undefined,
		titleUrl,
		title,
		description: item.description?.trim() || undefined,
		coverUrl: item.coverUrl?.trim() || undefined,
		author: item.author?.trim() || undefined,
		genre: item.genre?.trim() || undefined,
		status: typeof item.status === 'number' && Number.isFinite(item.status) ? item.status : undefined
	};
}

async function getPreferredContentLanguages(ctx: QueryCtx | MutationCtx) {
	const installation = await ctx.db
		.query('installation')
		.withIndex('by_key', (q) => q.eq('key', 'main'))
		.unique();
	return (installation?.preferredContentLanguages ?? []).map((language) => language.trim()).filter(Boolean);
}

async function listDiscoverySources(ctx: MutationCtx | QueryCtx) {
	const [installation, extensions] = await Promise.all([
		ctx.db
			.query('installation')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique(),
		ctx.db.query('installedExtensions').collect()
	]);
	const preferredLanguages = new Set(
		(installation?.preferredContentLanguages ?? []).map((language) => normalizeMergeText(language)).filter(Boolean)
	);

	return extensions
		.flatMap((extension) =>
			(extension.sources ?? [])
				.filter((source) => source.enabled !== false)
				.map((source) => ({
					id: source.id,
					name: source.name,
					lang: source.lang,
					supportsLatest: source.supportsLatest,
					sourcePkg: extension.pkg
				}))
		)
		.filter((source) => {
			if (preferredLanguages.size === 0) return true;
			return preferredLanguages.has(normalizeMergeText(source.lang));
		})
		.sort((left, right) => left.id.localeCompare(right.id));
}

async function ensureDiscoveryCrawlStateRows(ctx: MutationCtx, now: number) {
	const sources = await listDiscoverySources(ctx);
	let created = 0;
	for (const source of sources) {
		for (const feedType of (source.supportsLatest ? (['popular', 'latest'] as const) : (['popular'] as const))) {
			const existing = await ctx.db
				.query('discoveryCrawlState')
				.withIndex('by_source_id_feed_type', (q) =>
					q.eq('sourceId', source.id).eq('feedType', feedType)
				)
				.unique();
			if (existing) continue;
			await ctx.db.insert('discoveryCrawlState', {
				sourceId: source.id,
				feedType,
				nextPage: 1,
				dueAt: now,
				lastSuccessAt: undefined,
				lastErrorAt: undefined,
				consecutiveFailures: 0,
				cooldownUntil: undefined,
				createdAt: now,
				updatedAt: now
			});
			created += 1;
		}
	}
	return { sources, created };
}

async function ingestFeedPageCore(
	ctx: MutationCtx,
	args: {
		feedType: DiscoveryFeedType;
		sourceId: string;
		page: number;
		hasNextPage: boolean;
		items: DiscoveryItemPayload[];
		now: number;
		updateCrawlState: boolean;
	}
) {
	const sanitizedItems = args.items.map(sanitizeDiscoveryItem).filter((item): item is DiscoveryItemPayload => item !== null);
	const discoveryIds: GenericId<'discoveryTitles'>[] = [];

	for (const item of sanitizedItems) {
		const existing = (await ctx.db
			.query('discoveryTitles')
			.withIndex('by_source_id_title_url', (q) => q.eq('sourceId', item.sourceId).eq('titleUrl', item.titleUrl))
			.unique()) as DiscoveryTitleDoc | null;

		const patch = {
			canonicalKey: item.canonicalKey,
			title: item.title,
			normalizedTitle: buildDiscoveryNormalizedTitle(item.title),
			...(item.sourcePkg ? { sourcePkg: item.sourcePkg } : {}),
			...(item.sourceLang ? { sourceLang: item.sourceLang } : {}),
			...(item.sourceName ? { sourceName: item.sourceName } : {}),
			...(item.author ? { normalizedAuthor: buildDiscoveryNormalizedAuthor(item.author) } : {}),
			...(item.description ? { description: item.description } : {}),
			...(item.coverUrl ? { coverUrl: item.coverUrl } : {}),
			...(item.author ? { author: item.author } : {}),
			...(item.genre ? { genre: item.genre } : {}),
			...(typeof item.status === 'number' ? { status: item.status } : {}),
			lastSeenAt: args.now,
			popularSeenCount:
				(existing?.popularSeenCount ?? 0) + (args.feedType === 'popular' ? 1 : 0),
			latestSeenCount:
				(existing?.latestSeenCount ?? 0) + (args.feedType === 'latest' ? 1 : 0),
			lastPopularSeenAt:
				args.feedType === 'popular' ? args.now : (existing?.lastPopularSeenAt ?? undefined),
			lastLatestSeenAt:
				args.feedType === 'latest' ? args.now : (existing?.lastLatestSeenAt ?? undefined),
			updatedAt: args.now
		};

		if (existing) {
			await ctx.db.patch(existing._id, patch);
			discoveryIds.push(existing._id);
		} else {
			const createdId = await ctx.db.insert('discoveryTitles', {
				sourceId: item.sourceId,
				titleUrl: item.titleUrl,
				firstSeenAt: args.now,
				createdAt: args.now,
				...patch
			});
			discoveryIds.push(createdId);
		}
	}

	for (let index = 0; index < discoveryIds.length; index += 1) {
		for (let innerIndex = index + 1; innerIndex < discoveryIds.length; innerIndex += 1) {
			const leftId = discoveryIds[index];
			const rightId = discoveryIds[innerIndex];
			const left = await ctx.db.get(leftId);
			const right = await ctx.db.get(rightId);
			if (!left || !right) continue;
			const pairKey = discoveryPairKey(left.canonicalKey, right.canonicalKey);
			const [leftDiscoveryTitleId, rightDiscoveryTitleId] =
				left.canonicalKey <= right.canonicalKey ? [leftId, rightId] : [rightId, leftId];
			const existingEdge = await ctx.db
				.query('discoveryEdges')
				.withIndex('by_pair_key', (q) => q.eq('pairKey', pairKey))
				.unique();
			if (existingEdge) {
				await ctx.db.patch(existingEdge._id, {
					popularCount:
						existingEdge.popularCount + (args.feedType === 'popular' ? 1 : 0),
					latestCount: existingEdge.latestCount + (args.feedType === 'latest' ? 1 : 0),
					lastObservedAt: args.now,
					updatedAt: args.now
				});
			} else {
				await ctx.db.insert('discoveryEdges', {
					pairKey,
					leftDiscoveryTitleId,
					rightDiscoveryTitleId,
					popularCount: args.feedType === 'popular' ? 1 : 0,
					latestCount: args.feedType === 'latest' ? 1 : 0,
					lastObservedAt: args.now,
					createdAt: args.now,
					updatedAt: args.now
				});
			}
		}
	}

	if (args.updateCrawlState) {
		const state = await ctx.db
			.query('discoveryCrawlState')
			.withIndex('by_source_id_feed_type', (q) =>
				q.eq('sourceId', args.sourceId).eq('feedType', args.feedType)
			)
			.unique();
		if (state) {
			await ctx.db.patch(state._id, {
				...computeDiscoverySuccessState({
					feedType: args.feedType,
					page: args.page,
					hasNextPage: args.hasNextPage,
					now: args.now
				}),
				updatedAt: args.now
			});
		}
	}

	return {
		ok: true,
		discoveredCount: sanitizedItems.length
	};
}

async function recordCrawlFailureCore(
	ctx: MutationCtx,
	args: {
		sourceId: string;
		feedType: DiscoveryFeedType;
		message: string;
		retryAfterMs?: number | null;
		now: number;
	}
) {
	const state = await ctx.db
		.query('discoveryCrawlState')
		.withIndex('by_source_id_feed_type', (q) =>
			q.eq('sourceId', args.sourceId).eq('feedType', args.feedType)
		)
		.unique();
	if (!state) {
		return { ok: false };
	}
	await ctx.db.patch(state._id, {
		...computeDiscoveryFailureState({
			now: args.now,
			consecutiveFailures: state.consecutiveFailures,
			retryAfterMs: args.retryAfterMs
		}),
		updatedAt: args.now
	});
	return { ok: true };
}

async function loadImportedLookup(ctx: QueryCtx, ownerUserId: GenericId<'users'>) {
	const [titles, variants] = await Promise.all([
		ctx.db
			.query('libraryTitles')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
			.collect(),
		ctx.db
			.query('titleVariants')
			.withIndex('by_owner_user_id_library_title_id', (q) => q.eq('ownerUserId', ownerUserId))
			.collect()
	]);
	const importedKeys = new Set<string>();
	for (const title of titles) {
		importedKeys.add(buildDiscoveryCanonicalKey(title.sourceId, title.titleUrl));
	}
	for (const variant of variants) {
		importedKeys.add(buildDiscoveryCanonicalKey(variant.sourceId, variant.titleUrl));
	}
	return { titles, variants, importedKeys };
}

async function loadImportedTitlesOnly(ctx: QueryCtx, ownerUserId: GenericId<'users'>) {
	const titles = await ctx.db
		.query('libraryTitles')
		.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
		.collect();
	const importedKeys = new Set<string>();
	for (const title of titles) {
		importedKeys.add(buildDiscoveryCanonicalKey(title.sourceId, title.titleUrl));
	}
	return { titles, importedKeys };
}

function buildImportedDiscoverySets(imported: {
	importedKeys: Set<string>;
	titles: Array<{
		title: string;
		author?: string | null;
	}>;
	variants: Array<{
		title: string;
		author?: string | null;
	}>;
}) {
	const normalizedTitleKeys = new Set<string>();
	for (const snapshot of [...imported.titles, ...imported.variants]) {
		const normalizedTitle = buildDiscoveryNormalizedTitle(snapshot.title);
		if (!normalizedTitle) continue;
		const normalizedAuthor = buildDiscoveryNormalizedAuthor(snapshot.author ?? undefined);
		normalizedTitleKeys.add(normalizedTitle);
		if (normalizedAuthor) {
			normalizedTitleKeys.add(`${normalizedTitle}::${normalizedAuthor}`);
		}
	}
	return {
		importedKeys: imported.importedKeys,
		normalizedTitleKeys
	};
}

function isImportedDiscoveryCandidate(
	candidate: DiscoveryTitleDoc,
	imported: {
		importedKeys: Set<string>;
		normalizedTitleKeys: Set<string>;
	}
) {
	if (imported.importedKeys.has(candidate.canonicalKey)) {
		return true;
	}
	const normalizedTitle = candidate.normalizedTitle || buildDiscoveryNormalizedTitle(candidate.title);
	if (!normalizedTitle) return false;
	if (imported.normalizedTitleKeys.has(normalizedTitle)) {
		return true;
	}
	const normalizedAuthor = candidate.normalizedAuthor || buildDiscoveryNormalizedAuthor(candidate.author);
	return normalizedAuthor
		? imported.normalizedTitleKeys.has(`${normalizedTitle}::${normalizedAuthor}`)
		: false;
}

function mapDiscoveryItem(title: {
	canonicalKey: string;
	sourceId: string;
	sourcePkg?: string | null;
	sourceLang?: string | null;
	sourceName?: string | null;
	titleUrl: string;
	title: string;
	description?: string | null;
	coverUrl?: string | null;
}) {
	return {
		canonicalKey: title.canonicalKey,
		sourceId: title.sourceId,
		sourcePkg: title.sourcePkg ?? '',
		sourceLang: title.sourceLang ?? '',
		sourceName: title.sourceName ?? '',
		titleUrl: title.titleUrl,
		title: title.title,
		description: title.description ?? null,
		coverUrl: title.coverUrl ?? null
	};
}

function mapLibraryTitleAsDiscoveryItem(title: {
	sourceId: string;
	sourcePkg: string;
	sourceLang: string;
	titleUrl: string;
	title: string;
	description?: string;
	coverUrl?: string;
	author?: string;
	genre?: string;
	status?: number;
	lastSeenAt?: number;
}) {
	return {
		canonicalKey: buildDiscoveryCanonicalKey(title.sourceId, title.titleUrl),
		sourceId: title.sourceId,
		sourcePkg: title.sourcePkg,
		sourceLang: title.sourceLang,
		sourceName: undefined,
		titleUrl: title.titleUrl,
		title: title.title,
		description: title.description ?? null,
		coverUrl: title.coverUrl ?? null,
		lastSeenAt: title.lastSeenAt ?? 0
	};
}

async function listFallbackRecentTitles(
	ctx: QueryCtx,
	args: {
		importedKeys: Set<string>;
		importedTitles: Array<{
			title: string;
			author?: string | null;
			sourcePkg?: string | null;
			sourceLang?: string | null;
			titleUrl: string;
		}>;
		importedVariants: Array<{
			title: string;
			author?: string | null;
			sourcePkg?: string | null;
			sourceLang?: string | null;
			titleUrl: string;
		}>;
		preferredLanguages: string[];
		limit: number;
	}
) {
	const preferredLanguages = new Set(args.preferredLanguages.map((language) => normalizeMergeText(language)).filter(Boolean));
	const rows = (await ctx.db
		.query('discoveryTitles')
		.withIndex('by_last_seen_at', (q) => q.gt('lastSeenAt', 0))
		.order('desc')
		.take(Math.max(args.limit * 4, 24))) as DiscoveryTitleDoc[];

	return rows
		.filter(
			(row) =>
				!isImportedDiscoveryCandidate(row, buildImportedDiscoverySets({
					importedKeys: args.importedKeys,
					titles: args.importedTitles,
					variants: args.importedVariants
				}))
		)
		.filter((row) => preferredLanguages.size === 0 || preferredLanguages.has(normalizeMergeText(row.sourceLang)))
		.slice(0, args.limit)
		.map(mapDiscoveryItem);
}

function discoveryHydrationPriority(title: DiscoveryTitleDoc, now: number) {
	const seenScore = title.popularSeenCount * 2 + title.latestSeenCount * 1.5;
	const missingMetadataScore =
		(typeof title.description === 'string' && title.description.trim().length > 80 ? 0 : 5) +
		(typeof title.author === 'string' && title.author.trim().length > 0 ? 0 : 3) +
		(typeof title.genre === 'string' && title.genre.trim().length > 0 ? 0 : 3);
	const freshnessBoost = Math.max(0, 14 - Math.floor((now - title.lastSeenAt) / (24 * 60 * 60 * 1000)));
	return seenScore + missingMetadataScore + freshnessBoost;
}

function shouldHydrateDiscoveryTitle(title: DiscoveryTitleDoc, now: number) {
	if ((title.detailsNextHydrateAt ?? 0) > now) {
		return false;
	}

	const seenCount = title.popularSeenCount + title.latestSeenCount;
	if (seenCount < DISCOVERY_HYDRATE_MIN_SEEN_COUNT) {
		return false;
	}

	const hasEnoughMetadata =
		(typeof title.description === 'string' && title.description.trim().length > 80) &&
		(typeof title.author === 'string' && title.author.trim().length > 0) &&
		(typeof title.genre === 'string' && title.genre.trim().length > 0);
	if (hasEnoughMetadata && title.detailsHydratedAt) {
		return false;
	}

	return true;
}

export const upsertTitleMetadataFromBridge = mutation({
	args: {
		sourceId: v.string(),
		titleUrl: v.string(),
		sourcePkg: v.optional(v.union(v.string(), v.null())),
		sourceLang: v.optional(v.union(v.string(), v.null())),
		sourceName: v.optional(v.union(v.string(), v.null())),
		title: v.string(),
		author: v.optional(v.union(v.string(), v.null())),
		description: v.optional(v.union(v.string(), v.null())),
		coverUrl: v.optional(v.union(v.string(), v.null())),
		genre: v.optional(v.union(v.string(), v.null())),
		status: v.optional(v.float64()),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const title = await ctx.db
			.query('discoveryTitles')
			.withIndex('by_source_id_title_url', (q) =>
				q.eq('sourceId', args.sourceId.trim()).eq('titleUrl', args.titleUrl.trim())
			)
			.unique();
		if (!title) {
			return { ok: false };
		}

		await ctx.db.patch(title._id, {
			sourcePkg: args.sourcePkg ?? title.sourcePkg,
			sourceLang: args.sourceLang ?? title.sourceLang,
			sourceName: args.sourceName ?? title.sourceName,
			title: args.title.trim(),
			normalizedTitle: buildDiscoveryNormalizedTitle(args.title),
			author: args.author?.trim() || undefined,
			normalizedAuthor: buildDiscoveryNormalizedAuthor(args.author ?? undefined),
			description: args.description?.trim() || undefined,
			coverUrl: args.coverUrl?.trim() || undefined,
			genre: args.genre?.trim() || undefined,
			status: args.status ?? undefined,
			...computeDiscoveryMetadataSuccessState(args.now),
			updatedAt: args.now
		});
		return { ok: true };
	}
});

export const recordTitleHydrationFailureFromBridge = mutation({
	args: {
		sourceId: v.string(),
		titleUrl: v.string(),
		retryAfterMs: v.optional(v.float64()),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const title = await ctx.db
			.query('discoveryTitles')
			.withIndex('by_source_id_title_url', (q) =>
				q.eq('sourceId', args.sourceId.trim()).eq('titleUrl', args.titleUrl.trim())
			)
			.unique();
		if (!title) {
			return { ok: false };
		}

		await ctx.db.patch(title._id, {
			...computeDiscoveryMetadataFailureState({
				now: args.now,
				detailsFailureCount: title.detailsFailureCount,
				retryAfterMs: args.retryAfterMs
			}),
			updatedAt: args.now
		});
		return { ok: true };
	}
});

export const ingestFeedPageFromBridge = mutation({
	args: {
		feedType: v.union(v.literal('popular'), v.literal('latest')),
		sourceId: v.string(),
		page: v.float64(),
		hasNextPage: v.boolean(),
		items: v.array(
			v.object({
				canonicalKey: v.string(),
				sourceId: v.string(),
				sourcePkg: v.optional(v.union(v.string(), v.null())),
				sourceLang: v.optional(v.union(v.string(), v.null())),
				sourceName: v.optional(v.union(v.string(), v.null())),
				titleUrl: v.string(),
				title: v.string(),
				description: v.optional(v.union(v.string(), v.null())),
				coverUrl: v.optional(v.union(v.string(), v.null())),
				author: v.optional(v.union(v.string(), v.null())),
				genre: v.optional(v.union(v.string(), v.null()))
			})
		),
		updateCrawlState: v.optional(v.boolean()),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		return ingestFeedPageCore(ctx, {
			feedType: args.feedType,
			sourceId: args.sourceId.trim(),
			page: Math.max(1, Math.floor(args.page)),
			hasNextPage: args.hasNextPage,
			items: args.items,
			now: args.now,
			updateCrawlState: args.updateCrawlState === true
		});
	}
});

export const recordCrawlFailureFromBridge = mutation({
	args: {
		sourceId: v.string(),
		feedType: v.union(v.literal('popular'), v.literal('latest')),
		message: v.string(),
		retryAfterMs: v.optional(v.float64()),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		return recordCrawlFailureCore(ctx, {
			sourceId: args.sourceId.trim(),
			feedType: args.feedType,
			message: args.message,
			retryAfterMs: args.retryAfterMs,
			now: args.now
		});
	}
});

export const listForYou = query({
	args: {
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const ownerUserId = await requireViewerUserId(ctx);
		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? DISCOVERY_FOR_YOU_LIMIT), 48));
		const preferredLanguages = await getPreferredContentLanguages(ctx);
		const statusById = new Map(
			(
				await ctx.db
					.query('libraryUserStatuses')
					.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
					.collect()
			).map((status) => [String(status._id), status] as const)
		);
		const { titles, importedKeys } = await loadImportedTitlesOnly(ctx, ownerUserId);
		const importedSets = buildImportedDiscoverySets({ titles, variants: [], importedKeys });
			const rankedSeeds = titles
				.map((title) => ({
					title,
					weight: scoreSeedWeight({
						statusKey: title.userStatusId ? statusById.get(String(title.userStatusId))?.key : null,
						userRating: title.userRating ?? null,
						lastReadAt: title.lastReadAt ?? null
					})
				}))
				.sort((left, right) => right.weight - left.weight)
				.slice(0, DISCOVERY_FOR_YOU_SEED_LIMIT);

			const aggregate = new Map<
				string,
				{ title: DiscoveryTitleDoc; score: number; matchedSeeds: number }
			>();

			const candidateRows = (await ctx.db
				.query('discoveryTitles')
				.withIndex('by_last_seen_at', (q) => q.gt('lastSeenAt', 0))
				.order('desc')
				.take(DISCOVERY_FOR_YOU_CANDIDATE_SCAN_LIMIT)) as DiscoveryTitleDoc[];

			for (const candidate of candidateRows) {
				if (isImportedDiscoveryCandidate(candidate, importedSets)) continue;
				for (const seed of rankedSeeds) {
					const anchor = {
						title: seed.title.title,
						author: seed.title.author ?? null,
						description: seed.title.description ?? null,
						genre: seed.title.genre ?? null,
						sourcePkg: seed.title.sourcePkg,
						sourceLang: seed.title.sourceLang,
						titleUrl: seed.title.titleUrl
					};
					if (
						isDiscoverySameWork(anchor, {
							title: candidate.title,
							author: candidate.author,
							sourcePkg: candidate.sourcePkg,
							sourceLang: candidate.sourceLang,
							titleUrl: candidate.titleUrl
						})
					) {
						continue;
					}
					if (
						!isDiscoveryMetadataRecommendationStrong({
							anchor,
							candidate,
							preferredLanguages
						})
					) {
						continue;
					}
					const score = rankForYouCandidate({
						seedWeight: seed.weight,
						anchor,
						candidate,
						edge: EMPTY_DISCOVERY_EDGE,
						preferredLanguages
					});
					const existing = aggregate.get(candidate.canonicalKey);
					if (existing) {
						existing.score += score;
						existing.matchedSeeds += 1;
					} else {
						aggregate.set(candidate.canonicalKey, {
							title: candidate,
							score,
							matchedSeeds: 1
						});
					}
				}
			}

		const items = [...aggregate.values()]
			.sort((left, right) => {
				if (left.score !== right.score) return right.score - left.score;
				return right.title.lastSeenAt - left.title.lastSeenAt;
			})
			.slice(0, limit)
			.map((entry) => mapDiscoveryItem(entry.title));

		if (items.length >= limit) {
			return {
				items,
				warming: items.length < DISCOVERY_WARM_MIN_ITEMS
			};
		}

		const fallback = await listFallbackRecentTitles(ctx, {
			importedKeys: new Set([...importedKeys, ...items.map((item) => item.canonicalKey)]),
			importedTitles: titles,
			importedVariants: [],
			preferredLanguages,
			limit: limit - items.length
		});

		return {
			items: [...items, ...fallback],
			warming: items.length < DISCOVERY_WARM_MIN_ITEMS
		};
	}
});

export const listSimilarForLibraryTitle = query({
	args: {
		titleId: v.id('libraryTitles'),
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? DISCOVERY_SIMILAR_LIMIT), 24));
		const preferredLanguages = await getPreferredContentLanguages(ctx);
		const imported = await loadImportedLookup(ctx, title.ownerUserId);
		const importedSets = buildImportedDiscoverySets(imported);
		const anchor = {
			title: title.title,
			author: title.author ?? null,
			description: title.description ?? null,
			genre: title.genre ?? null,
			sourcePkg: title.sourcePkg,
			sourceLang: title.sourceLang,
			titleUrl: title.titleUrl
		};
		const candidateEntries = new Map<
			string,
			{ title: DiscoveryTitleDoc; edge: typeof EMPTY_DISCOVERY_EDGE }
		>();

		const recentCandidates = (await ctx.db
			.query('discoveryTitles')
			.withIndex('by_last_seen_at', (q) => q.gt('lastSeenAt', 0))
			.order('desc')
			.take(DISCOVERY_SIMILAR_CANDIDATE_SCAN_LIMIT)) as DiscoveryTitleDoc[];
		for (const candidate of recentCandidates) {
			if (!candidateEntries.has(candidate.canonicalKey)) {
				candidateEntries.set(candidate.canonicalKey, {
					title: candidate,
					edge: EMPTY_DISCOVERY_EDGE
				});
			}
		}

		const ranked: Array<{
			title: DiscoveryTitleDoc | ReturnType<typeof mapLibraryTitleAsDiscoveryItem>;
			score: number;
			lastSeenAt: number;
		}> = [];
		const softFallback: Array<{
			title: ReturnType<typeof mapLibraryTitleAsDiscoveryItem>;
			score: number;
			lastSeenAt: number;
		}> = [];
		for (const entry of candidateEntries.values()) {
			const candidate = entry.title;
			const edge = entry.edge;
			if (candidate.sourceId === title.sourceId && candidate.titleUrl === title.titleUrl) continue;
			if (isImportedDiscoveryCandidate(candidate, importedSets)) continue;
			if (
				isDiscoverySameWork(anchor, {
					title: candidate.title,
					author: candidate.author,
					sourcePkg: candidate.sourcePkg,
					sourceLang: candidate.sourceLang,
					titleUrl: candidate.titleUrl
				})
			) {
				continue;
			}
			const strong =
				edge.popularCount > 0 || edge.latestCount > 0
					? isDiscoveryRecommendationStrong({
							anchor,
							candidate,
							edge,
							preferredLanguages
						})
					: isDiscoveryMetadataRecommendationStrong({
							anchor,
							candidate,
							preferredLanguages
						});
			if (!strong) {
				continue;
			}
			ranked.push({
				title: candidate,
				lastSeenAt: candidate.lastSeenAt,
				score: rankSimilarCandidate({
					anchor,
					candidate,
					edge,
					preferredLanguages
				})
			});
		}

		if (ranked.length < limit) {
			const libraryCandidates = await ctx.db
				.query('libraryTitles')
				.withIndex('by_owner_user_id_updated_at', (q) => q.eq('ownerUserId', title.ownerUserId))
				.order('desc')
				.take(DISCOVERY_SIMILAR_LIBRARY_FALLBACK_LIMIT);
			for (const candidate of libraryCandidates) {
				if (candidate._id === title._id) continue;
				if (
					isDiscoverySameWork(anchor, {
						title: candidate.title,
						author: candidate.author,
						sourcePkg: candidate.sourcePkg,
						sourceLang: candidate.sourceLang,
						titleUrl: candidate.titleUrl
					})
				) {
					continue;
				}
				if (
					!isDiscoveryMetadataRecommendationStrong({
						anchor,
						candidate,
						preferredLanguages
					})
				) {
					const breakdown = rankSimilarCandidateBreakdown({
						anchor,
						candidate,
						edge: EMPTY_DISCOVERY_EDGE,
						preferredLanguages
					});
					if (
						(breakdown.authorBonus > 0 ||
							breakdown.genreScore > 0 ||
							breakdown.descriptionScore > 0) &&
						breakdown.total >= DISCOVERY_SIMILAR_SOFT_LIBRARY_MIN_SCORE
					) {
						softFallback.push({
							title: mapLibraryTitleAsDiscoveryItem(candidate),
							score: breakdown.total,
							lastSeenAt: candidate.updatedAt
						});
					}
					continue;
				}
				ranked.push({
					title: mapLibraryTitleAsDiscoveryItem(candidate),
					lastSeenAt: candidate.updatedAt,
					score: rankSimilarCandidate({
						anchor,
						candidate,
						edge: EMPTY_DISCOVERY_EDGE,
						preferredLanguages
					})
				});
			}
		}

		const finalRanked =
			ranked.length > 0
				? ranked
				: softFallback.filter(
						(entry, index, all) =>
							all.findIndex((candidate) => candidate.title.canonicalKey === entry.title.canonicalKey) ===
							index
					);

		return {
			items: finalRanked
				.sort((left, right) => {
					if (left.score !== right.score) return right.score - left.score;
					return right.lastSeenAt - left.lastSeenAt;
				})
				.slice(0, limit)
				.map((entry) => ({ ...mapDiscoveryItem(entry.title), score: entry.score })),
			warming: finalRanked.length < DISCOVERY_WARM_MIN_ITEMS
		};
	}
});

export const resetCatalog = mutation({
	args: {
		holdMs: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		const holdUntil = now + Math.max(0, Math.floor(args.holdMs ?? 0));
		const edges = await ctx.db.query('discoveryEdges').take(128);
		for (const edge of edges) {
			await ctx.db.delete(edge._id);
		}
		const titles = await ctx.db.query('discoveryTitles').take(128);
		for (const title of titles) {
			await ctx.db.delete(title._id);
		}
		const crawlStates = await ctx.db.query('discoveryCrawlState').collect();
		for (const state of crawlStates) {
			await ctx.db.patch(state._id, {
				nextPage: 1,
				dueAt: holdUntil,
				lastSuccessAt: undefined,
				lastErrorAt: undefined,
				consecutiveFailures: 0,
				cooldownUntil: holdUntil > now ? holdUntil : undefined,
				updatedAt: now
			});
		}

		return {
			ok: true,
			deletedEdges: edges.length,
			deletedTitles: titles.length,
			resetStates: crawlStates.length
		};
	}
});

export const resumeCatalogCrawl = mutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const crawlStates = await ctx.db.query('discoveryCrawlState').collect();
		for (const state of crawlStates) {
			await ctx.db.patch(state._id, {
				dueAt: now,
				cooldownUntil: undefined,
				updatedAt: now
			});
		}
		return {
			ok: true,
			resumedStates: crawlStates.length
		};
	}
});

export const retryFailedHydrationsNow = mutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const titles = (await ctx.db
			.query('discoveryTitles')
			.withIndex('by_last_seen_at', (q) => q.gt('lastSeenAt', 0))
			.order('desc')
			.take(1024)) as DiscoveryTitleDoc[];
		let reset = 0;
		for (const title of titles) {
			if ((title.detailsFailureCount ?? 0) <= 0 && (title.detailsNextHydrateAt ?? 0) <= now) {
				continue;
			}
			await ctx.db.patch(title._id, {
				detailsNextHydrateAt: now,
				detailsLastErrorAt: undefined,
				detailsFailureCount: 0,
				updatedAt: now
			});
			reset += 1;
		}
		return {
			ok: true,
			reset
		};
	}
});

export const runScheduler = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const { created } = await ensureDiscoveryCrawlStateRows(ctx, now);
		const dueStates = await ctx.db
			.query('discoveryCrawlState')
			.withIndex('by_due_at', (q) => q.lte('dueAt', now))
			.order('asc')
			.take(32);

		let enqueuedFeeds = 0;
		for (const state of dueStates) {
			if (enqueuedFeeds >= DISCOVERY_SCHEDULER_BATCH_SIZE) break;
			const activeCommands = await ctx.db
				.query('commands')
				.withIndex('by_idempotency_key', (q) =>
					q.eq('idempotencyKey', `discovery.feed.crawl:${state.sourceId}:${state.feedType}:${state.nextPage}`)
				)
				.collect();
			const hasActive = activeCommands.some((command) =>
				command.status === STATUS.QUEUED ||
				command.status === STATUS.LEASED ||
				command.status === STATUS.RUNNING
			);
			if (hasActive) continue;
			await ctx.db.insert('commands', {
				commandType: 'discovery.feed.crawl',
				targetCapability: 'discovery.feed',
				requestedByUserId: undefined,
				payload: {
					sourceId: state.sourceId,
					feedType: state.feedType,
					page: state.nextPage,
					limit: DISCOVERY_FEED_LIMIT
				},
				idempotencyKey: `discovery.feed.crawl:${state.sourceId}:${state.feedType}:${state.nextPage}`,
				status: STATUS.QUEUED,
				priority: 250,
				runAfter: now,
				attemptCount: 0,
				maxAttempts: 3,
				createdAt: now,
				updatedAt: now
			});
			enqueuedFeeds += 1;
		}

		const recentTitles = (await ctx.db
			.query('discoveryTitles')
			.withIndex('by_last_seen_at', (q) => q.gt('lastSeenAt', 0))
			.order('desc')
			.take(DISCOVERY_HYDRATE_CANDIDATE_SCAN_LIMIT)) as DiscoveryTitleDoc[];

		let enqueuedHydrations = 0;
		const hydrationCountsBySource = new Map<string, number>();
		for (const title of recentTitles
			.filter((item) => shouldHydrateDiscoveryTitle(item, now))
			.sort((left, right) => discoveryHydrationPriority(right, now) - discoveryHydrationPriority(left, now))) {
			if (enqueuedHydrations >= DISCOVERY_HYDRATE_BATCH_SIZE) break;
			const sourceHydrations = hydrationCountsBySource.get(title.sourceId) ?? 0;
			if (sourceHydrations >= DISCOVERY_HYDRATE_MAX_PER_SOURCE) continue;

			const idempotencyKey = `discovery.title.hydrate:${title.sourceId}:${title.titleUrl}`;
			const activeCommands = await ctx.db
				.query('commands')
				.withIndex('by_idempotency_key', (q) => q.eq('idempotencyKey', idempotencyKey))
				.collect();
			const hasActive = activeCommands.some((command) =>
				command.status === STATUS.QUEUED ||
				command.status === STATUS.LEASED ||
				command.status === STATUS.RUNNING
			);
			if (hasActive) continue;

			await ctx.db.insert('commands', {
				commandType: 'discovery.title.hydrate',
				targetCapability: 'discovery.metadata',
				requestedByUserId: undefined,
				payload: {
					sourceId: title.sourceId,
					titleUrl: title.titleUrl
				},
				idempotencyKey,
				status: STATUS.QUEUED,
				priority: 180,
				runAfter: now,
				attemptCount: 0,
				maxAttempts: 3,
				createdAt: now,
				updatedAt: now
			});
			hydrationCountsBySource.set(title.sourceId, sourceHydrations + 1);
			enqueuedHydrations += 1;
		}

		return {
			createdStates: created,
			enqueuedFeeds,
			enqueuedHydrations
		};
	}
});
