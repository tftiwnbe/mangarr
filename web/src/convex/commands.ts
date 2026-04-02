import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import {
	isPermanentSourceFailure,
	sourceHealthScopeForCommandType
} from '../lib/utils/source-health';
import { mutation, query, type MutationCtx } from './_generated/server';
import { requireBridgeIdentity } from './bridge_auth';

const STATUS = {
	QUEUED: 'queued',
	LEASED: 'leased',
	RUNNING: 'running',
	SUCCEEDED: 'succeeded',
	FAILED: 'failed',
	CANCELLED: 'cancelled',
	DEAD: 'dead_letter'
} as const;

type CommandStatus = (typeof STATUS)[keyof typeof STATUS];
const REUSABLE_STATUSES = new Set<CommandStatus>([STATUS.QUEUED, STATUS.SUCCEEDED]);

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

async function enqueueCommand(
	ctx: MutationCtx,
	args: {
		commandType: string;
		payload: unknown;
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
		priority: args.priority ?? 100,
		runAfter: now,
		attemptCount: 0,
		maxAttempts: Math.max(1, Math.floor(args.maxAttempts ?? 3)),
		createdAt: now,
		updatedAt: now
	});

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
	handler: (ctx, args) => enqueueCommand(ctx, args)
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
		searchFilters: v.optional(v.any())
	},
	handler: (ctx, args) =>
		enqueueCommand(ctx, {
			commandType: 'explore.search',
			payload: {
				sourceId: args.sourceId,
				query: args.query,
				limit: args.limit,
				...(args.searchFilters !== undefined ? { searchFilters: args.searchFilters } : {})
			},
			idempotencyKey: `explore.search:${args.sourceId}:${args.query.trim().toLowerCase()}:${args.limit}:${stableKeySegment(args.searchFilters ?? {})}`
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
			}
		})
});

export const enqueueLibraryImport = mutation({
	args: {
		canonicalKey: v.string(),
		sourceId: v.string(),
		sourcePkg: v.string(),
		sourceLang: v.string(),
		titleUrl: v.string()
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
			createdAt: row.createdAt,
			updatedAt: row.updatedAt
		};
	}
});

export const lease = mutation({
	args: {
		bridgeId: v.string(),
		capabilities: v.array(v.string()),
		now: v.float64(),
		limit: v.float64(),
		leaseDurationMs: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const expired = await ctx.db
			.query('commands')
			.withIndex('by_status_lease_expires_at', (q) =>
				q.eq('status', STATUS.LEASED).lt('leaseExpiresAt', args.now + 1)
			)
			.take(50);
		const expiredRunning = await ctx.db
			.query('commands')
			.withIndex('by_status_lease_expires_at', (q) =>
				q.eq('status', STATUS.RUNNING).lt('leaseExpiresAt', args.now + 1)
			)
			.take(50);

		for (const row of [...expired, ...expiredRunning]) {
			if (!row.leaseExpiresAt || row.leaseExpiresAt > args.now) {
				continue;
			}

			const exhausted = row.attemptCount >= row.maxAttempts;
			await ctx.db.patch(row._id, {
				status: exhausted ? STATUS.DEAD : STATUS.QUEUED,
				runAfter: exhausted ? row.runAfter : args.now,
				leaseOwnerBridgeId: undefined,
				leaseExpiresAt: undefined,
				completedAt: exhausted ? args.now : undefined,
				lastErrorMessage: 'Lease expired before command completed',
				updatedAt: args.now
			});
		}

		const limit = Math.max(1, Math.min(Math.floor(args.limit), 25));
		const candidates = await Promise.all(
			Array.from(new Set(args.capabilities)).map(async (capability) =>
				ctx.db
					.query('commands')
					.withIndex('by_status_target_capability_priority_run_after', (q) =>
						q
							.eq('status', STATUS.QUEUED)
							.eq('targetCapability', capability)
							.lte('runAfter', args.now)
					)
					.take(limit)
			)
		);

		const eligible = candidates
			.flat()
			.sort((left, right) => {
				if (left.priority !== right.priority) return left.priority - right.priority;
				if (left.commandType !== right.commandType) {
					if (left.commandType === 'downloads.chapter') return 1;
					if (right.commandType === 'downloads.chapter') return -1;
				}
				if (left.runAfter !== right.runAfter) return left.runAfter - right.runAfter;
				return left.createdAt - right.createdAt;
			})
			.slice(0, limit);

		const leased: Array<{
			id: GenericId<'commands'>;
			commandType: string;
			payload: unknown;
			requestedByUserId?: GenericId<'users'>;
			attemptCount: number;
			maxAttempts: number;
		}> = [];

		for (const row of eligible) {
			const nextAttemptCount = row.attemptCount + 1;
			await ctx.db.patch(row._id, {
				status: STATUS.LEASED,
				leaseOwnerBridgeId: args.bridgeId,
				leaseExpiresAt: args.now + args.leaseDurationMs,
				attemptCount: nextAttemptCount,
				updatedAt: args.now
			});
			leased.push({
				id: row._id,
				commandType: row.commandType,
				payload: row.payload,
				requestedByUserId: row.requestedByUserId,
				attemptCount: nextAttemptCount,
				maxAttempts: row.maxAttempts
			});
		}

		return leased;
	}
});

