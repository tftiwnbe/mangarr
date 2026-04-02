import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireBridgeIdentity } from './bridge_auth';

const REUSABLE_COMMAND_STATUSES = new Set(['queued', 'succeeded']);

export const getExploreTitlePreview = query({
	args: {
		sourceId: v.string(),
		titleUrl: v.string()
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return null;
		}

		const cached = await ctx.db
			.query('exploreTitleDetailsCache')
			.withIndex('by_source_id_title_url', (q) =>
				q.eq('sourceId', args.sourceId.trim()).eq('titleUrl', args.titleUrl.trim())
			)
			.unique();
		if (!cached) {
			return null;
		}

		return {
			sourceId: cached.sourceId,
			titleUrl: cached.titleUrl,
			sourcePkg: cached.sourcePkg ?? null,
			sourceLang: cached.sourceLang ?? null,
			title: cached.title,
			author: cached.author ?? null,
			artist: cached.artist ?? null,
			description: cached.description ?? null,
			coverUrl: cached.coverUrl ?? null,
			genre: cached.genre ?? null,
			status: cached.status ?? null,
			fetchedAt: cached.fetchedAt
		};
	}
});

export const ensureTitleMetadata = mutation({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const commandId = await ensureMetadataForTitle(ctx, title, Date.now());
		return {
			commandId,
			enqueued: commandId !== null
		};
	}
});

export const ensureTitleReady = mutation({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const now = Date.now();
		const [metadataCommandId, chapterSyncCommandId] = await Promise.all([
			ensureMetadataForTitle(ctx, title, now),
			ensureChapterSyncForTitle(ctx, title, now)
		]);

		return {
			enqueued: Number(metadataCommandId !== null) + Number(chapterSyncCommandId !== null),
			metadataCommandId,
			chapterSyncCommandId
		};
	}
});

export const beginTitleOpen = mutation({
	args: {
		canonicalKey: v.string(),
		sourceId: v.string(),
		sourcePkg: v.string(),
		sourceLang: v.string(),
		titleUrl: v.string()
	},
	handler: async (ctx, args) => {
		const ownerUserId = await requireViewerUserId(ctx);
		const existingTitle = await findOwnedTitleForOpen(ctx, ownerUserId, {
			canonicalKey: args.canonicalKey,
			sourceId: args.sourceId,
			titleUrl: args.titleUrl
		});
		if (existingTitle) {
			const hasChapters =
				(
					await ctx.db
						.query('libraryChapters')
						.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', existingTitle._id))
						.take(1)
				).length > 0;
			return {
				state: hasChapters ? ('ready' as const) : ('syncing' as const),
				titleId: existingTitle._id,
				title: existingTitle.title,
				commandId: null
			};
		}

		const now = Date.now();
		const idempotencyKey = `library.import:${args.canonicalKey}:${args.sourceId}:${args.titleUrl}`;
		const reusable = await ctx.db
			.query('commands')
			.withIndex('by_idempotency_key', (q) => q.eq('idempotencyKey', idempotencyKey))
			.collect();
		const reusableCommand = reusable
			.filter((command) => command.requestedByUserId === ownerUserId)
			.sort((left, right) => right.createdAt - left.createdAt)
			.find((command) => REUSABLE_COMMAND_STATUSES.has(command.status));
		if (reusableCommand) {
			return {
				state: 'importing' as const,
				titleId: null,
				title: null,
				commandId: reusableCommand._id
			};
		}

		const commandId = await ctx.db.insert('commands', {
			commandType: 'library.import',
			targetCapability: 'library.import',
			requestedByUserId: ownerUserId,
			payload: {
				canonicalKey: args.canonicalKey,
				sourceId: args.sourceId,
				sourcePkg: args.sourcePkg,
				sourceLang: args.sourceLang,
				titleUrl: args.titleUrl
			},
			idempotencyKey,
			status: 'queued',
			priority: 100,
			runAfter: now,
			attemptCount: 0,
			maxAttempts: 3,
			createdAt: now,
			updatedAt: now
		});

		return {
			state: 'importing' as const,
			titleId: null,
			title: null,
			commandId
		};
	}
});

export const ensureTitlesMetadata = mutation({
	args: {
		titleIds: v.array(v.id('libraryTitles')),
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const userId = await requireViewerUserId(ctx);
		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 20), 100));
		const now = Date.now();
		const commandIds: GenericId<'commands'>[] = [];

		for (const titleId of args.titleIds.slice(0, limit)) {
			const title = await ctx.db.get(titleId);
			if (!title || title.ownerUserId !== userId) {
				continue;
			}
			const commandId = await ensureMetadataForTitle(ctx, title, now);
			if (commandId) {
				commandIds.push(commandId);
			}
		}

		return {
			enqueued: commandIds.length,
			commandIds
		};
	}
});

