import type { GenericId } from 'convex/values';
import { vOnCompleteArgs } from '@convex-dev/workpool';
import { v } from 'convex/values';

import { internal } from './_generated/api';
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
	type MutationCtx
} from './_generated/server';
import type { CommandPayloadMap, CommandType } from './command_payloads';
import { clearSourceHealth, STATUS, upsertSourceHealthFailure } from './command_runtime_shared';
import type { CommandStatus } from './command_runtime_shared';
import { refreshTitleChapterStats } from './library_shared_titles';
import { executorForCommandType, poolForCommandType } from './workpools';

export { STATUS } from './command_runtime_shared';
export type { CommandStatus } from './command_runtime_shared';
const REUSABLE_STATUSES = new Set<CommandStatus>([STATUS.QUEUED, STATUS.SUCCEEDED]);

async function tryClearSourceHealth(
	ctx: MutationCtx,
	command: {
		commandType: string;
		requestedByUserId?: GenericId<'users'>;
		payload: unknown;
	}
) {
	try {
		await clearSourceHealth(ctx, command);
	} catch (error) {
		console.warn('Failed to clear source health after command completion', error);
	}
}

async function tryUpsertSourceHealthFailure(
	ctx: MutationCtx,
	command: {
		commandType: string;
		requestedByUserId?: GenericId<'users'>;
		payload: unknown;
		runAfter: number;
		status: string;
	},
	errorMessage: string,
	now: number
) {
	try {
		await upsertSourceHealthFailure(ctx, command, errorMessage, now);
	} catch (error) {
		console.warn('Failed to record source health failure after command completion', error);
	}
}

function targetCapabilityFor(commandType: string) {
	switch (commandType) {
		case 'extensions.repo.sync':
			return 'extensions.repo';
		case 'extensions.repo.search':
			return 'extensions.repo';
		case 'extensions.install':
			return 'extensions.install';
		case 'extensions.update':
			return 'extensions.install';
		case 'extensions.uninstall':
			return 'extensions.install';
		case 'sources.preferences.fetch':
			return 'sources.preferences';
		case 'sources.preferences.save':
			return 'sources.preferences';
		case 'discovery.feed.crawl':
			return 'discovery.feed';
		case 'discovery.title.hydrate':
			return 'discovery.metadata';
		case 'explore.search':
			return 'explore.search';
		case 'explore.popular':
			return 'explore.feed';
		case 'explore.latest':
			return 'explore.feed';
		case 'explore.title.fetch':
			return 'explore.title.fetch';
		case 'explore.chapters.fetch':
			return 'explore.title.fetch';
		case 'reader.pages.fetch':
			return 'reader.pages.fetch';
		case 'library.chapters.sync':
			return 'library.chapters.sync';
		case 'library.title.stats.refresh':
			return 'library.title.stats.refresh';
		case 'library.import':
			return 'library.import';
		case 'downloads.chapter':
			return 'downloads.chapter';
		default:
			throw new Error(`Unsupported command type: ${commandType}`);
	}
}

function requiresAdmin(commandType: string) {
	switch (commandType) {
		case 'extensions.repo.sync':
		case 'extensions.repo.search':
		case 'extensions.install':
		case 'extensions.update':
		case 'extensions.uninstall':
		case 'sources.preferences.fetch':
		case 'sources.preferences.save':
			return true;
		default:
			return false;
	}
}

