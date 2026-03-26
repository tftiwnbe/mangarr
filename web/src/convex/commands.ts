import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
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
const REUSABLE_STATUSES = new Set<CommandStatus>([
	STATUS.QUEUED,
	STATUS.LEASED,
	STATUS.RUNNING,
	STATUS.SUCCEEDED
]);

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

export const enqueue = mutation({
	args: {
		commandType: v.string(),
		payload: v.any(),
		idempotencyKey: v.optional(v.string()),
		priority: v.optional(v.float64()),
		maxAttempts: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
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
				.collect();

			const reusable = existing
				.filter((row) => row.requestedByUserId === (identity.subject as GenericId<'users'>))
				.sort((left, right) => right.createdAt - left.createdAt)
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

		return rows
			.map((row) => ({
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
						q.eq('status', STATUS.QUEUED).eq('targetCapability', capability).lte('runAfter', args.now)
					)
					.take(limit),
			),
		);

		const eligible = candidates
			.flat()
			.sort((left, right) => {
				if (left.priority !== right.priority) return left.priority - right.priority;
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
