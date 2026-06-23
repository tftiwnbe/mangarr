import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import type { Doc } from './_generated/dataModel';
import { internalMutation, mutation, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireBridgeIdentity } from './bridge_auth';
import { collapseChapterReleases } from './chapter_groups';
import {
	chapterBelongsToVariant,
	getPreferredVariantForTitle,
	markTitleListedInLibrary,
	resolveStorageTitleBaseForTitle
} from './library_shared';
import { insertCommand } from './command_payloads';
import {
	applyChapterDownloadCounterDelta,
	applyTaskActiveDownloadCounterDelta
} from './download_counters';
export { getDownloadDashboard, getActiveDownloadProgress } from './library_download_dashboard';

const DOWNLOAD_STATUS = {
	MISSING: 'missing',
	QUEUED: 'queued',
	DOWNLOADING: 'downloading',
	DOWNLOADED: 'downloaded',
	FAILED: 'failed'
} as const;

const DOWNLOAD_TASK_STATUS = {
	QUEUED: 'queued',
	DOWNLOADING: 'downloading',
	COMPLETED: 'completed',
	FAILED: 'failed',
	CANCELLED: 'cancelled'
} as const;
const MAX_ACTIVE_DOWNLOAD_TASKS_PER_USER = 16;
const RESERVED_RUNNING_DOWNLOAD_SLOTS = 2;
const MAX_ENQUEUED_DOWNLOADS_PER_TITLE_REQUEST = 24;
const ACTIVE_DOWNLOAD_RECOVERY_SCAN_LIMIT = 2_000;
const DOWNLOAD_COMMAND_PRIORITY_BASE = 250;
const MANUAL_DOWNLOAD_COMMAND_PRIORITY_BASE = 100;
const CHAPTER_SYNC_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const ACTIVE_CHAPTER_SYNC_COMMAND_STATUSES = new Set(['queued', 'leased', 'running']);

type DownloadTaskStatus = (typeof DOWNLOAD_TASK_STATUS)[keyof typeof DOWNLOAD_TASK_STATUS];

function isActiveDownloadTaskStatus(status: DownloadTaskStatus) {
	return status === DOWNLOAD_TASK_STATUS.QUEUED || status === DOWNLOAD_TASK_STATUS.DOWNLOADING;
}

async function loadActiveTitleChapterReleases(
	ctx: QueryCtx | MutationCtx,
	title: {
		_id: GenericId<'libraryTitles'>;
		ownerUserId: GenericId<'users'>;
		preferredVariantId?: GenericId<'titleVariants'>;
		sourceId: string;
		sourcePkg: string;
		titleUrl: string;
	}
) {
	const [chapters, preferredVariant] = await Promise.all([
		ctx.db
			.query('libraryChapters')
			.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
			.collect(),
		getPreferredVariantForTitle(ctx, title)
	]);
	const activeChapterSource = preferredVariant ?? title;
	return chapters.filter((chapter) => chapterBelongsToVariant(chapter, activeChapterSource));
}

function selectDownloadableGroupedChapters(chapters: readonly Doc<'libraryChapters'>[]) {
	return collapseChapterReleases(chapters).filter((chapter) =>
		chapter.releases.some((release) => release.isAvailableFromSource !== false)
	);
}

export const cancelQueuedChapterDownload = mutation({
	args: {
		chapterId: v.id('libraryChapters')
	},
	handler: async (ctx, args) => {
		const chapter = await requireOwnedChapter(ctx, args.chapterId);
		if (chapter.downloadStatus !== DOWNLOAD_STATUS.QUEUED) {
			throw new Error('Only queued downloads can be cancelled');
		}

		const userId = chapter.ownerUserId;
		const activeTask = await findActiveDownloadTaskForChapter(ctx, userId, chapter._id);
		if (!activeTask || activeTask.status !== DOWNLOAD_TASK_STATUS.QUEUED) {
			throw new Error('Active queued download task not found');
		}

		const now = Date.now();
		if (activeTask.commandId) {
			const command = await ctx.db.get(activeTask.commandId);
			if (
				command &&
				command.requestedByUserId === userId &&
				command.commandType === 'downloads.chapter' &&
				command.status === 'queued'
			) {
				await ctx.db.patch(command._id, {
					status: 'cancelled',
					lastErrorMessage: 'Cancelled by user',
					updatedAt: now
				});
			}
		}

		await ctx.db.patch(activeTask._id, {
			status: DOWNLOAD_TASK_STATUS.CANCELLED,
			errorMessage: 'Cancelled by user',
			cancelledAt: now,
			completedAt: now,
			updatedAt: now
		});
		await applyTaskActiveDownloadCounterDelta(ctx, {
			ownerUserId: userId,
			oldStatus: activeTask.status,
			newStatus: DOWNLOAD_TASK_STATUS.CANCELLED
		});

		await ctx.db.patch(chapter._id, {
			downloadStatus: DOWNLOAD_STATUS.MISSING,
			downloadedPages: 0,
			totalPages: undefined,
			lastErrorMessage: undefined,
			updatedAt: now
		});
		await applyChapterDownloadCounterDelta(ctx, {
			libraryTitleId: chapter.libraryTitleId,
			oldStatus: chapter.downloadStatus,
			newStatus: DOWNLOAD_STATUS.MISSING,
			oldFileSizeBytes: chapter.fileSizeBytes,
			newFileSizeBytes: undefined
		});

		return { ok: true, taskId: activeTask._id };
	}
});

export const requestChapterDownload = mutation({
	args: {
		chapterId: v.id('libraryChapters')
	},
	handler: async (ctx, args) => {
		const chapter = await requireOwnedChapter(ctx, args.chapterId);
		const title = await ctx.db.get(chapter.libraryTitleId);
		if (!title || title.ownerUserId !== chapter.ownerUserId) {
			throw new Error('Library title not found');
		}

		const userId = chapter.ownerUserId;
		const now = Date.now();
		await markTitleListedInLibrary(ctx, title, now);
		await recoverActiveDownloadsInternal(ctx, {
			now,
			forceRunningCommands: false,
			ownerUserId: userId
		});
		const queued = await queueDownloadAttempt(ctx, {
			chapter,
			title,
			requestedByUserId: userId,
			trigger: 'manual',
			priority: 100,
			now
		});

		return {
			commandId: queued.commandId,
			taskId: queued.taskId,
			alreadyQueued: queued.alreadyQueued
		};
	}
});

