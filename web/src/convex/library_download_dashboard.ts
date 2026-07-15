import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { query } from './_generated/server';
import { cleanExtensionLabel, humanizeSourcePkg } from './library_shared';

const DOWNLOAD_TASK_STATUS = {
	QUEUED: 'queued',
	DOWNLOADING: 'downloading',
	COMPLETED: 'completed',
	FAILED: 'failed',
	CANCELLED: 'cancelled'
} as const;

export const getDownloadDashboard = query({
	args: {
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
					totalChapters: 0,
					avgChapterSizeBytes: 0
				},
				activeTasks: [],
				recentTasks: [],
				watchedTitles: [],
				watchedTotal: 0
			};
		}

		const ownerUserId = identity.subject as GenericId<'users'>;
		const activeLimit = Math.max(1, Math.min(Math.floor(args.activeLimit ?? 20), 100));
		const recentLimit = Math.max(1, Math.min(Math.floor(args.recentLimit ?? 20), 100));

		// Load profiles first to ensure we load all titles with profiles.
		// In-flight ("downloading") tasks are intentionally excluded: their progress
		// updates tick every few seconds and would force this query — which scans the
		// full library — to re-run constantly. The downloads page subscribes to
		// `getActiveDownloadProgress` separately for live progress.
		const [
			profileRows,
			installedExtensions,
			queuedTaskRows,
			completedTaskRows,
			failedTaskRows,
			cancelledTaskRows
		] = await Promise.all([
			ctx.db
				.query('downloadProfiles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
				.collect(),
			ctx.db.query('installedExtensions').collect(),
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

		const titles = (
			await ctx.db
				.query('libraryTitles')
				.withIndex('by_owner_user_id_updated_at', (q) => q.eq('ownerUserId', ownerUserId))
				.collect()
		).sort((left, right) => right.updatedAt - left.updatedAt);

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

		// Sum denormalized counts from all library titles.
		let downloadedChapters = 0;
		let totalChapters = 0;
		let totalDownloadedBytes = 0;
		for (const title of titles) {
			downloadedChapters += title.downloadedChapterCount ?? 0;
			totalChapters += title.chapterCount ?? 0;
			totalDownloadedBytes += title.downloadedChapterBytes ?? 0;
		}

		const activeTaskRows = [...queuedTaskRows].sort(
			(left, right) => right.updatedAt - left.updatedAt
		);
		const recentTaskRows = [...completedTaskRows, ...failedTaskRows, ...cancelledTaskRows]
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.slice(0, recentLimit);

		const queuedTaskCountByTitleId = new Map<string, number>();
		for (const task of queuedTaskRows) {
			const key = String(task.libraryTitleId);
			queuedTaskCountByTitleId.set(key, (queuedTaskCountByTitleId.get(key) ?? 0) + 1);
		}

		// Backoff/retry timing per title was previously computed by reading every
		// queued task's command document — up to 200 individual db.get calls per
		// dashboard run. The retry display is best-effort UX, not load-bearing,
		// and is omitted here to keep the query within Convex's syscall budget.
		const nextRetryAtByTitleId = new Map<string, number>();

		const watchedCandidates = titles
			.map((title) => {
				const titleId = String(title._id);
				const profile = profileByTitleId.get(titleId) ?? null;
				const downloadedCount = title.downloadedChapterCount ?? 0;
				const hasDownloadSignal =
					(title.queuedChapterCount ?? 0) > 0 ||
					(title.downloadingChapterCount ?? 0) > 0 ||
					downloadedCount > 0 ||
					(title.failedChapterCount ?? 0) > 0;
				if (!profile && !hasDownloadSignal) {
					return null;
				}

				const sourceName =
					sourceNamesById.get(title.sourceId) ??
					sourceNamesByPkg.get(title.sourcePkg) ??
					humanizeSourcePkg(title.sourcePkg);
				const queuedTasks = queuedTaskCountByTitleId.get(titleId) ?? 0;
				const updatedAt = profile?.updatedAt ?? title.updatedAt;

				return {
					titleId,
					title: title.title,
					coverUrl: title.coverUrl ?? null,
					localCoverPath: title.localCoverPath ?? null,
					enabled: profile?.enabled ?? false,
					paused: profile?.paused ?? false,
					autoDownload: profile?.autoDownload ?? true,
					downloadedChapters: downloadedCount,
					totalChapters: title.chapterCount ?? 0,
					queuedTasks,
					downloadedBytes: title.downloadedChapterBytes ?? 0,
					variantSources: [`${sourceName}${title.sourceLang ? ` [${title.sourceLang}]` : ''}`],
					lastError: profile?.lastError ?? null,
					nextRetryAt: nextRetryAtByTitleId.get(titleId) ?? null,
					updatedAt
				};
			})
			.filter((item): item is NonNullable<typeof item> => item !== null)
			.sort((left, right) => {
				if (left.enabled !== right.enabled) {
					return left.enabled ? -1 : 1;
				}
				return right.updatedAt - left.updatedAt;
			});

		const watchedTitles = watchedCandidates;

		return {
			generatedAt: Date.now(),
			overview: {
				downloadedChapters,
				totalChapters,
				avgChapterSizeBytes:
					downloadedChapters > 0 ? Math.round(totalDownloadedBytes / downloadedChapters) : 0
			},
			activeTasks: activeTaskRows.slice(0, activeLimit).map(mapDownloadTaskRow),
			recentTasks: recentTaskRows.map(mapDownloadTaskRow),
			watchedTitles,
			watchedTotal: watchedCandidates.length
		};
	}
});

export const getActiveDownloadProgress = query({
	args: {
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return { tasks: [] as ReturnType<typeof mapDownloadTaskRow>[] };
		}
		const ownerUserId = identity.subject as GenericId<'users'>;
		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 100), 200));
		const downloadingTaskRows = await ctx.db
			.query('downloadTasks')
			.withIndex('by_owner_user_id_status_updated_at', (q) =>
				q.eq('ownerUserId', ownerUserId).eq('status', DOWNLOAD_TASK_STATUS.DOWNLOADING)
			)
			.order('desc')
			.take(limit);
		return {
			tasks: downloadingTaskRows.map(mapDownloadTaskRow)
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
