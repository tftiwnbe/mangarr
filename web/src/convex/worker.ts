import { mutationGeneric } from 'convex/server';
import { v } from 'convex/values';

export const reportHeartbeat = mutationGeneric({
	args: {
		workerId: v.string(),
		version: v.string(),
		capabilities: v.array(v.string()),
		lastHeartbeatAt: v.float64(),
		bridgeStatus: v.union(
			v.literal('stopped'),
			v.literal('starting'),
			v.literal('ready'),
			v.literal('error')
		),
		bridgePort: v.optional(v.float64()),
		bridgeReady: v.boolean(),
		restartCount: v.float64(),
		lastStartupError: v.optional(v.string()),
		lastHeartbeatError: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('workerState')
			.withIndex('by_worker_id', (q) => q.eq('workerId', args.workerId))
			.unique();

		const payload = {
			workerId: args.workerId,
			version: args.version,
			capabilities: args.capabilities,
			lastHeartbeatAt: args.lastHeartbeatAt,
			bridgeStatus: args.bridgeStatus,
			bridgePort: args.bridgePort,
			bridgeReady: args.bridgeReady,
			restartCount: args.restartCount,
			lastStartupError: args.lastStartupError,
			lastHeartbeatError: args.lastHeartbeatError,
			updatedAt: args.lastHeartbeatAt
		};

		if (existing) {
			await ctx.db.patch(existing._id, payload);
			return { workerStateId: existing._id, created: false };
		}

		const workerStateId = await ctx.db.insert('workerState', payload);
		return { workerStateId, created: true };
	}
});