export const updateDownloadProfile = mutation({
	args: {
		titleId: v.id('libraryTitles'),
		enabled: v.optional(v.boolean()),
		paused: v.optional(v.boolean()),
		autoDownload: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const userId = title.ownerUserId;
		const now = Date.now();
		await markTitleListedInLibrary(ctx, title, now);
		const current = await ctx.db
			.query('downloadProfiles')
			.withIndex('by_owner_user_id_library_title_id', (q) =>
				q.eq('ownerUserId', userId).eq('libraryTitleId', title._id)
			)
			.unique();

		if (!current) {
			const profileId = await ctx.db.insert('downloadProfiles', {
				ownerUserId: userId,
				libraryTitleId: title._id,
				enabled: args.enabled ?? false,
				paused: args.paused ?? false,
				autoDownload: args.autoDownload ?? true,
				createdAt: now,
				updatedAt: now
			});
			const created = await ctx.db.get(profileId);
			if (!created) {
				throw new Error('Failed to create download profile');
			}
			return {
				id: created._id,
				enabled: created.enabled,
				paused: created.paused,
				autoDownload: created.autoDownload,
				lastChapterSyncRequestedAt: created.lastChapterSyncRequestedAt ?? null,
				lastChapterSyncAt: created.lastChapterSyncAt ?? null,
				lastCheckedAt: created.lastCheckedAt ?? null,
				lastSuccessAt: created.lastSuccessAt ?? null,
				lastError: created.lastError ?? null
			};
		}

		await ctx.db.patch(current._id, {
			enabled: args.enabled ?? current.enabled,
			paused: args.paused ?? current.paused,
			autoDownload: args.autoDownload ?? current.autoDownload,
			updatedAt: now
		});

		const updated = await ctx.db.get(current._id);
		if (!updated) {
			throw new Error('Failed to update download profile');
		}

		return {
			id: updated._id,
			enabled: updated.enabled,
			paused: updated.paused,
			autoDownload: updated.autoDownload,
			lastChapterSyncRequestedAt: updated.lastChapterSyncRequestedAt ?? null,
			lastChapterSyncAt: updated.lastChapterSyncAt ?? null,
			lastCheckedAt: updated.lastCheckedAt ?? null,
			lastSuccessAt: updated.lastSuccessAt ?? null,
			lastError: updated.lastError ?? null
		};
	}
});

export const runDownloadCycle = mutation({
	args: {
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const userId = await requireViewerUserId(ctx);
		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 25), 100));
		return runDownloadCycleForUser(ctx, {
			userId,
			limit,
			now: Date.now()
		});
	}
});

export const runScheduledDownloadCycles = internalMutation({
	args: {
		limitPerUser: v.optional(v.float64()),
		maxUsers: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const limitPerUser = Math.max(1, Math.min(Math.floor(args.limitPerUser ?? 25), 100));
		const maxUsers = Math.max(1, Math.min(Math.floor(args.maxUsers ?? 50), 500));
		const now = Date.now();
		// Use the by_enabled_updated_at index to fetch only enabled profiles, ordered
		// most-recently-active first.  We read up to maxUsers * 5 rows to give the
		// dedup loop enough candidates to fill maxUsers distinct users even when a
		// single user owns several profiles.
		const enabledProfiles = await ctx.db
			.query('downloadProfiles')
			.withIndex('by_enabled_updated_at', (q) => q.eq('enabled', true))
			.order('desc')
			.take(maxUsers * 5);

		const orderedUserIds: GenericId<'users'>[] = [];
		const seenUserIds = new Set<string>();
		for (const profile of enabledProfiles) {
			const key = String(profile.ownerUserId);
			if (seenUserIds.has(key)) continue;
			seenUserIds.add(key);
			orderedUserIds.push(profile.ownerUserId);
			if (orderedUserIds.length >= maxUsers) break;
		}

		let usersChecked = 0;
		let profilesChecked = 0;
		let enqueued = 0;
		for (const userId of orderedUserIds) {
			const result = await runDownloadCycleForUser(ctx, { userId, limit: limitPerUser, now });
			if (result.checked === 0) continue;
			usersChecked += 1;
			profilesChecked += result.checked;
			enqueued += result.enqueued;
		}

		return {
			recoveredTasks: 0,
			requeuedTasks: 0,
			failedTasks: 0,
			usersChecked,
			profilesChecked,
			enqueued
		};
	}
});

export const recoverActiveDownloads = mutation({
	args: {
		now: v.float64(),
		forceRunningCommands: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		return recoverActiveDownloadsInternal(ctx, {
			now: args.now,
			forceRunningCommands: args.forceRunningCommands ?? false
		});
	}
});

export const requestMissingDownloads = mutation({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const userId = await requireViewerUserId(ctx);
		const now = Date.now();
		await markTitleListedInLibrary(ctx, title, now);
		await recoverActiveDownloadsInternal(ctx, {
			now,
			forceRunningCommands: false,
			ownerUserId: userId
		});

		const [titleChapters, queuedTaskRows] = await Promise.all([
			loadActiveTitleChapterReleases(ctx, title),
			ctx.db
				.query('downloadTasks')
				.withIndex('by_owner_user_id_status_updated_at', (q) =>
					q.eq('ownerUserId', userId).eq('status', DOWNLOAD_TASK_STATUS.QUEUED)
				)
				.order('desc')
				.take(MAX_ACTIVE_DOWNLOAD_TASKS_PER_USER)
		]);

		const queuedTaskChapters = (
			await Promise.all(
				queuedTaskRows
					.filter((task) => task.libraryTitleId === title._id)
					.map((task) => ctx.db.get(task.libraryChapterId))
			)
		).filter(
			(chapter): chapter is NonNullable<typeof chapter> =>
				chapter !== null && chapter.libraryTitleId === title._id && chapter.ownerUserId === userId
		);

		const queuedChapters = titleChapters.filter(
			(chapter) => chapter.downloadStatus === DOWNLOAD_STATUS.QUEUED
		);
		const eligibleRetryChapters = [...queuedChapters, ...queuedTaskChapters]
			.filter(
				(chapter, index, chapters) =>
					chapters.findIndex((entry) => entry._id === chapter._id) === index
			)
			.sort((left, right) => left.sequence - right.sequence);
		let retriedQueued = 0;
		for (const chapter of eligibleRetryChapters) {
			const queued = await queueDownloadAttempt(ctx, {
				chapter,
				title,
				requestedByUserId: userId,
				trigger: 'retry',
				priority: DOWNLOAD_COMMAND_PRIORITY_BASE,
				now
			});
			if (!queued.alreadyQueued) {
				retriedQueued += 1;
			}
		}

		const eligible = selectDownloadableGroupedChapters(titleChapters)
			.filter(
				(chapter) =>
					chapter.downloadStatus === DOWNLOAD_STATUS.MISSING ||
					chapter.downloadStatus === DOWNLOAD_STATUS.FAILED
			);
		const orderedEligible = prioritizeMissingBeforeFailed(eligible);
		const remainingSlots = await remainingDownloadCapacityForUser(ctx, userId);
		if (remainingSlots <= 0) {
			return {
				enqueued: 0,
				commandIds: [],
				taskIds: [],
				deferred: orderedEligible.length,
				retriedQueued,
				blocked:
					orderedEligible.length > 0
						? ('capacity' as const)
						: retriedQueued > 0
							? null
							: ('no_candidates' as const)
			};
		}
		const chaptersToQueue = orderedEligible.slice(
			0,
			Math.min(MAX_ENQUEUED_DOWNLOADS_PER_TITLE_REQUEST, remainingSlots)
		);

		const commandIds: GenericId<'commands'>[] = [];
		const taskIds: GenericId<'downloadTasks'>[] = [];
		let priorityOffset = 0;
		for (const chapter of chaptersToQueue) {
			const queued = await queueDownloadAttempt(ctx, {
				chapter,
				title,
				requestedByUserId: userId,
				trigger: 'retry',
				priority: MANUAL_DOWNLOAD_COMMAND_PRIORITY_BASE + priorityOffset,
				now
			});
			if (queued.alreadyQueued) {
				continue;
			}
			priorityOffset += 1;
			if (queued.commandId) {
				commandIds.push(queued.commandId);
			}
			taskIds.push(queued.taskId);
		}

		return {
			enqueued: commandIds.length,
			commandIds,
			taskIds,
			deferred: Math.max(0, orderedEligible.length - chaptersToQueue.length),
			retriedQueued,
			blocked:
				commandIds.length > 0 || retriedQueued > 0 ? null : ('no_candidates' as const)
		};
	}
});

