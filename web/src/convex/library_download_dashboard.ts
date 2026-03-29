import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { query } from './_generated/server';
import {
	cleanExtensionLabel,
	DOWNLOAD_STATUS,
	humanizeSourcePkg,
	loadOwnerChaptersByTitleId
} from './library_shared';

const DOWNLOAD_TASK_STATUS = {
	QUEUED: 'queued',
	DOWNLOADING: 'downloading',
	COMPLETED: 'completed',
	FAILED: 'failed',
	CANCELLED: 'cancelled'
} as const;

export const getDownloadDashboard = query({
	args: {
		watchedLimit: v.optional(v.float64()),
		activeLimit: v.optional(v.float64()),
		recentLimit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return {
				generatedAt: null,
				overview: {
					downloadedChapters: 0,
					avgChapterSizeBytes: 0
				},
				activeTasks: [],
				recentTasks: [],
				watchedTitles: []
			};
		}

		const ownerUserId = identity.subject as GenericId<'users'>;
		const watchedLimit = Math.max(1, Math.min(Math.floor(args.watchedLimit ?? 30), 100));
		const activeLimit = Math.max(1, Math.min(Math.floor(args.activeLimit ?? 20), 100));
		const recentLimit = Math.max(1, Math.min(Math.floor(args.recentLimit ?? 20), 100));

		const [
			titles,
			profileRows,
			installedExtensions,
			{ byTitleId: chaptersByTitleId },
			queuedTaskRows,
			downloadingTaskRows,
			completedTaskRows,
			failedTaskRows,
			cancelledTaskRows
		] = await Promise.all([
			ctx.db
				.query('libraryTitles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
				.collect(),
			ctx.db
				.query('downloadProfiles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
				.collect(),
			ctx.db.query('installedExtensions').collect(),
			loadOwnerChaptersByTitleId(ctx, ownerUserId),
			ctx.db
				.query('downloadTasks')
				.withIndex('by_owner_user_id_status_updated_at', (q) =>
					q.eq('ownerUserId', ownerUserId).eq('status', DOWNLOAD_TASK_STATUS.QUEUED)
				)
				.order('desc')
				.take(200),
			ctx.db
				.query('downloadTasks')
				.withIndex('by_owner_user_id_status_updated_at', (q) =>
					q.eq('ownerUserId', ownerUserId).eq('status', DOWNLOAD_TASK_STATUS.DOWNLOADING)
				)
				.order('desc')
				.take(200),
			ctx.db
				.query('downloadTasks')
				.withIndex('by_owner_user_id_status_updated_at', (q) =>
					q.eq('ownerUserId', ownerUserId).eq('status', DOWNLOAD_TASK_STATUS.COMPLETED)
				)
				.order('desc')
				.take(recentLimit),
			ctx.db
				.query('downloadTasks')
				.withIndex('by_owner_user_id_status_updated_at', (q) =>
					q.eq('ownerUserId', ownerUserId).eq('status', DOWNLOAD_TASK_STATUS.FAILED)
				)
				.order('desc')
				.take(recentLimit),
			ctx.db
				.query('downloadTasks')
				.withIndex('by_owner_user_id_status_updated_at', (q) =>
					q.eq('ownerUserId', ownerUserId).eq('status', DOWNLOAD_TASK_STATUS.CANCELLED)
				)
				.order('desc')
				.take(recentLimit)
		]);

		titles.sort((left, right) => right.updatedAt - left.updatedAt);

		const sourceNamesById = new Map<string, string>();
		const sourceNamesByPkg = new Map<string, string>();
		for (const extension of installedExtensions) {
			const extensionName = cleanExtensionLabel(extension.name);
			sourceNamesByPkg.set(extension.pkg, extensionName);
			for (const source of extension.sources ?? []) {
				sourceNamesById.set(source.id, source.name);
			}
		}

		const profileByTitleId = new Map(
			profileRows.map((profile) => [profile.libraryTitleId as string, profile] as const)
		);

		const chapterStatsByTitleId = new Map<
			string,
			{
				total: number;
				downloaded: number;
				downloadedBytes: number;
				lastDownloadedAt: number | null;
			}
		>();
		let downloadedChapters = 0;
		let totalDownloadedBytes = 0;

		for (const title of titles) {
			const chapters = chaptersByTitleId.get(String(title._id)) ?? [];

			let downloaded = 0;
			let downloadedBytes = 0;
			let lastDownloadedAt: number | null = null;
			for (const chapter of chapters) {
				if (chapter.downloadStatus !== DOWNLOAD_STATUS.DOWNLOADED) continue;
				downloaded += 1;
				downloadedBytes += chapter.fileSizeBytes ?? 0;
				const downloadedAt = chapter.downloadedAt ?? chapter.updatedAt;
				lastDownloadedAt =
					lastDownloadedAt === null ? downloadedAt : Math.max(lastDownloadedAt, downloadedAt);
			}

			downloadedChapters += downloaded;
			totalDownloadedBytes += downloadedBytes;
			chapterStatsByTitleId.set(title._id as string, {
				total: chapters.length,
				downloaded,
				downloadedBytes,
				lastDownloadedAt
			});
		}

		const activeTaskRows = [...queuedTaskRows, ...downloadingTaskRows].sort(
			(left, right) => right.updatedAt - left.updatedAt
		);
		const recentTaskRows = [...completedTaskRows, ...failedTaskRows, ...cancelledTaskRows]
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.slice(0, recentLimit);

		const queuedTaskCountByTitleId = new Map<string, number>();
		for (const task of activeTaskRows) {
			const key = String(task.libraryTitleId);
			queuedTaskCountByTitleId.set(key, (queuedTaskCountByTitleId.get(key) ?? 0) + 1);
		}

		const watchedTitles = titles
			.map((title) => {
				const titleId = String(title._id);
				const profile = profileByTitleId.get(titleId) ?? null;
				const stats = chapterStatsByTitleId.get(titleId) ?? {
					total: 0,
					downloaded: 0,
					downloadedBytes: 0,
					lastDownloadedAt: null
				};
				if (!profile && stats.downloaded === 0) {
					return null;
				}

				const sourceName =
					sourceNamesById.get(title.sourceId) ??
					sourceNamesByPkg.get(title.sourcePkg) ??
					humanizeSourcePkg(title.sourcePkg);
				const queuedTasks = queuedTaskCountByTitleId.get(titleId) ?? 0;
				const updatedAt = profile?.updatedAt ?? stats.lastDownloadedAt ?? title.updatedAt;

				return {
					titleId,
					title: title.title,
					coverUrl: title.coverUrl ?? null,
					localCoverPath: title.localCoverPath ?? null,
					enabled: profile?.enabled ?? false,
					paused: profile?.paused ?? false,
					autoDownload: profile?.autoDownload ?? true,
					downloadedChapters: stats.downloaded,
					totalChapters: stats.total,
					queuedTasks,
					downloadedBytes: stats.downloadedBytes,
					variantSources: [`${sourceName}${title.sourceLang ? ` [${title.sourceLang}]` : ''}`],
					updatedAt
				};
			})
			.filter((item): item is NonNullable<typeof item> => item !== null)
			.sort((left, right) => {
				if (left.enabled !== right.enabled) {
					return left.enabled ? -1 : 1;
				}
				return right.updatedAt - left.updatedAt;
			})
			.slice(0, watchedLimit);

		return {
			generatedAt: Date.now(),
			overview: {
				downloadedChapters,
				avgChapterSizeBytes:
					downloadedChapters > 0 ? Math.round(totalDownloadedBytes / downloadedChapters) : 0
			},
			activeTasks: activeTaskRows.slice(0, activeLimit).map(mapDownloadTaskRow),
			recentTasks: recentTaskRows.map(mapDownloadTaskRow),
			watchedTitles
		};
	}
});

function mapDownloadTaskRow(task: {
	_id: string;
	libraryTitleId: string;
	libraryChapterId: string;
	titleName: string;
	chapterName: string;
	status: 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';
	progressPercent?: number | null;
	errorMessage?: string | null;
	chapterUrl?: string;
	coverUrl?: string | null;
	localCoverPath?: string | null;
	localRelativePath?: string | null;
	storageKind?: 'directory' | 'archive' | null;
	fileSizeBytes?: number | null;
	updatedAt: number;
}): {
	taskId: string;
	titleId: string;
	chapterId: string;
	title: string;
	chapter: string;
	chapterUrl?: string;
	status: 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';
	progressPercent: number;
	isPaused: boolean;
	error: string | null;
	coverUrl: string | null;
	localCoverPath: string | null;
	localRelativePath: string | null;
	storageKind: 'directory' | 'archive' | null;
	fileSizeBytes: number | null;
	updatedAt: number;
} {
	return {
		taskId: String(task._id),
		titleId: String(task.libraryTitleId),
		chapterId: String(task.libraryChapterId),
		title: task.titleName,
		chapter: task.chapterName,
		chapterUrl: task.chapterUrl,
		status: task.status,
		progressPercent: task.progressPercent ?? 0,
		isPaused: false,
		error: task.errorMessage ?? null,
		coverUrl: task.coverUrl ?? null,
		localCoverPath: task.localCoverPath ?? null,
		localRelativePath: task.localRelativePath ?? null,
		storageKind: task.storageKind ?? null,
		fileSizeBytes: task.fileSizeBytes ?? null,
		updatedAt: task.updatedAt
	};
}
