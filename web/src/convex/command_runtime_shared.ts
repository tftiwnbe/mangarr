import type { GenericId } from 'convex/values';

import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import {
	isPermanentSourceFailure,
	sourceHealthScopeForCommandType
} from '../lib/utils/source-health';

export const STATUS = {
	QUEUED: 'queued',
	LEASED: 'leased',
	RUNNING: 'running',
	SUCCEEDED: 'succeeded',
	FAILED: 'failed',
	CANCELLED: 'cancelled',
	DEAD: 'dead_letter'
} as const;

export type CommandStatus = (typeof STATUS)[keyof typeof STATUS];

export function generateLeaseToken(bridgeId: string, now: number) {
	return `${bridgeId}:${now}:${Math.random().toString(36).slice(2, 12)}`;
}

export function hasMatchingLease(
	command: Doc<'commands'> | null,
	args: { bridgeId: string; leaseToken: string }
): command is Doc<'commands'> {
	return (
		command !== null &&
		command.leaseOwnerBridgeId === args.bridgeId &&
		command.leaseToken === args.leaseToken
	);
}

export async function upsertSourceHealthFailure(
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
	const scope = sourceHealthScopeForCommandType(command.commandType);
	if (!scope || !command.requestedByUserId) return;

	const sourceId =
		typeof (command.payload as { sourceId?: unknown } | null)?.sourceId === 'string'
			? ((command.payload as { sourceId: string }).sourceId ?? '').trim()
			: '';
	if (!sourceId) return;

	const state =
		command.status === STATUS.QUEUED && command.runAfter > now ? 'cooldown' : 'degraded';
	const permanent = isPermanentSourceFailure(errorMessage);
	const retryAfter = state === 'cooldown' ? command.runAfter : undefined;

	const existing = await ctx.db
		.query('sourceHealth')
		.withIndex('by_source_id_scope_user', (q) =>
			q
				.eq('sourceId', sourceId)
				.eq('scope', scope)
				.eq('requestedByUserId', command.requestedByUserId!)
		)
		.unique();

	if (existing) {
		await ctx.db.patch(existing._id, {
			state,
			message: errorMessage,
			retryAfter,
			permanent,
			commandType: command.commandType,
			updatedAt: now
		});
	} else {
		await ctx.db.insert('sourceHealth', {
			sourceId,
			scope,
			requestedByUserId: command.requestedByUserId,
			state,
			message: errorMessage,
			retryAfter,
			permanent,
			commandType: command.commandType,
			updatedAt: now
		});
	}
}

export async function clearSourceHealth(
	ctx: MutationCtx,
	command: {
		commandType: string;
		requestedByUserId?: GenericId<'users'>;
		payload: unknown;
	}
) {
	const scope = sourceHealthScopeForCommandType(command.commandType);
	if (!scope || !command.requestedByUserId) return;

	const sourceId =
		typeof (command.payload as { sourceId?: unknown } | null)?.sourceId === 'string'
			? ((command.payload as { sourceId: string }).sourceId ?? '').trim()
			: '';
	if (!sourceId) return;

	const existing = await ctx.db
		.query('sourceHealth')
		.withIndex('by_source_id_scope_user', (q) =>
			q
				.eq('sourceId', sourceId)
				.eq('scope', scope)
				.eq('requestedByUserId', command.requestedByUserId!)
		)
		.unique();

	if (existing) {
		await ctx.db.delete(existing._id);
	}
}