export const setChapterDownloadState = mutation({
	args: {
		chapterId: v.id('libraryChapters'),
		downloadTaskId: v.optional(v.id('downloadTasks')),
		status: v.union(
			v.literal('missing'),
			v.literal('queued'),
			v.literal('downloading'),
			v.literal('downloaded'),
			v.literal('failed')
		),
		downloadedPages: v.optional(v.float64()),
		totalPages: v.optional(v.float64()),
		localRelativePath: v.optional(v.union(v.string(), v.null())),
		storageKind: v.optional(v.union(v.literal('directory'), v.literal('archive'), v.null())),
		fileSizeBytes: v.optional(v.float64()),
		lastErrorMessage: v.optional(v.union(v.string(), v.null())),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const chapter = await ctx.db.get(args.chapterId);
		if (!chapter) {
			throw new Error('Library chapter not found');
		}

		const oldStatus = chapter.downloadStatus;
		const oldFileSizeBytes = chapter.fileSizeBytes;
		const newFileSizeBytes =
			args.fileSizeBytes === undefined ? chapter.fileSizeBytes : args.fileSizeBytes;
		const isProgressOnlyUpdate =
			args.status === DOWNLOAD_STATUS.DOWNLOADING &&
			oldStatus === DOWNLOAD_STATUS.DOWNLOADING &&
			args.localRelativePath === undefined &&
			args.storageKind === undefined &&
			args.fileSizeBytes === undefined &&
			args.lastErrorMessage === undefined;
		let chapterPatched = false;

		if (!isProgressOnlyUpdate) {
			try {
				await ctx.db.patch(chapter._id, {
					downloadStatus: args.status,
					downloadedPages: args.downloadedPages ?? chapter.downloadedPages,
					totalPages: args.totalPages ?? chapter.totalPages,
					localRelativePath:
						args.localRelativePath === undefined
							? chapter.localRelativePath
							: (args.localRelativePath ?? undefined),
					storageKind:
						args.storageKind === undefined ? chapter.storageKind : (args.storageKind ?? undefined),
					fileSizeBytes: newFileSizeBytes,
					lastErrorMessage:
						args.lastErrorMessage === undefined
							? chapter.lastErrorMessage
							: normalizeOptionalString(args.lastErrorMessage),
					downloadedAt:
						args.status === DOWNLOAD_STATUS.DOWNLOADED ? args.now : chapter.downloadedAt,
					updatedAt: args.now
				});
				chapterPatched = true;
			} catch (error) {
				if (!(error instanceof Error) || !error.message?.includes('changed while this mutation')) {
					throw error;
				}
				const latestChapter = await ctx.db.get(args.chapterId);
				if (!latestChapter || !isConcurrentDownloadStateSatisfied(latestChapter, args)) {
					throw error;
				}
			}
		}

		const statusChanged = oldStatus !== args.status;
		const sizeChanged = (oldFileSizeBytes ?? 0) !== (newFileSizeBytes ?? 0);
		if (chapterPatched && !isProgressOnlyUpdate && (statusChanged || sizeChanged)) {
			await applyChapterDownloadCounterDelta(ctx, {
				libraryTitleId: chapter.libraryTitleId,
				oldStatus,
				newStatus: args.status,
				oldFileSizeBytes,
				newFileSizeBytes
			});
		}

		const task =
			(args.downloadTaskId ? await ctx.db.get(args.downloadTaskId) : null) ??
			(await findLatestDownloadTaskForChapter(ctx, args.chapterId));
		if (!task || task.libraryChapterId !== chapter._id || args.status === DOWNLOAD_STATUS.MISSING) {
			return { ok: true };
		}

		if (
			args.status === DOWNLOAD_STATUS.DOWNLOADING &&
			task.status === DOWNLOAD_TASK_STATUS.DOWNLOADING &&
			args.downloadedPages == null &&
			args.totalPages == null
		) {
			return { ok: true };
		}

		const downloadedPages = args.downloadedPages ?? task.downloadedPages;
		const totalPages = args.totalPages ?? task.totalPages;
		const percent =
			args.status === DOWNLOAD_STATUS.DOWNLOADED
				? 100
				: computeProgressPercent(downloadedPages, totalPages);
		const errorMessage = normalizeOptionalString(args.lastErrorMessage);

		const taskPatch: Partial<typeof task> = {
			downloadedPages,
			totalPages,
			progressPercent: percent,
			localRelativePath:
				args.localRelativePath === undefined
					? task.localRelativePath
					: (args.localRelativePath ?? undefined),
			storageKind:
				args.storageKind === undefined ? task.storageKind : (args.storageKind ?? undefined),
			fileSizeBytes: args.fileSizeBytes === undefined ? task.fileSizeBytes : args.fileSizeBytes,
			errorMessage:
				args.status === DOWNLOAD_STATUS.FAILED
					? (errorMessage ?? task.errorMessage)
					: (errorMessage ?? undefined),
			updatedAt: args.now
		};

		if (args.status === DOWNLOAD_STATUS.QUEUED) {
			taskPatch.status = DOWNLOAD_TASK_STATUS.QUEUED;
		} else if (args.status === DOWNLOAD_STATUS.DOWNLOADING) {
			taskPatch.status = DOWNLOAD_TASK_STATUS.DOWNLOADING;
			taskPatch.startedAt = task.startedAt ?? args.now;
		} else if (args.status === DOWNLOAD_STATUS.DOWNLOADED) {
			taskPatch.status = DOWNLOAD_TASK_STATUS.COMPLETED;
			taskPatch.progressPercent = 100;
			taskPatch.errorMessage = undefined;
			taskPatch.startedAt = task.startedAt ?? args.now;
			taskPatch.completedAt = args.now;
		} else if (args.status === DOWNLOAD_STATUS.FAILED) {
			taskPatch.status = DOWNLOAD_TASK_STATUS.FAILED;
			taskPatch.startedAt = task.startedAt ?? args.now;
			taskPatch.completedAt = args.now;
		}

		await ctx.db.patch(task._id, taskPatch);
		await applyTaskActiveDownloadCounterDelta(ctx, {
			ownerUserId: task.ownerUserId,
			oldStatus: task.status,
			newStatus: taskPatch.status ?? task.status
		});

		return { ok: true };
	}
});