function stableKeySegment(value: unknown): string {
	if (value === null || value === undefined) return 'null';
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableKeySegment(item)).join(',')}]`;
	}
	if (typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
			left.localeCompare(right)
		);
		return `{${entries
			.map(([key, entryValue]) => `${key}:${stableKeySegment(entryValue)}`)
			.join(',')}}`;
	}
	return String(value);
}

async function enqueueCommand<T extends CommandType>(
	ctx: MutationCtx,
	args: {
		commandType: T;
		payload: CommandPayloadMap[T];
		idempotencyKey?: string;
		priority?: number;
		maxAttempts?: number;
	}
) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new Error('Not authenticated');
	}
	if (requiresAdmin(args.commandType) && identity.isAdmin !== true && identity.role !== 'admin') {
		throw new Error('Admin privileges are required');
	}
	const now = Date.now();
	const targetCapability = targetCapabilityFor(args.commandType);
	const executor = executorForCommandType(args.commandType);
	const idempotencyKey =
		args.idempotencyKey ??
		`${args.commandType}:${identity.subject}:${now}:${Math.random().toString(36).slice(2, 10)}`;

	if (args.idempotencyKey) {
		const existing = await ctx.db
			.query('commands')
			.withIndex('by_idempotency_key', (q) => q.eq('idempotencyKey', args.idempotencyKey!))
			.order('desc')
			.take(5);

		const reusable = existing
			.filter((row) => row.requestedByUserId === (identity.subject as GenericId<'users'>))
			.find((row) => REUSABLE_STATUSES.has(row.status as CommandStatus));

		if (reusable) {
			return { commandId: reusable._id };
		}
	}

	const commandId = await ctx.db.insert('commands', {
		commandType: args.commandType,
		targetCapability,
		requestedByUserId: identity.subject as GenericId<'users'>,
		payload: args.payload,
		idempotencyKey,
		status: STATUS.QUEUED,
		executor,
		priority: args.priority ?? 100,
		runAfter: now,
		attemptCount: 0,
		maxAttempts: Math.max(1, Math.floor(args.maxAttempts ?? 3)),
		leaseToken: undefined,
		createdAt: now,
		updatedAt: now
	});

	if (executor === 'workpool') {
		const workId = await poolForCommandType(args.commandType).enqueueAction(
			ctx,
			internal.bridge_workpool.executeCommand,
			{ commandId },
			{
				onComplete: internal.commands.handleWorkpoolComplete,
				context: { commandId }
			}
		);
		await ctx.db.patch(commandId, {
			workId,
			updatedAt: Date.now()
		});
	}

	return { commandId };
}

export const enqueue = mutation({
	args: {
		commandType: v.string(),
		payload: v.any(),
		idempotencyKey: v.optional(v.string()),
		priority: v.optional(v.float64()),
		maxAttempts: v.optional(v.float64())
	},
	handler: (ctx, args) =>
		enqueueCommand(ctx, {
			...args,
			commandType: args.commandType as CommandType,
			payload: args.payload as CommandPayloadMap[CommandType]
		})
});

export const enqueueRepositorySync = mutation({
	args: {
		url: v.string()
	},
	handler: (ctx, args) =>
		enqueueCommand(ctx, {
			commandType: 'extensions.repo.sync',
			payload: { url: args.url.trim() },
			idempotencyKey: `extensions.repo.sync:${args.url.trim().toLowerCase()}`
		})
});

export const enqueueRepositorySearch = mutation({
	args: {
		query: v.string(),
		limit: v.optional(v.float64())
	},
	handler: (ctx, args) =>
		enqueueCommand(ctx, {
			commandType: 'extensions.repo.search',
			payload: {
				query: args.query,
				limit: args.limit ?? 5000
			},
			idempotencyKey: `extensions.repo.search:${args.query.trim().toLowerCase()}:${Number(args.limit ?? 5000)}`
		})
});

export const enqueueExtensionInstall = mutation({
	args: {
		pkg: v.string()
	},
	handler: (ctx, args) =>
		enqueueCommand(ctx, {
			commandType: 'extensions.install',
			payload: { pkg: args.pkg.trim() }
		})
});

export const enqueueExtensionUninstall = mutation({
	args: {
		pkg: v.string()
	},
	handler: (ctx, args) =>
		enqueueCommand(ctx, {
			commandType: 'extensions.uninstall',
			payload: { pkg: args.pkg.trim() }
		})
});

export const enqueueSourcePreferencesFetch = mutation({
	args: {
		sourceId: v.string()
	},
	handler: (ctx, args) =>
		enqueueCommand(ctx, {
			commandType: 'sources.preferences.fetch',
			payload: { sourceId: args.sourceId.trim() }
		})
});

export const enqueueSourcePreferencesSave = mutation({
	args: {
		sourceId: v.string(),
		entries: v.array(
			v.object({
				key: v.string(),
				value: v.any()
			})
		)
	},
	handler: (ctx, args) =>
		enqueueCommand(ctx, {
			commandType: 'sources.preferences.save',
			payload: {
				sourceId: args.sourceId.trim(),
				entries: args.entries
			}
		})
});

export const enqueueExploreFeed = mutation({
	args: {
		feedType: v.union(v.literal('popular'), v.literal('latest')),
		sourceId: v.string(),
		page: v.float64(),
		limit: v.float64()
	},
	handler: (ctx, args) =>
		enqueueCommand(ctx, {
			commandType: args.feedType === 'latest' ? 'explore.latest' : 'explore.popular',
			payload: {
				sourceId: args.sourceId,
				page: args.page,
				limit: args.limit
			},
			idempotencyKey: `explore.feed:${args.feedType}:${args.sourceId}:${args.page}:${args.limit}`
		})
});

export const enqueueExploreSearch = mutation({
	args: {
		sourceId: v.string(),
		query: v.string(),
		limit: v.float64(),
		page: v.optional(v.float64()),
		searchFilters: v.optional(v.any())
	},
	handler: (ctx, args) =>
		enqueueCommand(ctx, {
			commandType: 'explore.search',
			payload: {
				sourceId: args.sourceId,
				query: args.query,
				limit: args.limit,
				...(args.page !== undefined ? { page: args.page } : {}),
				...(args.searchFilters !== undefined ? { searchFilters: args.searchFilters } : {})
			},
			idempotencyKey: `explore.search:${args.sourceId}:${args.query.trim().toLowerCase()}:${args.page ?? 1}:${args.limit}:${stableKeySegment(args.searchFilters ?? {})}`
		})
});

export const enqueueExploreTitleFetch = mutation({
	args: {
		sourceId: v.string(),
		titleUrl: v.string(),
		contextKey: v.optional(v.string())
	},
	handler: (ctx, args) =>
		enqueueCommand(ctx, {
			commandType: 'explore.title.fetch',
			payload: {
				sourceId: args.sourceId,
				titleUrl: args.titleUrl
			},
			idempotencyKey: `explore.title.fetch:${args.contextKey ?? 'default'}:${args.sourceId}:${args.titleUrl}`
		})
});

export const enqueueExploreChaptersFetch = mutation({
	args: {
		sourceId: v.string(),
		titleUrl: v.string(),
		contextKey: v.optional(v.string())
	},
	handler: (ctx, args) =>
		enqueueCommand(ctx, {
			commandType: 'explore.chapters.fetch',
			payload: {
				sourceId: args.sourceId,
				titleUrl: args.titleUrl
			},
			idempotencyKey: `explore.chapters.fetch:${args.contextKey ?? 'default'}:${args.sourceId}:${args.titleUrl}`
		})
});

export const enqueueReaderPagesFetch = mutation({
	args: {
		sourceId: v.string(),
		chapterUrl: v.string(),
		chapterName: v.optional(v.string())
	},
	handler: (ctx, args) =>
		enqueueCommand(ctx, {
			commandType: 'reader.pages.fetch',
			payload: {
				sourceId: args.sourceId,
				chapterUrl: args.chapterUrl,
				chapterName: args.chapterName
			},
			idempotencyKey: `reader.pages.fetch:${args.sourceId}:${args.chapterUrl}`
		})
});

export const enqueueLibraryImport = mutation({
	args: {
		canonicalKey: v.string(),
		sourceId: v.string(),
		sourcePkg: v.string(),
		sourceLang: v.string(),
		titleUrl: v.string(),
		fallbackTitle: v.optional(v.string()),
		fallbackAuthor: v.optional(v.string()),
		fallbackArtist: v.optional(v.string()),
		fallbackDescription: v.optional(v.string()),
		fallbackCoverUrl: v.optional(v.string()),
		fallbackGenre: v.optional(v.string())
	},
	handler: (ctx, args) =>
		enqueueCommand(ctx, {
			commandType: 'library.import',
			payload: args,
			idempotencyKey: `library.import:${args.canonicalKey}:${args.sourceId}:${args.titleUrl}`
		})
});

export const listMine = query({
	args: {
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}
		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 50), 200));
		const rows = await ctx.db
			.query('commands')
			.withIndex('by_requested_by_user_id_created_at', (q) =>
				q.eq('requestedByUserId', identity.subject as GenericId<'users'>)
			)
			.order('desc')
			.take(limit);

		return rows.map((row) => ({
			id: row._id,
			commandType: row.commandType,
			status: row.status,
			payload: row.payload,
			progress: row.progress ?? null,
			result: row.result ?? null,
			lastErrorMessage: row.lastErrorMessage ?? null,
			failureCode: row.failureCode ?? null,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt
		}));
	}
});

export const getMineById = query({
	args: {
		commandId: v.id('commands')
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return null;
		}

		const row = await ctx.db.get(args.commandId);
		if (!row || row.requestedByUserId !== (identity.subject as GenericId<'users'>)) {
			return null;
		}

		return {
			id: row._id,
			commandType: row.commandType,
			status: row.status,
			payload: row.payload,
			progress: row.progress ?? null,
			result: row.result ?? null,
			lastErrorMessage: row.lastErrorMessage ?? null,
			failureCode: row.failureCode ?? null,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt
		};
	}
});

export const getWorkpoolCommand = internalQuery({
	args: {
		commandId: v.id('commands')
	},
	handler: async (ctx, args) => {
		const command = await ctx.db.get(args.commandId);
		if (!command || command.executor !== 'workpool') {
			return null;
		}
		if (
			command.status !== STATUS.QUEUED &&
			command.status !== STATUS.LEASED &&
			command.status !== STATUS.RUNNING
		) {
			return null;
		}
		return {
			commandType: command.commandType,
			payload: command.payload,
			requestedByUserId: command.requestedByUserId
		};
	}
});

export const markWorkpoolRunning = internalMutation({
	args: {
		commandId: v.id('commands'),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		const command = await ctx.db.get(args.commandId);
		if (!command || command.executor !== 'workpool') {
			return { ok: false };
		}
		if (command.status !== STATUS.QUEUED && command.status !== STATUS.RUNNING) {
			return { ok: false };
		}
		// Workpool tracks attempt counts; we only flip to RUNNING and stamp startedAt.
		if (command.status === STATUS.RUNNING && command.startedAt !== undefined) {
			return { ok: true };
		}
		await ctx.db.patch(args.commandId, {
			status: STATUS.RUNNING,
			startedAt: command.startedAt ?? args.now,
			updatedAt: args.now
		});
		return { ok: true };
	}
});

export const refreshTitleStatsInternal = internalMutation({
	args: {
		titleId: v.id('libraryTitles'),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await refreshTitleChapterStats(ctx, args.titleId, args.now);
		return { ok: true };
	}
});

export const handleWorkpoolComplete = internalMutation({
	args: vOnCompleteArgs(
		v.object({
			commandId: v.id('commands')
		})
	),
	handler: async (ctx, args) => {
		const now = Date.now();
		const command = await ctx.db.get(args.context.commandId);
		if (!command || command.executor !== 'workpool') {
			return;
		}

		// onComplete can fire more than once after isolate restarts. Don't downgrade
		// a row we already finalized.
		if (
			command.status === STATUS.SUCCEEDED ||
			command.status === STATUS.DEAD ||
			command.status === STATUS.CANCELLED
		) {
			return;
		}

		if (args.result.kind === 'success') {
			await ctx.db.patch(command._id, {
				status: STATUS.SUCCEEDED,
				progress: undefined,
				result: args.result.returnValue,
				lastErrorMessage: undefined,
				failureCode: undefined,
				completedAt: now,
				updatedAt: now
			});
			await tryClearSourceHealth(ctx, command);
			return;
		}

		const message =
			args.result.kind === 'failed' ? args.result.error : 'Workpool command was cancelled';
		await ctx.db.patch(command._id, {
			status: args.result.kind === 'canceled' ? STATUS.CANCELLED : STATUS.DEAD,
			lastErrorMessage: message,
			progress: undefined,
			completedAt: now,
			updatedAt: now
		});

		await tryUpsertSourceHealthFailure(
			ctx,
			{ ...command, status: STATUS.DEAD, runAfter: command.runAfter },
			message,
			now
		);
	}
});

export const cancelCommand = mutation({
	args: {
		commandId: v.id('commands')
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error('Not authenticated');
		}
		const command = await ctx.db.get(args.commandId);
		if (!command || command.requestedByUserId !== (identity.subject as GenericId<'users'>)) {
			return { ok: false };
		}
		if (
			command.status === STATUS.SUCCEEDED ||
			command.status === STATUS.DEAD ||
			command.status === STATUS.CANCELLED
		) {
			return { ok: true, alreadyTerminal: true };
		}

		const now = Date.now();
		if (command.executor === 'workpool' && command.workId) {
			await poolForCommandType(command.commandType as CommandType).cancel(
				ctx,
				command.workId as never
			);
		}

		await ctx.db.patch(command._id, {
			status: STATUS.CANCELLED,
			leaseOwnerBridgeId: undefined,
			leaseToken: undefined,
			leaseExpiresAt: undefined,
			completedAt: now,
			updatedAt: now,
			lastErrorMessage: 'Cancelled by user',
			failureCode: undefined
		});
		return { ok: true };
	}
});

export const listSourceHealth = query({
	args: {
		sourceIds: v.array(v.string())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}

		const requestedSourceIds = Array.from(
			new Set(args.sourceIds.map((sourceId) => sourceId.trim()))
		).filter(Boolean);
		if (requestedSourceIds.length === 0) {
			return [];
		}

		const userId = identity.subject as GenericId<'users'>;
		const sourceIdSet = new Set(requestedSourceIds);

		// Query the dedicated sourceHealth table — O(sourceIds × scopes) lookups
		// instead of scanning up to 200 recent commands.
		const scopes = ['feed', 'search', 'title'] as const;
		const rows = await Promise.all(
			requestedSourceIds.flatMap((sourceId) =>
				scopes.map((scope) =>
					ctx.db
						.query('sourceHealth')
						.withIndex('by_source_id_scope_user', (q) =>
							q.eq('sourceId', sourceId).eq('scope', scope).eq('requestedByUserId', userId)
						)
						.unique()
				)
			)
		);

		return rows
			.filter((row): row is NonNullable<typeof row> => row !== null)
			.filter((row) => sourceIdSet.has(row.sourceId))
			.map((row) => ({
				sourceId: row.sourceId,
				scope: row.scope,
				state: row.state,
				message: row.message,
				retryAfter: row.retryAfter ?? null,
				permanent: row.permanent,
				updatedAt: row.updatedAt
			}));
	}
});
