import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { internalMutation, mutation, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireBridgeIdentity } from './bridge_auth';
import { markTitleListedInLibrary } from './library_shared';
export { getDownloadDashboard } from './library_download_dashboard';

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

type DownloadTaskStatus = (typeof DOWNLOAD_TASK_STATUS)[keyof typeof DOWNLOAD_TASK_STATUS];

function isActiveDownloadTaskStatus(status: DownloadTaskStatus) {
	return status === DOWNLOAD_TASK_STATUS.QUEUED || status === DOWNLOAD_TASK_STATUS.DOWNLOADING;
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

		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error('Not authenticated');
		}

		const userId = identity.subject as GenericId<'users'>;
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

		await ctx.db.patch(chapter._id, {
			downloadStatus: DOWNLOAD_STATUS.MISSING,
			downloadedPages: 0,
			totalPages: undefined,
			lastErrorMessage: undefined,
			updatedAt: now
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

		const userId = await requireViewerUserId(ctx);
		const now = Date.now();
		await markTitleListedInLibrary(ctx, title, now);
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
		const enabledProfiles = (await ctx.db.query('downloadProfiles').collect())
			.filter((profile) => profile.enabled)
			.sort((left, right) => right.updatedAt - left.updatedAt);

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

		const [missingChapters, failedChapters] = await Promise.all([
			ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id_download_status', (q) =>
					q.eq('libraryTitleId', title._id).eq('downloadStatus', DOWNLOAD_STATUS.MISSING)
				)
				.collect(),
			ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id_download_status', (q) =>
					q.eq('libraryTitleId', title._id).eq('downloadStatus', DOWNLOAD_STATUS.FAILED)
				)
				.collect()
		]);

		const eligible = [...missingChapters, ...failedChapters].sort(
			(left, right) => left.sequence - right.sequence
		);
		const remainingSlots = await remainingDownloadCapacityForUser(ctx, userId);
		if (remainingSlots <= 0) {
			return {
				enqueued: 0,
				commandIds: [],
				taskIds: [],
				deferred: eligible.length
			};
		}
		const chaptersToQueue = eligible.slice(
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
				priority: 100 + priorityOffset,
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
			deferred: Math.max(0, eligible.length - chaptersToQueue.length)
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
			fileSizeBytes: args.fileSizeBytes === undefined ? chapter.fileSizeBytes : args.fileSizeBytes,
			lastErrorMessage:
				args.lastErrorMessage === undefined
					? chapter.lastErrorMessage
					: normalizeOptionalString(args.lastErrorMessage),
			downloadedAt: args.status === DOWNLOAD_STATUS.DOWNLOADED ? args.now : chapter.downloadedAt,
			updatedAt: args.now
		});

		const task =
			(args.downloadTaskId ? await ctx.db.get(args.downloadTaskId) : null) ??
			(await findLatestDownloadTaskForChapter(ctx, args.chapterId));
		if (!task || task.libraryChapterId !== chapter._id || args.status === DOWNLOAD_STATUS.MISSING) {
			return { ok: true };
		}

		if (args.status === DOWNLOAD_STATUS.DOWNLOADING && task.status === DOWNLOAD_TASK_STATUS.DOWNLOADING) {
			return { ok: true };
		}

		const downloadedPages = args.downloadedPages ?? task.downloadedPages;
		const totalPages = args.totalPages ?? task.totalPages;
		const percent =
			args.status === DOWNLOAD_STATUS.DOWNLOADED
				? 100
				: computeProgressPercent(downloadedPages, totalPages);
		const errorMessage = normalizeOptionalString(args.lastErrorMessage);

		const taskPatch: Partial<(typeof task)> = {
			downloadedPages,
			totalPages,
			progressPercent: percent,
			localRelativePath:
				args.localRelativePath === undefined ? task.localRelativePath : (args.localRelativePath ?? undefined),
			storageKind: args.storageKind === undefined ? task.storageKind : (args.storageKind ?? undefined),
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

		return { ok: true };
	}
});

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
	const activeTask = await findActiveDownloadTaskForChapter(
		ctx,
		args.chapter.ownerUserId,
		args.chapter._id
	);
	if (activeTask) {
		return {
			taskId: activeTask._id,
			commandId: activeTask.commandId ?? null,
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

	const attemptNumber = await nextDownloadAttemptNumber(ctx, args.chapter._id);
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

	const commandId = await ctx.db.insert('commands', {
		commandType: 'downloads.chapter',
		targetCapability: 'downloads.chapter',
		requestedByUserId: args.requestedByUserId,
		payload: {
			chapterId: args.chapter._id,
			downloadTaskId: taskId,
			titleId: args.title._id,
			sourceId: args.chapter.sourceId,
			sourcePkg: args.chapter.sourcePkg,
			sourceLang: args.chapter.sourceLang,
			titleUrl: args.chapter.titleUrl,
			chapterUrl: args.chapter.chapterUrl,
			title: args.title.title,
			chapterName: args.chapter.chapterName,
			chapterNumber: args.chapter.chapterNumber
		},
		idempotencyKey: `downloads.chapter:${String(args.chapter._id)}:${attemptNumber}:${args.now}`,
		status: 'queued',
		priority: args.priority,
		runAfter: args.now,
		attemptCount: 0,
		maxAttempts: 3,
		createdAt: args.now,
		updatedAt: args.now
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
	}
) {
	const activeTasks = await loadActiveDownloadTasks(ctx, ACTIVE_DOWNLOAD_RECOVERY_SCAN_LIMIT);
	let requeuedTasks = 0;
	let failedTasks = 0;

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
				continue;
			}

			if (shouldRequeue) {
				await requeueRecoveredTask(ctx, task, chapter, command, args.now);
				requeuedTasks += 1;
				continue;
			}

			if (commandStatus === 'dead_letter' || commandStatus === 'cancelled') {
				const errorMessage = command?.lastErrorMessage ?? task.errorMessage ?? 'Download failed';
				await failRecoveredTask(
					ctx,
					task,
					chapter,
					commandStatus === 'cancelled' ? DOWNLOAD_TASK_STATUS.CANCELLED : DOWNLOAD_TASK_STATUS.FAILED,
					errorMessage,
					args.now
				);
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
		await ctx.db
			.query('downloadTasks')
			.withIndex('by_library_chapter_id_created_at', (q) => q.eq('libraryChapterId', chapterId))
			.order('desc')
			.take(1)
	)[0] ?? null;
}

async function runDownloadCycleForUser(
	ctx: MutationCtx,
	args: {
		userId: GenericId<'users'>;
		limit: number;
		now: number;
	}
) {
	const cyclePlan = await selectDownloadCycleCandidatesForUser(ctx, args);
	let remainingCapacity = await remainingQueuedDownloadCapacityForUser(ctx, args.userId);
	if (remainingCapacity <= 0) {
		return { checked: cyclePlan.checkedProfiles, enqueued: 0 };
	}

	let enqueued = 0;
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
				priority: 100 + entry.enqueued,
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

	return { checked: cyclePlan.checkedProfiles, enqueued };
}

async function remainingDownloadCapacityForUser(
	ctx: QueryCtx | MutationCtx,
	ownerUserId: GenericId<'users'>
) {
	const [queuedTasks, downloadingTasks] = await Promise.all([
		loadDownloadTasksForUserStatus(
			ctx,
			ownerUserId,
			DOWNLOAD_TASK_STATUS.QUEUED,
			MAX_ACTIVE_DOWNLOAD_TASKS_PER_USER + 1
		),
		loadDownloadTasksForUserStatus(
			ctx,
			ownerUserId,
			DOWNLOAD_TASK_STATUS.DOWNLOADING,
			RESERVED_RUNNING_DOWNLOAD_SLOTS + 1
		)
	]);
	const reservedSlots = queuedTasks.length + Math.min(RESERVED_RUNNING_DOWNLOAD_SLOTS, downloadingTasks.length);
	return Math.max(
		0,
		MAX_ACTIVE_DOWNLOAD_TASKS_PER_USER - reservedSlots
	);
}

async function remainingQueuedDownloadCapacityForUser(
	ctx: QueryCtx | MutationCtx,
	ownerUserId: GenericId<'users'>
) {
	const queuedTasks = await loadDownloadTasksForUserStatus(
		ctx,
		ownerUserId,
		DOWNLOAD_TASK_STATUS.QUEUED,
		MAX_ACTIVE_DOWNLOAD_TASKS_PER_USER + 1
	);
	return Math.max(0, MAX_ACTIVE_DOWNLOAD_TASKS_PER_USER - queuedTasks.length);
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
			(task) => task.ownerUserId === ownerUserId && isActiveDownloadTaskStatus(task.status as DownloadTaskStatus)
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
		.sort((left, right) => right.updatedAt - left.updatedAt)
		.slice(0, args.limit);
	const activeProfiles = profiles.filter((profile) => !profile.paused);
	const titleIds = [...new Set(activeProfiles.map((profile) => String(profile.libraryTitleId)))];
	const [titles, missingChapters, failedChapters, queuedTasks] = await Promise.all([
		Promise.all(
			titleIds.map(async (titleId) => {
				const title = await ctx.db.get(titleId as GenericId<'libraryTitles'>);
				return title && title.ownerUserId === args.userId ? title : null;
			})
		),
		ctx.db
			.query('libraryChapters')
			.withIndex('by_owner_user_id_download_status', (q) =>
				q.eq('ownerUserId', args.userId).eq('downloadStatus', DOWNLOAD_STATUS.MISSING)
			)
			.collect(),
		ctx.db
			.query('libraryChapters')
			.withIndex('by_owner_user_id_download_status', (q) =>
				q.eq('ownerUserId', args.userId).eq('downloadStatus', DOWNLOAD_STATUS.FAILED)
			)
			.collect(),
		loadDownloadTasksForUserStatus(
			ctx,
			args.userId,
			DOWNLOAD_TASK_STATUS.QUEUED,
			MAX_ACTIVE_DOWNLOAD_TASKS_PER_USER + 64
		)
	]);
	const titleById = new Map(
		titles
			.filter((title): title is NonNullable<typeof title> => title !== null)
			.map((title) => [String(title._id), title] as const)
	);
	const activeChapterIds = new Set(queuedTasks.map((task) => String(task.libraryChapterId)));
	const eligibleChaptersByTitleId = new Map<
		string,
		Array<(typeof missingChapters)[number] | (typeof failedChapters)[number]>
	>();
	for (const chapter of [...missingChapters, ...failedChapters]) {
		const titleId = String(chapter.libraryTitleId);
		if (!titleById.has(titleId) || activeChapterIds.has(String(chapter._id))) {
			continue;
		}
		const next = eligibleChaptersByTitleId.get(titleId) ?? [];
		next.push(chapter);
		eligibleChaptersByTitleId.set(titleId, next);
	}

	return {
		checkedProfiles: activeProfiles.length,
		entries: activeProfiles
			.map((profile) => {
				const title = titleById.get(String(profile.libraryTitleId));
				if (!title) {
					return null;
				}
				const chapters = [...(eligibleChaptersByTitleId.get(String(title._id)) ?? [])].sort(
					(left, right) => left.sequence - right.sequence
				);
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

async function loadActiveDownloadTasks(ctx: QueryCtx | MutationCtx, limit: number) {
	const [queued, downloading] = await Promise.all([
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
			runAfter: now,
			leaseOwnerBridgeId: undefined,
			leaseExpiresAt: undefined,
			lastErrorMessage: undefined,
			completedAt: undefined,
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
	await ctx.db.patch(chapter._id, {
		downloadStatus: DOWNLOAD_STATUS.QUEUED,
		lastErrorMessage: undefined,
		updatedAt: now
	});
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
	await ctx.db.patch(chapter._id, {
		downloadStatus: DOWNLOAD_STATUS.FAILED,
		lastErrorMessage: errorMessage,
		updatedAt: now
	});
}

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