export const syncChapterStorageStateFromBridge = mutation({
	args: {
		chapterId: v.id('libraryChapters'),
		status: v.union(v.literal('missing'), v.literal('downloaded')),
		downloadedPages: v.optional(v.float64()),
		totalPages: v.optional(v.float64()),
		localRelativePath: v.optional(v.union(v.string(), v.null())),
		storageKind: v.optional(v.union(v.literal('directory'), v.literal('archive'), v.null())),
		fileSizeBytes: v.optional(v.union(v.float64(), v.null())),
		lastErrorMessage: v.optional(v.union(v.string(), v.null())),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const chapter = await ctx.db.get(args.chapterId);
		if (!chapter) {
			throw new Error('Library chapter not found');
		}

		const oldStatus = chapter.downloadStatus;
		const oldFileSizeBytes = chapter.fileSizeBytes;
		const newFileSizeBytes =
			args.fileSizeBytes === undefined ? chapter.fileSizeBytes : (args.fileSizeBytes ?? undefined);

		try {
			await ctx.db.patch(chapter._id, {
				downloadStatus: args.status,
				downloadedPages: args.downloadedPages ?? chapter.downloadedPages,
				totalPages: args.totalPages ?? chapter.totalPages,
				localRelativePath:
					args.localRelativePath === undefined
						? chapter.localRelativePath
						: (args.localRelativePath ?? undefined),
				storageKind:
					args.storageKind === undefined ? chapter.storageKind : (args.storageKind ?? undefined),
				fileSizeBytes: newFileSizeBytes,
				lastErrorMessage:
					args.lastErrorMessage === undefined
						? chapter.lastErrorMessage
						: normalizeOptionalString(args.lastErrorMessage),
				downloadedAt:
					args.status === DOWNLOAD_STATUS.DOWNLOADED ? args.now : chapter.downloadedAt,
				updatedAt: args.now
			});
		} catch (error) {
			if (!(error instanceof Error) || !error.message?.includes('changed while this mutation')) {
				throw error;
			}
			const latestChapter = await ctx.db.get(args.chapterId);
			if (!latestChapter || !isConcurrentDownloadStateSatisfied(latestChapter, args)) {
				throw error;
			}
			return { ok: true };
		}

		const statusChanged = oldStatus !== args.status;
		const sizeChanged = (oldFileSizeBytes ?? 0) !== (newFileSizeBytes ?? 0);
		if (statusChanged || sizeChanged) {
			await applyChapterDownloadCounterDelta(ctx, {
				libraryTitleId: chapter.libraryTitleId,
				oldStatus,
				newStatus: args.status,
				oldFileSizeBytes,
				newFileSizeBytes
			});
		}

		return { ok: true };
	}
});

async function countRecentConsecutiveFailures(
	ctx: QueryCtx | MutationCtx,
	chapterId: GenericId<'libraryChapters'>
) {
	const recentTasks = await ctx.db
		.query('downloadTasks')
		.withIndex('by_library_chapter_id_created_at', (q) => q.eq('libraryChapterId', chapterId))
		.order('desc')
		.take(10);

	let consecutiveFailures = 0;
	for (const task of recentTasks) {
		if (task.status === DOWNLOAD_TASK_STATUS.FAILED) {
			consecutiveFailures += 1;
		} else if (task.status === DOWNLOAD_TASK_STATUS.COMPLETED) {
			// Stop counting if we hit a successful download
			break;
		}
		// Skip queued/downloading/cancelled and keep counting
	}

	return consecutiveFailures;
}

async function queueDownloadAttempt(
	ctx: MutationCtx,
	args: {
		chapter: DocLike<'libraryChapters'>;
		title: DocLike<'libraryTitles'>;
		requestedByUserId: GenericId<'users'>;
		trigger: 'manual' | 'watch' | 'retry';
		priority: number;
		now: number;
	}
) {
	const storageTitleBase = await resolveStorageTitleBaseForTitle(ctx, args.title);
	const activeTask = await findActiveDownloadTaskForChapter(
		ctx,
		args.chapter.ownerUserId,
		args.chapter._id
	);
	if (activeTask) {
		let effectiveCommandId = activeTask.commandId ?? null;
		if (args.trigger !== 'watch' && activeTask.status === DOWNLOAD_TASK_STATUS.QUEUED) {
			const command = activeTask.commandId ? await ctx.db.get(activeTask.commandId) : null;
			const canPromoteQueuedCommand =
				command &&
				command.requestedByUserId === args.requestedByUserId &&
				command.commandType === 'downloads.chapter' &&
				command.status === 'queued';
			const canRecoverExpiredLeasedCommand =
				command &&
				command.requestedByUserId === args.requestedByUserId &&
				command.commandType === 'downloads.chapter' &&
				(command.status === 'leased' || command.status === 'running') &&
				(command.leaseExpiresAt ?? 0) <= args.now;

			if (canPromoteQueuedCommand) {
				await ctx.db.patch(command._id, {
					runAfter: args.now,
					priority: Math.min(command.priority, args.priority),
					lastErrorMessage: undefined,
					updatedAt: args.now
				});
				effectiveCommandId = command._id;
				await ctx.db.patch(activeTask._id, {
					errorMessage: undefined,
					updatedAt: args.now
				});
			} else if (canRecoverExpiredLeasedCommand) {
				await ctx.db.patch(command._id, {
					status: 'queued',
					runAfter: args.now,
					priority: Math.min(command.priority, args.priority),
					leaseOwnerBridgeId: undefined,
					leaseToken: undefined,
					leaseExpiresAt: undefined,
					lastErrorMessage: undefined,
					updatedAt: args.now
				});
				effectiveCommandId = command._id;
				await ctx.db.patch(activeTask._id, {
					errorMessage: undefined,
					updatedAt: args.now
				});
			} else if (!command || ['failed', 'dead_letter', 'cancelled'].includes(command.status)) {
				const replacementCommandId = await insertCommand(ctx, {
					commandType: 'downloads.chapter',
					requestedByUserId: args.requestedByUserId,
					payload: buildDownloadCommandPayload(args.chapter, activeTask._id, storageTitleBase),
					idempotencyKey: `downloads.chapter:${String(args.chapter._id)}:retry:${args.now}`,
					priority: args.priority,
					maxAttempts: 10,
					runAfter: args.now,
					now: args.now
				});
				effectiveCommandId = replacementCommandId;
				await ctx.db.patch(activeTask._id, {
					commandId: replacementCommandId,
					errorMessage: undefined,
					updatedAt: args.now
				});
			}
		}
		return {
			taskId: activeTask._id,
			commandId: effectiveCommandId,
			alreadyQueued: true
		};
	}

	await ctx.db.patch(args.chapter._id, {
		downloadStatus: DOWNLOAD_STATUS.QUEUED,
		downloadedPages: 0,
		totalPages: undefined,
		lastErrorMessage: undefined,
		updatedAt: args.now
	});
	await applyChapterDownloadCounterDelta(ctx, {
		libraryTitleId: args.chapter.libraryTitleId,
		oldStatus: args.chapter.downloadStatus,
		newStatus: DOWNLOAD_STATUS.QUEUED,
		oldFileSizeBytes: args.chapter.fileSizeBytes,
		newFileSizeBytes: undefined
	});

	const attemptNumber = await nextDownloadAttemptNumber(ctx, args.chapter._id);

	// Only background watcher retries should respect the long cooldown after repeated failures.
	const recentFailures = await countRecentConsecutiveFailures(ctx, args.chapter._id);
	const shouldDelayRetry = args.trigger === 'watch' && recentFailures >= 3;
	const runAfter = shouldDelayRetry
		? args.now + 24 * 60 * 60 * 1000 // Retry tomorrow if multiple consecutive failures
		: args.now;

	const taskId = await ctx.db.insert('downloadTasks', {
		ownerUserId: args.chapter.ownerUserId,
		requestedByUserId: args.requestedByUserId,
		libraryTitleId: args.title._id,
		libraryChapterId: args.chapter._id,
		commandId: undefined,
		trigger: args.trigger,
		attemptNumber,
		status: DOWNLOAD_TASK_STATUS.QUEUED,
		titleName: args.title.title,
		chapterName: args.chapter.chapterName,
		chapterUrl: args.chapter.chapterUrl,
		coverUrl: args.title.coverUrl,
		localCoverPath: args.title.localCoverPath,
		downloadedPages: 0,
		progressPercent: 0,
		createdAt: args.now,
		updatedAt: args.now
	});
	await applyTaskActiveDownloadCounterDelta(ctx, {
		ownerUserId: args.chapter.ownerUserId,
		oldStatus: undefined,
		newStatus: DOWNLOAD_TASK_STATUS.QUEUED
	});

	const commandId = await insertCommand(ctx, {
		commandType: 'downloads.chapter',
		requestedByUserId: args.requestedByUserId,
		payload: buildDownloadCommandPayload(args.chapter, taskId, storageTitleBase),
		idempotencyKey: `downloads.chapter:${String(args.chapter._id)}:${attemptNumber}:${args.now}`,
		priority: args.priority,
		maxAttempts: 10, // Increased from 3 to 10 for pay-to-read or temporarily unavailable chapters
		runAfter,
		now: args.now
	});

	await ctx.db.patch(taskId, {
		commandId,
		updatedAt: args.now
	});

	return {
		taskId,
		commandId,
		alreadyQueued: false
	};
}

