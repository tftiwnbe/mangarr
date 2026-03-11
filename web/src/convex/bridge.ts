import { v } from 'convex/values';

import { mutation } from './_generated/server';
import { requireBridgeIdentity } from './bridge_auth';

export const reportHeartbeat = mutation({
	args: {
		bridgeId: v.string(),
		version: v.string(),
		capabilities: v.array(v.string()),
		lastHeartbeatAt: v.float64(),
		status: v.union(
			v.literal('stopped'),
			v.literal('starting'),
			v.literal('ready'),
			v.literal('error')
		),
		port: v.optional(v.float64()),
		ready: v.boolean(),
		restartCount: v.float64(),
		lastStartupError: v.optional(v.string()),
		lastHeartbeatError: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const existing = await ctx.db
			.query('bridgeState')
			.withIndex('by_bridge_id', (q) => q.eq('bridgeId', args.bridgeId))
			.unique();

		const payload = {
			bridgeId: args.bridgeId,
			version: args.version,
			capabilities: args.capabilities,
			lastHeartbeatAt: args.lastHeartbeatAt,
			status: args.status,
			port: args.port,
			ready: args.ready,
			restartCount: args.restartCount,
			lastStartupError: args.lastStartupError,
			lastHeartbeatError: args.lastHeartbeatError,
			updatedAt: args.lastHeartbeatAt
		};

		if (existing) {
			await ctx.db.patch(existing._id, payload);
			return { bridgeStateId: existing._id, created: false };
		}

		const bridgeStateId = await ctx.db.insert('bridgeState', payload);
		return { bridgeStateId, created: true };
	}
});
