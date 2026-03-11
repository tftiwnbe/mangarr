import { query } from './_generated/server';

export const bootstrap = query({
	args: {},
	handler: async (ctx) => {
		const installation = await ctx.db
			.query('installation')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique();
		const bridge = await ctx.db
			.query('bridgeState')
			.withIndex('by_bridge_id', (q) => q.eq('bridgeId', 'main'))
			.unique();
		const users = await ctx.db.query('users').take(1);
		const installedExtensions = await ctx.db.query('installedExtensions').collect();

		return {
			setupOpen: users.length === 0,
			schemaVersion: installation?.schemaVersion ?? '1',
			extensionRepoUrl: installation?.extensionRepoUrl ?? null,
			installedExtensionsCount: installedExtensions.length,
			bridge: bridge
				? {
						status: bridge.status,
						ready: bridge.ready,
						lastHeartbeatAt: bridge.lastHeartbeatAt,
						restartCount: bridge.restartCount,
						lastHeartbeatError: bridge.lastHeartbeatError ?? null
					}
				: null
		};
	}
});