async function recoverActiveDownloadsInternal(
	ctx: MutationCtx,
	args: {
		now: number;
		forceRunningCommands: boolean;
		ownerUserId?: GenericId<'users'>;
	}
) {
	const activeTasks = await loadActiveDownloadTasks(
		ctx,
		ACTIVE_DOWNLOAD_RECOVERY_SCAN_LIMIT,
		args.ownerUserId
	);
	let requeuedTasks = 0;
	let failedTasks = 0;
	const dirtyTitles = new Map<string, GenericId<'users'>>();

	for (const task of activeTasks) {
		const chapter = await ctx.db.get(task.libraryChapterId);
		if (!chapter || chapter.ownerUserId !== task.ownerUserId) {
			continue;
		}

		const command = task.commandId ? await ctx.db.get(task.commandId) : null;
		const commandStatus = command?.status ?? null;
		const commandExpired =
			command && (commandStatus === 'leased' || commandStatus === 'running')
				? (command.leaseExpiresAt ?? 0) <= args.now
				: false;
		const shouldForceRequeueRunningCommand =
			args.forceRunningCommands &&
			command &&
			command.commandType === 'downloads.chapter' &&
			(commandStatus === 'leased' || commandStatus === 'running');
		const shouldRequeue =
			commandStatus === 'queued' ||
			commandExpired ||
			shouldForceRequeueRunningCommand ||
			command === null;
		const hasDownloadedStorage =
			chapter.downloadStatus === DOWNLOAD_STATUS.DOWNLOADED &&
			typeof chapter.localRelativePath === 'string' &&
			chapter.localRelativePath.length > 0 &&
			typeof chapter.storageKind === 'string';

		if (hasDownloadedStorage) {
			await finalizeRecoveredCompletedTask(ctx, task, chapter, args.now);
			dirtyTitles.set(String(chapter.libraryTitleId), chapter.ownerUserId);
			continue;
		}

		if (shouldRequeue) {
			await requeueRecoveredTask(ctx, task, chapter, command, args.now);
			dirtyTitles.set(String(chapter.libraryTitleId), chapter.ownerUserId);
			requeuedTasks += 1;
			continue;
		}

		if (commandStatus === 'dead_letter' || commandStatus === 'cancelled') {
			const errorMessage = command?.lastErrorMessage ?? task.errorMessage ?? 'Download failed';
			await failRecoveredTask(
				ctx,
				task,
				chapter,
				commandStatus === 'cancelled'
					? DOWNLOAD_TASK_STATUS.CANCELLED
					: DOWNLOAD_TASK_STATUS.FAILED,
				errorMessage,
				args.now
			);
			dirtyTitles.set(String(chapter.libraryTitleId), chapter.ownerUserId);
			failedTasks += 1;
		}
	}

	return {
		recoveredTasks: requeuedTasks + failedTasks,
		requeuedTasks,
		failedTasks
	};
}

async function findLatestDownloadTaskForChapter(
	ctx: QueryCtx | MutationCtx,
	chapterId: GenericId<'libraryChapters'>
) {
	return (
		(
			await ctx.db
				.query('downloadTasks')
				.withIndex('by_library_chapter_id_created_at', (q) => q.eq('libraryChapterId', chapterId))
				.order('desc')
				.take(1)
		)[0] ?? null
	);
}

function shouldTreatDownloadFailureAsPermanent(
	task: {
		status: string;
		errorMessage?: string | null;
	} | null
) {
	if (!task || task.status !== DOWNLOAD_TASK_STATUS.FAILED) {
		return false;
	}

	return (task.errorMessage ?? '').toLowerCase().includes('http error 404');
}

function prioritizeMissingBeforeFailed<
	T extends {
		downloadStatus: string;
		sequence: number;
	}
>(chapters: readonly T[]) {
	const missing: T[] = [];
	const failed: T[] = [];
	for (const chapter of chapters) {
		if (chapter.downloadStatus === DOWNLOAD_STATUS.FAILED) {
			failed.push(chapter);
		} else {
			missing.push(chapter);
		}
	}
	missing.sort((left, right) => left.sequence - right.sequence);
	failed.sort((left, right) => left.sequence - right.sequence);
	return [...missing, ...failed];
}