export const ensureTitleCoverCache = mutation({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const commandId = await ensureCoverCacheForTitle(ctx, title, Date.now());
		return {
			commandId,
			enqueued: commandId !== null
		};
	}
});

export const ensureTitlesCoverCache = mutation({
	args: {
		titleIds: v.array(v.id('libraryTitles')),
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const userId = await requireViewerUserId(ctx);
		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 20), 100));
		const now = Date.now();
		const commandIds: GenericId<'commands'>[] = [];

		for (const titleId of args.titleIds.slice(0, limit)) {
			const title = await ctx.db.get(titleId);
			if (!title || title.ownerUserId !== userId) {
				continue;
			}
			const commandId = await ensureCoverCacheForTitle(ctx, title, now);
			if (commandId) {
				commandIds.push(commandId);
			}
		}

		return {
			enqueued: commandIds.length,
			commandIds
		};
	}
});

export const ensureTitlesOfflineReady = mutation({
	args: {
		titleIds: v.array(v.id('libraryTitles')),
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const userId = await requireViewerUserId(ctx);
		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 20), 100));
		const now = Date.now();
		const commandIds: GenericId<'commands'>[] = [];

		for (const titleId of args.titleIds.slice(0, limit)) {
			const title = await ctx.db.get(titleId);
			if (!title || title.ownerUserId !== userId) {
				continue;
			}
			for (const commandId of [
				await ensureMetadataForTitle(ctx, title, now),
				await ensureCoverCacheForTitle(ctx, title, now),
				await ensureChapterSyncForTitle(ctx, title, now)
			]) {
				if (commandId) {
					commandIds.push(commandId);
				}
			}
		}

		return {
			enqueued: commandIds.length,
			commandIds
		};
	}
});

export const upsertTitleMetadataFromBridge = mutation({
	args: {
		sourceId: v.string(),
		titleUrl: v.string(),
		sourcePkg: v.optional(v.union(v.string(), v.null())),
		sourceLang: v.optional(v.union(v.string(), v.null())),
		title: v.string(),
		author: v.optional(v.union(v.string(), v.null())),
		artist: v.optional(v.union(v.string(), v.null())),
		description: v.optional(v.union(v.string(), v.null())),
		coverUrl: v.optional(v.union(v.string(), v.null())),
		genre: v.optional(v.union(v.string(), v.null())),
		status: v.optional(v.float64()),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const sourcePkg = args.sourcePkg ?? undefined;
		const sourceLang = args.sourceLang ?? undefined;
		const author = args.author ?? undefined;
		const artist = args.artist ?? undefined;
		const description = args.description ?? undefined;
		const coverUrl = args.coverUrl ?? undefined;
		const genre = args.genre ?? undefined;

		const existingCache = await ctx.db
			.query('exploreTitleDetailsCache')
			.withIndex('by_source_id_title_url', (q) =>
				q.eq('sourceId', args.sourceId).eq('titleUrl', args.titleUrl)
			)
			.unique();

		if (existingCache) {
			await ctx.db.patch(existingCache._id, {
				sourcePkg,
				sourceLang,
				title: args.title,
				author,
				artist,
				description,
				coverUrl,
				genre,
				status: args.status,
				fetchedAt: args.now,
				updatedAt: args.now
			});
		} else {
			await ctx.db.insert('exploreTitleDetailsCache', {
				sourceId: args.sourceId,
				titleUrl: args.titleUrl,
				sourcePkg,
				sourceLang,
				title: args.title,
				author,
				artist,
				description,
				coverUrl,
				genre,
				status: args.status,
				fetchedAt: args.now,
				createdAt: args.now,
				updatedAt: args.now
			});
		}

		const matchingVariants = await ctx.db
			.query('titleVariants')
			.withIndex('by_source_id_title_url', (q) =>
				q.eq('sourceId', args.sourceId).eq('titleUrl', args.titleUrl)
			)
			.collect();
		const matchingVariantIds = new Set<string>();
		const matchingTitleIds = new Set<string>();

		for (const variant of matchingVariants) {
			matchingVariantIds.add(String(variant._id));
			matchingTitleIds.add(String(variant.libraryTitleId));
			await ctx.db.patch(variant._id, {
				sourcePkg: sourcePkg ?? variant.sourcePkg,
				sourceLang: sourceLang ?? variant.sourceLang,
				title: args.title,
				author,
				artist,
				description,
				coverUrl,
				genre,
				status: args.status,
				updatedAt: args.now,
				lastSyncedAt: args.now
			});
		}

		const directTitles = await ctx.db
			.query('libraryTitles')
			.withIndex('by_source_id_title_url', (q) =>
				q.eq('sourceId', args.sourceId).eq('titleUrl', args.titleUrl)
			)
			.collect();

		for (const title of directTitles) {
			matchingTitleIds.add(String(title._id));
			await ctx.db.patch(title._id, {
				title: args.title,
				sourcePkg: sourcePkg ?? title.sourcePkg,
				sourceLang: sourceLang ?? title.sourceLang,
				author,
				artist,
				description,
				coverUrl,
				genre,
				status: args.status,
				updatedAt: args.now
			});
		}

		for (const titleId of matchingTitleIds) {
			const title = await ctx.db.get(titleId as GenericId<'libraryTitles'>);
			if (!title || title.preferredVariantId == null) {
				continue;
			}
			if (!matchingVariantIds.has(String(title.preferredVariantId))) {
				continue;
			}

			await applyVariantSnapshotToTitle(ctx, title._id, {
				sourceId: args.sourceId,
				sourcePkg: sourcePkg ?? title.sourcePkg,
				sourceLang: sourceLang ?? title.sourceLang,
				titleUrl: args.titleUrl,
				title: args.title,
				author,
				artist,
				description,
				coverUrl,
				genre,
				status: args.status,
				preferredVariantId: title.preferredVariantId,
				now: args.now
			});
		}

		return {
			ok: true,
			matchedVariants: matchingVariants.length,
			matchedTitles: matchingTitleIds.size
		};
	}
});

