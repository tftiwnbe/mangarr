import { queryGeneric } from 'convex/server';

export const bootstrap = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const installation = await ctx.db
      .query('installation')
      .withIndex('by_key', (q) => q.eq('key', 'main'))
      .unique();
    const worker = await ctx.db
      .query('workerState')
      .withIndex('by_worker_id', (q) => q.eq('workerId', 'main'))
      .unique();
    const users = await ctx.db.query('users').take(1);

    return {
      setupOpen: users.length === 0,
      releaseChannel: installation?.releaseChannel ?? 'v2.0.0-alpha',
      schemaVersion: installation?.schemaVersion ?? '0',
      worker: worker
        ? {
            bridgeStatus: worker.bridgeStatus,
            bridgeReady: worker.bridgeReady,
            lastHeartbeatAt: worker.lastHeartbeatAt,
            restartCount: worker.restartCount
          }
        : null
    };
  }
});