async function runDownloadCycleForUser(
	ctx: MutationCtx,
	args: {
		userId: GenericId<'users'>;
		limit: number;
		now: number;
	}
) {
	await recoverActiveDownloadsInternal(ctx, {
		now: args.now,
		forceRunningCommands: false,
		ownerUserId: args.userId
	});
	const cyclePlan = await selectDownloadCycleCandidatesForUser(ctx, args);
	if (cyclePlan.hasInFlightDownloads) {
		return { checked: cyclePlan.checkedProfiles, enqueued: 0, blocked: 'in_flight' as const };
	}
	let remainingCapacity = await remainingDownloadCapacityForUser(ctx, args.userId);
	if (remainingCapacity <= 0) {
		return { checked: cyclePlan.checkedProfiles, enqueued: 0, blocked: 'capacity' as const };
	}

	let enqueued = 0;
	let eligibleChapters = 0;
	for (const entry of cyclePlan.entries) {
		eligibleChapters += entry.chapters.length;
	}
	while (remainingCapacity > 0) {
		let progressed = false;
		for (const entry of cyclePlan.entries) {
			if (remainingCapacity <= 0) {
				break;
			}
			const chapter = entry.chapters[entry.nextIndex];
			if (!chapter) {
				continue;
			}
			entry.nextIndex += 1;
			const queued = await queueDownloadAttempt(ctx, {
				chapter,
				title: entry.title,
				requestedByUserId: args.userId,
				trigger: 'watch',
				priority: DOWNLOAD_COMMAND_PRIORITY_BASE + entry.enqueued,
				now: args.now
			});
			if (queued.alreadyQueued) {
				continue;
			}
			entry.enqueued += 1;
			enqueued += 1;
			remainingCapacity -= 1;
			progressed = true;
		}

		if (!progressed) {
			break;
		}
	}

	for (const entry of cyclePlan.entries) {
		await ctx.db.patch(entry.profile._id, {
			lastCheckedAt: args.now,
			lastSuccessAt: entry.enqueued > 0 ? args.now : entry.profile.lastSuccessAt,
			lastError: undefined,
			updatedAt: args.now
		});
	}

	return {
		checked: cyclePlan.checkedProfiles,
		enqueued,
		eligibleChapters,
		blocked: enqueued > 0 ? null : ('no_candidates' as const)
	};
}

async function remainingDownloadCapacityForUser(
	ctx: QueryCtx | MutationCtx,
	ownerUserId: GenericId<'users'>
) {
	const now = Date.now();
	const [readyQueuedTaskCount, downloadingTasks] = await Promise.all([
		countReadyQueuedDownloadTasksForUser(ctx, ownerUserId, now),
		loadDownloadTasksForUserStatus(
			ctx,
			ownerUserId,
			DOWNLOAD_TASK_STATUS.DOWNLOADING,
			RESERVED_RUNNING_DOWNLOAD_SLOTS + 1
		)
	]);
	const reservedSlots =
		readyQueuedTaskCount + Math.min(RESERVED_RUNNING_DOWNLOAD_SLOTS, downloadingTasks.length);
	return Math.max(0, MAX_ACTIVE_DOWNLOAD_TASKS_PER_USER - reservedSlots);
}

async function countReadyQueuedDownloadTasksForUser(
	ctx: QueryCtx | MutationCtx,
	ownerUserId: GenericId<'users'>,
	now: number
) {
	const queuedTasks = await loadDownloadTasksForUserStatus(
		ctx,
		ownerUserId,
		DOWNLOAD_TASK_STATUS.QUEUED,
		MAX_ACTIVE_DOWNLOAD_TASKS_PER_USER + 1
	);
	let readyCount = 0;

	for (const task of queuedTasks) {
		const command = task.commandId ? await ctx.db.get(task.commandId) : null;
		if (!command) {
			readyCount += 1;
			continue;
		}
		if (command.commandType !== 'downloads.chapter') {
			readyCount += 1;
			continue;
		}
		if (command.status === 'leased' || command.status === 'running') {
			readyCount += 1;
			continue;
		}
		if (command.status !== 'queued') {
			continue;
		}
		if ((command.runAfter ?? 0) <= now) {
			readyCount += 1;
		}
	}

	return readyCount;
}

async function findActiveDownloadTaskForChapter(
	ctx: QueryCtx | MutationCtx,
	ownerUserId: GenericId<'users'>,
	chapterId: GenericId<'libraryChapters'>
) {
	const tasks = await ctx.db
		.query('downloadTasks')
		.withIndex('by_library_chapter_id_created_at', (q) => q.eq('libraryChapterId', chapterId))
		.order('desc')
		.take(10);

	return (
		tasks.find(
			(task) =>
				task.ownerUserId === ownerUserId &&
				isActiveDownloadTaskStatus(task.status as DownloadTaskStatus)
		) ?? null
	);
}

async function nextDownloadAttemptNumber(
	ctx: QueryCtx | MutationCtx,
	chapterId: GenericId<'libraryChapters'>
) {
	const latest = await findLatestDownloadTaskForChapter(ctx, chapterId);
	return Math.max(1, Math.floor((latest?.attemptNumber ?? 0) + 1));
}

async function selectDownloadCycleCandidatesForUser(
	ctx: MutationCtx,
	args: {
		userId: GenericId<'users'>;
		limit: number;
		now: number;
	}
) {
	const profiles = (
		await ctx.db
			.query('downloadProfiles')
			.withIndex('by_owner_user_id_enabled_updated_at', (q) =>
				q.eq('ownerUserId', args.userId).eq('enabled', true)
			)
			.collect()
	)
		.sort((left, right) => {
			const leftCheckedAt = left.lastCheckedAt ?? 0;
			const rightCheckedAt = right.lastCheckedAt ?? 0;
			if (leftCheckedAt !== rightCheckedAt) {
				return leftCheckedAt - rightCheckedAt;
			}
			if (left.updatedAt !== right.updatedAt) {
				return left.updatedAt - right.updatedAt;
			}
			return left.createdAt - right.createdAt;
		})
		.slice(0, args.limit);
	const activeProfiles = profiles.filter((profile) => !profile.paused);

	const titleIds = [...new Set(activeProfiles.map((profile) => String(profile.libraryTitleId)))];
	const titles = await Promise.all(
		titleIds.map(async (titleId) => {
			const title = await ctx.db.get(titleId as GenericId<'libraryTitles'>);
			return title && title.ownerUserId === args.userId ? title : null;
		})
	);
	const validTitles = titles.filter((t): t is NonNullable<typeof t> => t !== null);

	const titleById = new Map(validTitles.map((title) => [String(title._id), title] as const));
	const eligibleChaptersByTitleId = new Map<string, ReturnType<typeof selectDownloadableGroupedChapters>>();
	for (const title of validTitles) {
		const chapters = selectDownloadableGroupedChapters(await loadActiveTitleChapterReleases(ctx, title));
		const next = [];
		for (const chapter of chapters) {
			if (chapter.downloadStatus === DOWNLOAD_STATUS.MISSING) {
				next.push(chapter);
				continue;
			}
			if (chapter.downloadStatus === DOWNLOAD_STATUS.FAILED) {
				const latestTask = await findLatestDownloadTaskForChapter(ctx, chapter._id);
				if (!shouldTreatDownloadFailureAsPermanent(latestTask)) {
					next.push(chapter);
				}
			}
		}
		eligibleChaptersByTitleId.set(String(title._id), prioritizeMissingBeforeFailed(next));
	}

	return {
		checkedProfiles: activeProfiles.length,
		hasInFlightDownloads: false,
		validTitles,
		entries: activeProfiles
			.map((profile) => {
				const title = titleById.get(String(profile.libraryTitleId));
				if (!title) {
					return null;
				}
				const chapters = [...(eligibleChaptersByTitleId.get(String(title._id)) ?? [])];
				return {
					profile,
					title,
					chapters,
					nextIndex: 0,
					enqueued: 0
				};
			})
			.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
	};
}

