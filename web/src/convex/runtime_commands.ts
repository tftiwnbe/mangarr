import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { mutation, type MutationCtx } from './_generated/server';
import { requireBridgeIdentity } from './bridge_auth';
import {
	clearSourceHealth,
	generateLeaseToken,
	hasMatchingLease,
	STATUS,
	upsertSourceHealthFailure
} from './command_runtime_shared';
import type { CommandStatus } from './command_runtime_shared';

const EXPIRED_LEASE_RECOVERY_BATCH = 10;
const MAX_CANDIDATES_PER_CAPABILITY = 4;
const MAX_CANDIDATE_POOL_MULTIPLIER = 3;

type LeaseRequest = {
	lane: string;
	capabilities: string[];
	limit: number;
};

async function leaseCommandsForRequest(
	ctx: MutationCtx,
	args: {
		bridgeId: string;
		now: number;
		leaseDurationMs: number;
		request: LeaseRequest;
		seenCommandIds: Set<string>;
	}
) {
	const limit = Math.max(1, Math.min(Math.floor(args.request.limit), 25));
	const uniqueCapabilities = Array.from(new Set(args.request.capabilities));
	const candidatePoolLimit = Math.max(limit, Math.min(limit * MAX_CANDIDATE_POOL_MULTIPLIER, 12));
	const candidates = [];

	for (const capability of uniqueCapabilities) {
		if (candidates.length >= candidatePoolLimit) {
			break;
		}

		const rows = await ctx.db
			.query('commands')
			.withIndex('by_status_target_capability_priority_run_after', (q) =>
				q.eq('status', STATUS.QUEUED).eq('targetCapability', capability).lte('runAfter', args.now)
			)
			.take(Math.min(limit, MAX_CANDIDATES_PER_CAPABILITY));

		for (const row of rows) {
			if (row.executor === 'workpool') {
				continue;
			}
			const commandId = String(row._id);
			if (args.seenCommandIds.has(commandId)) {
				continue;
			}
			args.seenCommandIds.add(commandId);
			candidates.push(row);
			if (candidates.length >= candidatePoolLimit) {
				break;
			}
		}
	}

	const eligible = candidates
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
		leaseToken: string;
		attemptCount: number;
		maxAttempts: number;
	}> = [];

	for (const row of eligible) {
		const nextAttemptCount = row.attemptCount + 1;
		const leaseToken = generateLeaseToken(args.bridgeId, args.now);
		await ctx.db.patch(row._id, {
			status: STATUS.LEASED,
			leaseOwnerBridgeId: args.bridgeId,
			leaseToken,
			leaseExpiresAt: args.now + args.leaseDurationMs,
			attemptCount: nextAttemptCount,
			updatedAt: args.now
		});
		leased.push({
			id: row._id,
			commandType: row.commandType,
			payload: row.payload,
			requestedByUserId: row.requestedByUserId,
			leaseToken,
			attemptCount: nextAttemptCount,
			maxAttempts: row.maxAttempts
		});
	}

	return {
		leased,
		stats: {
			lane: args.request.lane,
			requestedSlots: limit,
			candidateCount: candidates.length,
			leasedCount: leased.length
		}
	};
}

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
		const leased = await leaseCommandsForRequest(ctx, {
			bridgeId: args.bridgeId,
			now: args.now,
			leaseDurationMs: args.leaseDurationMs,
			request: { lane: 'default', capabilities: args.capabilities, limit: args.limit },
			seenCommandIds: new Set<string>()
		});

		return leased.leased;
	}
});

export const leaseBatch = mutation({
	args: {
		bridgeId: v.string(),
		now: v.float64(),
		leaseDurationMs: v.float64(),
		requests: v.array(
			v.object({
				lane: v.string(),
				capabilities: v.array(v.string()),
				limit: v.float64()
			})
		)
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const seenCommandIds = new Set<string>();
		const leasedCommands = [];
		const requestStats = [];

		for (const request of args.requests) {
			const leased = await leaseCommandsForRequest(ctx, {
				bridgeId: args.bridgeId,
				now: args.now,
				leaseDurationMs: args.leaseDurationMs,
				request,
				seenCommandIds
			});
			leasedCommands.push(...leased.leased);
			requestStats.push(leased.stats);
		}

		return {
			leasedCommands,
			requestStats
		};
	}
});

