import { query } from './_generated/server';

export const bootstrap = query({
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
		const installedExtensions = await ctx.db.query('installedExtensions').collect();

		return {
			setupOpen: users.length === 0,
			releaseChannel: installation?.releaseChannel ?? 'v2.0.0-alpha',
			schemaVersion: installation?.schemaVersion ?? '1',
			extensionRepoUrl: installation?.extensionRepoUrl ?? null,
			installedExtensionsCount: installedExtensions.length,
			worker: worker
				? {
						bridgeStatus: worker.bridgeStatus,
						bridgeReady: worker.bridgeReady,
						lastHeartbeatAt: worker.lastHeartbeatAt,
						restartCount: worker.restartCount,
						lastHeartbeatError: worker.lastHeartbeatError ?? null
					}
				: null
		};
	}
});