async function loadDownloadTasksForUserStatus(
	ctx: QueryCtx | MutationCtx,
	ownerUserId: GenericId<'users'>,
	status: DownloadTaskStatus,
	limit: number
) {
	return ctx.db
		.query('downloadTasks')
		.withIndex('by_owner_user_id_status_updated_at', (q) =>
			q.eq('ownerUserId', ownerUserId).eq('status', status)
		)
		.take(limit);
}

async function loadActiveDownloadTasks(
	ctx: QueryCtx | MutationCtx,
	limit: number,
	ownerUserId?: GenericId<'users'>
) {
	const [queued, downloading] = ownerUserId
		? await Promise.all([
				ctx.db
					.query('downloadTasks')
					.withIndex('by_owner_user_id_status_updated_at', (q) =>
						q.eq('ownerUserId', ownerUserId).eq('status', DOWNLOAD_TASK_STATUS.QUEUED)
					)
					.order('desc')
					.take(limit),
				ctx.db
					.query('downloadTasks')
					.withIndex('by_owner_user_id_status_updated_at', (q) =>
						q.eq('ownerUserId', ownerUserId).eq('status', DOWNLOAD_TASK_STATUS.DOWNLOADING)
					)
					.order('desc')
					.take(limit)
			])
		: await Promise.all([
				ctx.db
					.query('downloadTasks')
					.withIndex('by_status_updated_at', (q) => q.eq('status', DOWNLOAD_TASK_STATUS.QUEUED))
					.order('desc')
					.take(limit),
				ctx.db
					.query('downloadTasks')
					.withIndex('by_status_updated_at', (q) => q.eq('status', DOWNLOAD_TASK_STATUS.DOWNLOADING))
					.order('desc')
					.take(limit)
			]);
	return [...queued, ...downloading].sort((left, right) => right.updatedAt - left.updatedAt);
}

async function finalizeRecoveredCompletedTask(
	ctx: MutationCtx,
	task: DocLike<'downloadTasks'>,
	chapter: DocLike<'libraryChapters'>,
	now: number
) {
	if (task.status === DOWNLOAD_TASK_STATUS.COMPLETED) {
		return;
	}
	await ctx.db.patch(task._id, {
		status: DOWNLOAD_TASK_STATUS.COMPLETED,
		progressPercent: 100,
		completedAt: now,
		updatedAt: now,
		localRelativePath: chapter.localRelativePath,
		storageKind: chapter.storageKind,
		fileSizeBytes: chapter.fileSizeBytes
	});
	await applyTaskActiveDownloadCounterDelta(ctx, {
		ownerUserId: task.ownerUserId,
		oldStatus: task.status,
		newStatus: DOWNLOAD_TASK_STATUS.COMPLETED
	});
}

async function requeueRecoveredTask(
	ctx: MutationCtx,
	task: DocLike<'downloadTasks'>,
	chapter: DocLike<'libraryChapters'>,
	command: DocLike<'commands'> | null,
	now: number
) {
	if (command && command.status !== 'queued') {
		await ctx.db.patch(command._id, {
			status: 'queued',
			priority: Math.max(command.priority, DOWNLOAD_COMMAND_PRIORITY_BASE),
			runAfter: now,
			leaseOwnerBridgeId: undefined,
			leaseToken: undefined,
			leaseExpiresAt: undefined,
			lastErrorMessage: undefined,
			completedAt: undefined,
			updatedAt: now
		});
	}
	if (!command) {
		const title = await ctx.db.get(chapter.libraryTitleId);
		const storageTitleBase =
			title && title.ownerUserId === chapter.ownerUserId
				? await resolveStorageTitleBaseForTitle(ctx, title)
				: task.titleName;
		const replacementCommandId = await insertCommand(ctx, {
			commandType: 'downloads.chapter',
			requestedByUserId: task.requestedByUserId ?? task.ownerUserId,
			payload: buildDownloadCommandPayload(chapter, task._id, storageTitleBase),
			idempotencyKey: `downloads.chapter:${String(chapter._id)}:recovery:${now}`,
			priority: DOWNLOAD_COMMAND_PRIORITY_BASE,
			maxAttempts: 10,
			runAfter: now,
			now
		});
		await ctx.db.patch(task._id, {
			commandId: replacementCommandId,
			updatedAt: now
		});
	}
	await ctx.db.patch(task._id, {
		status: DOWNLOAD_TASK_STATUS.QUEUED,
		startedAt: undefined,
		completedAt: undefined,
		errorMessage: undefined,
		updatedAt: now
	});
	await applyTaskActiveDownloadCounterDelta(ctx, {
		ownerUserId: task.ownerUserId,
		oldStatus: task.status,
		newStatus: DOWNLOAD_TASK_STATUS.QUEUED
	});
	await ctx.db.patch(chapter._id, {
		downloadStatus: DOWNLOAD_STATUS.QUEUED,
		lastErrorMessage: undefined,
		updatedAt: now
	});
	await applyChapterDownloadCounterDelta(ctx, {
		libraryTitleId: chapter.libraryTitleId,
		oldStatus: chapter.downloadStatus,
		newStatus: DOWNLOAD_STATUS.QUEUED,
		oldFileSizeBytes: chapter.fileSizeBytes,
		newFileSizeBytes: chapter.fileSizeBytes
	});
}

function buildDownloadCommandPayload(
	chapter: Pick<
		DocLike<'libraryChapters'>,
		| '_id'
		| 'libraryTitleId'
		| 'sourceId'
		| 'sourcePkg'
		| 'sourceLang'
		| 'titleUrl'
		| 'chapterUrl'
		| 'chapterName'
		| 'chapterNumber'
	>,
	downloadTaskId: GenericId<'downloadTasks'>,
	storageTitle: string
) {
	return {
		chapterId: chapter._id,
		downloadTaskId,
		titleId: chapter.libraryTitleId,
		sourceId: chapter.sourceId,
		sourcePkg: chapter.sourcePkg,
		sourceLang: chapter.sourceLang,
		titleUrl: chapter.titleUrl,
		chapterUrl: chapter.chapterUrl,
		title: storageTitle,
		chapterName: chapter.chapterName,
		chapterNumber: chapter.chapterNumber
	};
}

async function failRecoveredTask(
	ctx: MutationCtx,
	task: DocLike<'downloadTasks'>,
	chapter: DocLike<'libraryChapters'>,
	status: 'failed' | 'cancelled',
	errorMessage: string,
	now: number
) {
	await ctx.db.patch(task._id, {
		status,
		errorMessage,
		completedAt: now,
		updatedAt: now
	});
	await applyTaskActiveDownloadCounterDelta(ctx, {
		ownerUserId: task.ownerUserId,
		oldStatus: task.status,
		newStatus: status
	});
	await ctx.db.patch(chapter._id, {
		downloadStatus: DOWNLOAD_STATUS.FAILED,
		lastErrorMessage: errorMessage,
		updatedAt: now
	});
	await applyChapterDownloadCounterDelta(ctx, {
		libraryTitleId: chapter.libraryTitleId,
		oldStatus: chapter.downloadStatus,
		newStatus: DOWNLOAD_STATUS.FAILED,
		oldFileSizeBytes: chapter.fileSizeBytes,
		newFileSizeBytes: chapter.fileSizeBytes
	});
}