async function ensureMetadataForTitle(
	ctx: MutationCtx,
	title: DocLike<'libraryTitles'>,
	now: number
) {
	if (!isTitleMetadataIncomplete(title)) {
		return null;
	}

	const existingCache = await ctx.db
		.query('exploreTitleDetailsCache')
		.withIndex('by_source_id_title_url', (q) =>
			q.eq('sourceId', title.sourceId).eq('titleUrl', title.titleUrl)
		)
		.unique();
	if (existingCache) {
		return null;
	}

	const userId = title.ownerUserId;
	const idempotencyKey = `library.metadata:${String(title._id)}:${title.sourceId}:${title.titleUrl}`;
	const reusable = await ctx.db
		.query('commands')
		.withIndex('by_idempotency_key', (q) => q.eq('idempotencyKey', idempotencyKey))
		.collect();
	const existingCommand = reusable
		.filter((command) => command.requestedByUserId === userId)
		.sort((left, right) => right.createdAt - left.createdAt)
		.find((command) => REUSABLE_COMMAND_STATUSES.has(command.status));
	if (existingCommand) {
		return existingCommand._id;
	}

	return ctx.db.insert('commands', {
		commandType: 'explore.title.fetch',
		targetCapability: 'explore.title.fetch',
		requestedByUserId: userId,
		payload: {
			sourceId: title.sourceId,
			titleUrl: title.titleUrl
		},
		idempotencyKey,
		status: 'queued',
		priority: 90,
		runAfter: now,
		attemptCount: 0,
		maxAttempts: 3,
		createdAt: now,
		updatedAt: now
	});
}

async function findOwnedTitleForOpen(
	ctx: MutationCtx,
	ownerUserId: GenericId<'users'>,
	args: {
		canonicalKey: string;
		sourceId: string;
		titleUrl: string;
	}
) {
	const canonicalKey = args.canonicalKey.trim();
	if (canonicalKey) {
		const byCanonical = await ctx.db
			.query('libraryTitles')
			.withIndex('by_owner_user_id_canonical_key', (q) =>
				q.eq('ownerUserId', ownerUserId).eq('canonicalKey', canonicalKey)
			)
			.unique();
		if (byCanonical) {
			return byCanonical;
		}
	}

	const sourceId = args.sourceId.trim();
	const titleUrl = args.titleUrl.trim();
	if (!sourceId || !titleUrl) {
		return null;
	}

	const variant = await ctx.db
		.query('titleVariants')
		.withIndex('by_owner_user_id_source_id_title_url', (q) =>
			q.eq('ownerUserId', ownerUserId).eq('sourceId', sourceId).eq('titleUrl', titleUrl)
		)
		.unique();
	if (!variant) {
		return null;
	}

	const title = await ctx.db.get(variant.libraryTitleId);
	if (!title || title.ownerUserId !== ownerUserId) {
		return null;
	}
	return title;
}