export const recoverExpiredLeases = mutation({
	args: {
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const expired = await ctx.db
			.query('commands')
			.withIndex('by_status_lease_expires_at', (q) =>
				q.eq('status', STATUS.LEASED).lt('leaseExpiresAt', args.now + 1)
			)
			.take(EXPIRED_LEASE_RECOVERY_BATCH);
		const expiredRunning = await ctx.db
			.query('commands')
			.withIndex('by_status_lease_expires_at', (q) =>
				q.eq('status', STATUS.RUNNING).lt('leaseExpiresAt', args.now + 1)
			)
			.take(EXPIRED_LEASE_RECOVERY_BATCH);

		let recoveredCommands = 0;
		let deadLetteredCommands = 0;
		for (const row of [...expired, ...expiredRunning]) {
			if (!row.leaseExpiresAt || row.leaseExpiresAt > args.now) {
				continue;
			}

			const exhausted = row.attemptCount >= row.maxAttempts;
			await ctx.db.patch(row._id, {
				status: exhausted ? STATUS.DEAD : STATUS.QUEUED,
				runAfter: exhausted ? row.runAfter : args.now,
				leaseOwnerBridgeId: undefined,
				leaseToken: undefined,
				leaseExpiresAt: undefined,
				completedAt: exhausted ? args.now : undefined,
				lastErrorMessage: 'Lease expired before command completed',
				updatedAt: args.now
			});
			recoveredCommands += 1;
			if (exhausted) {
				deadLetteredCommands += 1;
			}
		}

		return { recoveredCommands, deadLetteredCommands };
	}
});

export const renewLease = mutation({
	args: {
		commandId: v.id('commands'),
		bridgeId: v.string(),
		leaseToken: v.string(),
		now: v.float64(),
		leaseDurationMs: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const command = await ctx.db.get(args.commandId);
		if (!hasMatchingLease(command, args)) {
			return { ok: false, stale: true };
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
		leaseToken: v.string(),
		now: v.float64(),
		result: v.any()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const command = await ctx.db.get(args.commandId);
		if (!hasMatchingLease(command, args)) {
			return { ok: false, stale: true };
		}

		await ctx.db.patch(args.commandId, {
			status: STATUS.SUCCEEDED,
			progress: undefined,
			result: args.result,
			leaseOwnerBridgeId: undefined,
			leaseToken: undefined,
			leaseExpiresAt: undefined,
			completedAt: args.now,
			updatedAt: args.now
		});
		await clearSourceHealth(ctx, command);
		return { ok: true };
	}
});

export const fail = mutation({
	args: {
		commandId: v.id('commands'),
		bridgeId: v.string(),
		leaseToken: v.string(),
		now: v.float64(),
		message: v.string(),
		retryDelayMs: v.optional(v.float64()),
		retryable: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const command = await ctx.db.get(args.commandId);
		if (!hasMatchingLease(command, args)) {
			return { ok: false, stale: true, retried: false };
		}

		const shouldRetry = args.retryable !== false && command.attemptCount < command.maxAttempts;
		const retryDelayMs = Math.max(1_000, Math.floor(args.retryDelayMs ?? 5_000));
		const nextStatus: CommandStatus = shouldRetry ? STATUS.QUEUED : STATUS.DEAD;
		const nextRunAfter = shouldRetry ? args.now + retryDelayMs : command.runAfter;

		await ctx.db.patch(args.commandId, {
			status: nextStatus,
			runAfter: nextRunAfter,
			lastErrorMessage: args.message,
			progress: undefined,
			leaseOwnerBridgeId: undefined,
			leaseToken: undefined,
			leaseExpiresAt: undefined,
			completedAt: shouldRetry ? undefined : args.now,
			updatedAt: args.now
		});

		await upsertSourceHealthFailure(
			ctx,
			{ ...command, status: nextStatus, runAfter: nextRunAfter },
			args.message,
			args.now
		);

		return { ok: true, retried: shouldRetry };
	}
});

export const updateProgress = mutation({
	args: {
		commandId: v.id('commands'),
		bridgeId: v.string(),
		leaseToken: v.string(),
		now: v.float64(),
		progress: v.any()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const command = await ctx.db.get(args.commandId);
		if (!hasMatchingLease(command, args)) {
			return { ok: false, stale: true };
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