export const runScheduledChapterSync = internalMutation({
	args: {
		maxTitles: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const maxTitles = Math.max(1, Math.min(Math.floor(args.maxTitles ?? 10), 50));
		const now = Date.now();

		// Find all enabled download profiles
		const enabledProfiles = await ctx.db
			.query('downloadProfiles')
			.withIndex('by_enabled_updated_at', (q) => q.eq('enabled', true))
			.collect();

		// Deduplicate by title, then pick the titles whose sync cursor is oldest.
		const seenTitleIds = new Set<string>();
		const candidates: Array<{
			profile: (typeof enabledProfiles)[number];
			titleId: GenericId<'libraryTitles'>;
			eligibleAt: number;
		}> = [];
		for (const profile of enabledProfiles) {
			if (profile.paused) continue;
			const titleKey = String(profile.libraryTitleId);
			if (seenTitleIds.has(titleKey)) continue;
			seenTitleIds.add(titleKey);

			const lastSyncCursor = Math.max(
				profile.lastChapterSyncRequestedAt ?? 0,
				profile.lastChapterSyncAt ?? 0
			);
			if (now - lastSyncCursor < CHAPTER_SYNC_COOLDOWN_MS) continue;

			candidates.push({
				profile,
				titleId: profile.libraryTitleId,
				eligibleAt: lastSyncCursor
			});
		}
		candidates.sort((left, right) => left.eligibleAt - right.eligibleAt);

		let synced = 0;
		for (const { titleId } of candidates.slice(0, maxTitles)) {
			const title = await ctx.db.get(titleId);
			if (!title) continue;

			const variant = await getPreferredVariantForTitle(ctx, title);
			if (!variant) continue;

			const sourceId = variant.sourceId.trim();
			const titleUrl = variant.titleUrl.trim();
			if (!sourceId || !titleUrl) continue;

			const idempotencyKey = `library.chapters.sync:${String(title._id)}:${sourceId}:${titleUrl}`;
			const existingCommand = (
				await ctx.db
					.query('commands')
					.withIndex('by_idempotency_key', (q) => q.eq('idempotencyKey', idempotencyKey))
					.collect()
			)
				.filter((command) => command.requestedByUserId === title.ownerUserId)
				.sort((left, right) => right.createdAt - left.createdAt)
				.find((command) => ACTIVE_CHAPTER_SYNC_COMMAND_STATUSES.has(command.status));
			if (existingCommand) {
				continue;
			}
			await insertCommand(ctx, {
				commandType: 'library.chapters.sync',
				requestedByUserId: title.ownerUserId,
				payload: { titleId: title._id, sourceId, titleUrl },
				idempotencyKey,
				priority: 200,
				maxAttempts: 3,
				runAfter: now,
				now,
				targetCapability: 'library.chapters.sync'
			});
			synced += 1;
		}

		return { candidates: candidates.length, synced };
	}
});

type DocLike<TableName extends keyof import('./_generated/dataModel').DataModel> =
	import('./_generated/dataModel').Doc<TableName>;

async function requireOwnedTitle(ctx: QueryCtx | MutationCtx, titleId: GenericId<'libraryTitles'>) {
	const identity = await requireViewerIdentity(ctx);
	const title = await ctx.db.get(titleId);
	if (!title || title.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Library title not found');
	}

	return title;
}

async function requireOwnedChapter(
	ctx: QueryCtx | MutationCtx,
	chapterId: GenericId<'libraryChapters'>
) {
	const identity = await requireViewerIdentity(ctx);
	const chapter = await ctx.db.get(chapterId);
	if (!chapter || chapter.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Library chapter not found');
	}

	return chapter;
}

async function requireViewerIdentity(ctx: QueryCtx | MutationCtx) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new Error('Not authenticated');
	}
	return identity;
}

async function requireViewerUserId(ctx: QueryCtx | MutationCtx) {
	const identity = await requireViewerIdentity(ctx);
	return identity.subject as GenericId<'users'>;
}

function computeProgressPercent(downloadedPages?: number | null, totalPages?: number | null) {
	const downloaded = Number(downloadedPages ?? NaN);
	const total = Number(totalPages ?? NaN);
	if (Number.isFinite(downloaded) && Number.isFinite(total) && total > 0) {
		return Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)));
	}
	return 0;
}

function normalizeOptionalString(value: string | null | undefined) {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

function isConcurrentDownloadStateSatisfied(
	chapter: {
		downloadStatus: string;
		downloadedPages?: number;
		totalPages?: number;
		localRelativePath?: string;
		storageKind?: 'directory' | 'archive';
		fileSizeBytes?: number;
		lastErrorMessage?: string;
	},
	args: {
		status: 'missing' | 'queued' | 'downloading' | 'downloaded' | 'failed';
		downloadedPages?: number;
		totalPages?: number;
		localRelativePath?: string | null;
		storageKind?: 'directory' | 'archive' | null;
		fileSizeBytes?: number | null;
		lastErrorMessage?: string | null;
	}
) {
	switch (args.status) {
		case DOWNLOAD_STATUS.QUEUED:
			return (
				chapter.downloadStatus === DOWNLOAD_STATUS.QUEUED ||
				chapter.downloadStatus === DOWNLOAD_STATUS.DOWNLOADING ||
				chapter.downloadStatus === DOWNLOAD_STATUS.DOWNLOADED
			);
		case DOWNLOAD_STATUS.DOWNLOADING:
			return (
				chapter.downloadStatus === DOWNLOAD_STATUS.DOWNLOADING ||
				chapter.downloadStatus === DOWNLOAD_STATUS.DOWNLOADED
			);
		case DOWNLOAD_STATUS.DOWNLOADED:
			return (
				chapter.downloadStatus === DOWNLOAD_STATUS.DOWNLOADED &&
				(args.downloadedPages === undefined ||
					(chapter.downloadedPages ?? 0) >= args.downloadedPages) &&
				(args.totalPages === undefined || (chapter.totalPages ?? 0) >= args.totalPages) &&
				(args.localRelativePath == null || chapter.localRelativePath === args.localRelativePath) &&
				(args.storageKind == null || chapter.storageKind === args.storageKind) &&
				(args.fileSizeBytes == null || (chapter.fileSizeBytes ?? 0) >= args.fileSizeBytes)
			);
		case DOWNLOAD_STATUS.FAILED:
			return (
				chapter.downloadStatus === DOWNLOAD_STATUS.FAILED &&
				(args.lastErrorMessage == null ||
					normalizeOptionalString(chapter.lastErrorMessage) ===
						normalizeOptionalString(args.lastErrorMessage))
			);
		case DOWNLOAD_STATUS.MISSING:
			return chapter.downloadStatus === DOWNLOAD_STATUS.MISSING;
		default:
			return chapter.downloadStatus === args.status;
	}
}