export const markRunning = mutation({
	args: {
		commandId: v.id('commands'),
		bridgeId: v.string(),
		now: v.float64(),
		leaseDurationMs: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const command = await ctx.db.get(args.commandId);
		if (!command || command.leaseOwnerBridgeId !== args.bridgeId) {
			return { ok: false };
		}
		if (command.status !== STATUS.LEASED && command.status !== STATUS.RUNNING) {
			return { ok: false };
		}

		await ctx.db.patch(args.commandId, {
			status: STATUS.RUNNING,
			leaseExpiresAt: args.now + args.leaseDurationMs,
			startedAt: command.startedAt ?? args.now,
			updatedAt: args.now
		});
		return { ok: true };
	}
});

export const renewLease = mutation({
	args: {
		commandId: v.id('commands'),
		bridgeId: v.string(),
		now: v.float64(),
		leaseDurationMs: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const command = await ctx.db.get(args.commandId);
		if (!command || command.leaseOwnerBridgeId !== args.bridgeId) {
			return { ok: false };
		}
		if (command.status !== STATUS.LEASED && command.status !== STATUS.RUNNING) {
			return { ok: false };
		}

		await ctx.db.patch(args.commandId, {
			leaseExpiresAt: args.now + args.leaseDurationMs,
			updatedAt: args.now
		});
		return { ok: true };
	}
});

export const complete = mutation({
	args: {
		commandId: v.id('commands'),
		bridgeId: v.string(),
		now: v.float64(),
		result: v.any()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const command = await ctx.db.get(args.commandId);
		if (!command || command.leaseOwnerBridgeId !== args.bridgeId) {
			return { ok: false };
		}

		await ctx.db.patch(args.commandId, {
			status: STATUS.SUCCEEDED,
			progress: undefined,
			result: args.result,
			leaseOwnerBridgeId: undefined,
			leaseExpiresAt: undefined,
			completedAt: args.now,
			updatedAt: args.now
		});
		return { ok: true };
	}
});

export const fail = mutation({
	args: {
		commandId: v.id('commands'),
		bridgeId: v.string(),
		now: v.float64(),
		message: v.string(),
		retryDelayMs: v.optional(v.float64()),
		retryable: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const command = await ctx.db.get(args.commandId);
		if (!command || command.leaseOwnerBridgeId !== args.bridgeId) {
			return { ok: false };
		}

		const shouldRetry = args.retryable !== false && command.attemptCount < command.maxAttempts;
		const retryDelayMs = Math.max(1_000, Math.floor(args.retryDelayMs ?? 5_000));
		const nextStatus: CommandStatus = shouldRetry ? STATUS.QUEUED : STATUS.DEAD;

		await ctx.db.patch(args.commandId, {
			status: nextStatus,
			runAfter: shouldRetry ? args.now + retryDelayMs : command.runAfter,
			lastErrorMessage: args.message,
			progress: undefined,
			leaseOwnerBridgeId: undefined,
			leaseExpiresAt: undefined,
			completedAt: shouldRetry ? undefined : args.now,
			updatedAt: args.now
		});

		return { ok: true, retried: shouldRetry };
	}
});

export const updateProgress = mutation({
	args: {
		commandId: v.id('commands'),
		bridgeId: v.string(),
		now: v.float64(),
		progress: v.any()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const command = await ctx.db.get(args.commandId);
		if (!command || command.leaseOwnerBridgeId !== args.bridgeId) {
			return { ok: false };
		}
		if (command.status !== STATUS.LEASED && command.status !== STATUS.RUNNING) {
			return { ok: false };
		}

		await ctx.db.patch(args.commandId, {
			progress: args.progress,
			updatedAt: args.now
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

		const now = Date.now();
		const sourceIdSet = new Set(requestedSourceIds);
		const rows = await ctx.db
			.query('commands')
			.withIndex('by_requested_by_user_id_created_at', (q) =>
				q.eq('requestedByUserId', identity.subject as GenericId<'users'>)
			)
			.order('desc')
			.take(200);

		const handledKeys = new Set<string>();
		const entries: Array<{
			sourceId: string;
			scope: 'feed' | 'search' | 'title';
			state: 'cooldown' | 'degraded';
			message: string;
			retryAfter: number | null;
			permanent: boolean;
			updatedAt: number;
		}> = [];

		for (const row of rows) {
			const scope = sourceHealthScopeForCommandType(row.commandType);
			if (!scope) continue;

			const sourceId =
				typeof (row.payload as { sourceId?: unknown } | null)?.sourceId === 'string'
					? ((row.payload as { sourceId: string }).sourceId ?? '').trim()
					: '';
			if (!sourceId || !sourceIdSet.has(sourceId)) continue;

			const handledKey = `${scope}:${sourceId}`;
			if (handledKeys.has(handledKey)) continue;

			if (
				row.status === STATUS.SUCCEEDED ||
				row.status === STATUS.RUNNING ||
				row.status === STATUS.LEASED ||
				(row.status === STATUS.QUEUED && !row.lastErrorMessage)
			) {
				handledKeys.add(handledKey);
				continue;
			}

			if (row.status === STATUS.QUEUED && row.lastErrorMessage && row.runAfter > now) {
				entries.push({
					sourceId,
					scope,
					state: 'cooldown',
					message: row.lastErrorMessage,
					retryAfter: row.runAfter,
					permanent: false,
					updatedAt: row.updatedAt
				});
				handledKeys.add(handledKey);
				continue;
			}

			if (row.status === STATUS.DEAD && row.lastErrorMessage) {
				entries.push({
					sourceId,
					scope,
					state: 'degraded',
					message: row.lastErrorMessage,
					retryAfter: null,
					permanent: isPermanentSourceFailure(row.lastErrorMessage),
					updatedAt: row.updatedAt
				});
				handledKeys.add(handledKey);
			}
		}

		return entries;
	}
});
