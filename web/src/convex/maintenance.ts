import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { internalMutation, mutation } from './_generated/server';
import { STATUS } from './commands';

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
		const terminalCommandStatuses = new Set([STATUS.SUCCEEDED, STATUS.FAILED, STATUS.CANCELLED, STATUS.DEAD]);
		try {
			const oldCommands = await ctx.db
				.query('commands')
				.withIndex('by_created_at', (q) => q.lt('createdAt', commandCutoff))
				.order('asc')
				.take(limit);
			for (const command of oldCommands) {
				if (deletedCommands >= limit) break;
				if (!terminalCommandStatuses.has(command.status)) continue;
				await ctx.db.delete(command._id);
				deletedCommands += 1;
			}
		} catch (error) {
			console.warn('Retention pass skipped command cleanup', error);
		}

		const downloadTaskCutoff = now - DOWNLOAD_TASK_RETENTION_MS;
		try {
			for (const status of ['completed', 'failed', 'cancelled'] as const) {
				if (deletedDownloadTasks >= limit) break;
				const rows = await ctx.db
					.query('downloadTasks')
					.withIndex('by_status_updated_at', (q) =>
						q.eq('status', status).lt('updatedAt', downloadTaskCutoff)
					)
					.order('asc')
					.take(limit);
				for (const row of rows) {
					if (deletedDownloadTasks >= limit) break;
					await ctx.db.delete(row._id);
					deletedDownloadTasks += 1;
				}
			}
		} catch (error) {
			console.warn('Retention pass skipped download task cleanup', error);
		}

		const exploreCacheCutoff = now - EXPLORE_CACHE_RETENTION_MS;
		try {
			const exploreRows = await ctx.db
				.query('exploreTitleDetailsCache')
				.withIndex('by_fetched_at', (q) => q.lt('fetchedAt', exploreCacheCutoff))
				.order('asc')
				.take(limit);
			for (const row of exploreRows) {
				if (deletedExploreCacheRows >= limit) break;
				await ctx.db.delete(row._id);
				deletedExploreCacheRows += 1;
			}
		} catch (error) {
			console.warn('Retention pass skipped explore cache cleanup', error);
		}

		return {
			deletedCommands,
			deletedDownloadTasks,
			deletedExploreCacheRows
		};
	}
});

export const recomputeChapterCounts = internalMutation({
	args: {
		batchSize: v.optional(v.float64()),
		cursor: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const batchSize = Math.min(args.batchSize ?? 20, 50);

		// Find the first user (single-user instance)
		const firstTitle = await ctx.db.query('libraryTitles').first();
		if (!firstTitle) return { done: true, fixed: 0, nextCursor: null };
		const ownerUserId = firstTitle.ownerUserId;
		const now = Date.now();

		const allTitles = await ctx.db
			.query('libraryTitles')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
			.collect();

		const staleTitles = allTitles
			.filter((t) => !t.chapterCount || t.chapterCount === 0)
			.sort((a, b) => a._creationTime - b._creationTime);

		const cursorIndex = args.cursor
			? staleTitles.findIndex((t) => String(t._id) === args.cursor)
			: 0;
		const startIndex = cursorIndex >= 0 ? cursorIndex : 0;
		const batch = staleTitles.slice(startIndex, startIndex + batchSize);

		let fixed = 0;
		for (const title of batch) {
			const chapters = await ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id', (q) =>
					q.eq('libraryTitleId', title._id)
				)
				.collect();

			let downloaded = 0;
			let downloadedBytes = 0;
			let queued = 0;
			let downloading = 0;
			let failed = 0;
			for (const ch of chapters) {
				switch (ch.downloadStatus) {
					case 'queued': queued++; break;
					case 'downloading': downloading++; break;
					case 'downloaded':
						downloaded++;
						downloadedBytes += ch.fileSizeBytes ?? 0;
						break;
					case 'failed': failed++; break;
				}
			}

			await ctx.db.patch(title._id, {
				chapterCount: chapters.length,
				downloadedChapterCount: downloaded,
				downloadedChapterBytes: downloadedBytes,
				queuedChapterCount: queued,
				downloadingChapterCount: downloading,
				failedChapterCount: failed,
				updatedAt: now
			});
			fixed++;
		}

		const hasMore = startIndex + batchSize < staleTitles.length;
		const nextCursor = hasMore ? String(staleTitles[startIndex + batchSize]._id) : null;

		return {
			done: !hasMore,
			fixed,
			remaining: staleTitles.length - startIndex - batch.length,
			nextCursor
		};
	}
});