async function ensureChapterSyncForTitle(
	ctx: MutationCtx,
	title: DocLike<'libraryTitles'>,
	now: number
) {
	const existingChapters = await ctx.db
		.query('libraryChapters')
		.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
		.take(1);
	if (existingChapters.length > 0) {
		return null;
	}

	const sourceId = title.sourceId.trim();
	const titleUrl = title.titleUrl.trim();
	if (!sourceId || !titleUrl) {
		return null;
	}

	const idempotencyKey = `library.chapters.sync:${String(title._id)}:${sourceId}:${titleUrl}`;
	const reusable = await ctx.db
		.query('commands')
		.withIndex('by_idempotency_key', (q) => q.eq('idempotencyKey', idempotencyKey))
		.collect();
	const existingCommand = reusable
		.filter((command) => command.requestedByUserId === title.ownerUserId)
		.sort((left, right) => right.createdAt - left.createdAt)
		.find((command) => REUSABLE_COMMAND_STATUSES.has(command.status));
	if (existingCommand) {
		return existingCommand._id;
	}

	return ctx.db.insert('commands', {
		commandType: 'library.chapters.sync',
		targetCapability: 'library.chapters.sync',
		requestedByUserId: title.ownerUserId,
		payload: {
			titleId: title._id,
			sourceId,
			titleUrl
		},
		idempotencyKey,
		status: 'queued',
		priority: 95,
		runAfter: now,
		attemptCount: 0,
		maxAttempts: 3,
		createdAt: now,
		updatedAt: now
	});
}

async function ensureCoverCacheForTitle(
	ctx: MutationCtx,
	title: DocLike<'libraryTitles'>,
	now: number
) {
	if ((title.localCoverPath ?? '').trim()) {
		return null;
	}

	const coverUrl = (title.coverUrl ?? '').trim();
	if (!coverUrl) {
		return null;
	}

	const idempotencyKey = `library.cover.cache:${String(title._id)}:${coverUrl}`;
	const reusable = await ctx.db
		.query('commands')
		.withIndex('by_idempotency_key', (q) => q.eq('idempotencyKey', idempotencyKey))
		.collect();
	const existingCommand = reusable
		.filter((command) => command.requestedByUserId === title.ownerUserId)
		.sort((left, right) => right.createdAt - left.createdAt)
		.find((command) => REUSABLE_COMMAND_STATUSES.has(command.status));
	if (existingCommand) {
		return existingCommand._id;
	}

	return ctx.db.insert('commands', {
		commandType: 'library.cover.cache',
		targetCapability: 'library.cover.cache',
		requestedByUserId: title.ownerUserId,
		payload: {
			titleId: title._id,
			sourceId: title.sourceId,
			coverUrl
		},
		idempotencyKey,
		status: 'queued',
		priority: 80,
		runAfter: now,
		attemptCount: 0,
		maxAttempts: 3,
		createdAt: now,
		updatedAt: now
	});
}

function isTitleMetadataIncomplete(title: {
	author?: string;
	artist?: string;
	description?: string;
	genre?: string;
	status?: number;
}) {
	return (
		![title.author, title.artist, title.description, title.genre].every(
			(value) => typeof value === 'string' && value.trim().length > 0
		) || !Number(title.status ?? 0)
	);
}

async function requireOwnedTitle(ctx: QueryCtx | MutationCtx, titleId: GenericId<'libraryTitles'>) {
	const identity = await requireViewerIdentity(ctx);
	const title = await ctx.db.get(titleId);
	if (!title || title.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Library title not found');
	}

	return title;
}

async function requireViewerIdentity(ctx: QueryCtx | MutationCtx) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new Error('Not authenticated');
	}
	return identity;
}

async function requireViewerUserId(ctx: QueryCtx | MutationCtx) {
	const identity = await requireViewerIdentity(ctx);
	return identity.subject as GenericId<'users'>;
}

async function applyVariantSnapshotToTitle(
	ctx: MutationCtx,
	titleId: GenericId<'libraryTitles'>,
	args: {
		sourceId: string;
		sourcePkg: string;
		sourceLang: string;
		titleUrl: string;
		title: string;
		author?: string;
		artist?: string;
		description?: string;
		coverUrl?: string;
		genre?: string;
		status?: number;
		preferredVariantId?: GenericId<'titleVariants'>;
		now: number;
	}
) {
	await ctx.db.patch(titleId, {
		title: args.title,
		sourceId: args.sourceId,
		sourcePkg: args.sourcePkg,
		sourceLang: args.sourceLang,
		titleUrl: args.titleUrl,
		author: args.author,
		artist: args.artist,
		description: args.description,
		coverUrl: args.coverUrl,
		genre: args.genre,
		status: args.status,
		preferredVariantId: args.preferredVariantId,
		updatedAt: args.now
	});
}

type DocLike<TableName extends keyof import('./_generated/dataModel').DataModel> =
	import('./_generated/dataModel').Doc<TableName>;
