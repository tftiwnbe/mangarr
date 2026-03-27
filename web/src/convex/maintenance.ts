import { internalMutation } from './_generated/server';

const DAY_MS = 24 * 60 * 60 * 1000;
const COMMAND_RETENTION_MS = 7 * DAY_MS;
const DOWNLOAD_TASK_RETENTION_MS = 14 * DAY_MS;
const EXPLORE_CACHE_RETENTION_MS = 3 * DAY_MS;

export const runRetentionPass = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const limit = 500;
		let deletedCommands = 0;
		let deletedDownloadTasks = 0;
		let deletedExploreCacheRows = 0;

		const commandCutoff = now - COMMAND_RETENTION_MS;
		const terminalCommandStatuses = new Set(['succeeded', 'failed', 'cancelled', 'dead_letter']);
		const oldCommands = await ctx.db.query('commands').withIndex('by_created_at').order('asc').take(limit * 3);
		for (const command of oldCommands) {
			if (deletedCommands >= limit || command.createdAt > commandCutoff) break;
			if (!terminalCommandStatuses.has(command.status)) continue;
			await ctx.db.delete(command._id);
			deletedCommands += 1;
		}

		const downloadTaskCutoff = now - DOWNLOAD_TASK_RETENTION_MS;
		for (const status of ['completed', 'failed', 'cancelled'] as const) {
			if (deletedDownloadTasks >= limit) break;
			const rows = await ctx.db
				.query('downloadTasks')
				.withIndex('by_status_updated_at', (q) => q.eq('status', status))
				.order('asc')
				.take(limit * 2);
			for (const row of rows) {
				if (deletedDownloadTasks >= limit || row.updatedAt > downloadTaskCutoff) break;
				await ctx.db.delete(row._id);
				deletedDownloadTasks += 1;
			}
		}

		const exploreCacheCutoff = now - EXPLORE_CACHE_RETENTION_MS;
		const exploreRows = await ctx.db
			.query('exploreTitleDetailsCache')
			.withIndex('by_fetched_at')
			.order('asc')
			.take(limit * 2);
		for (const row of exploreRows) {
			if (deletedExploreCacheRows >= limit || row.fetchedAt > exploreCacheCutoff) break;
			await ctx.db.delete(row._id);
			deletedExploreCacheRows += 1;
		}

		return {
			deletedCommands,
			deletedDownloadTasks,
			deletedExploreCacheRows
		};
	}
});
