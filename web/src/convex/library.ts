import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireBridgeIdentity } from './bridge_auth';

const DOWNLOAD_STATUS = {
	MISSING: 'missing',
	QUEUED: 'queued',
	DOWNLOADING: 'downloading',
	DOWNLOADED: 'downloaded',
	FAILED: 'failed'
} as const;

const DEFAULT_USER_STATUSES = [
	{ key: 'reading', label: 'Reading' },
	{ key: 'completed', label: 'Completed' },
	{ key: 'on_hold', label: 'On Hold' },
	{ key: 'dropped', label: 'Dropped' },
	{ key: 'plan_to_read', label: 'Plan to Read' }
] as const;

const DEFAULT_COLLECTIONS = [
	{ name: 'Favorites' },
	{ name: 'Queue' },
	{ name: 'Archive' }
] as const;

export const listMine = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}
		const userId = identity.subject as GenericId<'users'>;
		const [titles, statusById, collectionById, collectionIdsByTitleId, variantCountsByTitleId] =
			await Promise.all([
			ctx.db
				.query('libraryTitles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
				.collect(),
			loadOwnerUserStatusMap(ctx, userId),
			loadOwnerCollectionMap(ctx, userId),
			loadOwnerCollectionIdsByTitleId(ctx, userId),
			loadOwnerVariantCountsByTitleId(ctx, userId)
		]);

		const enriched = await Promise.all(
			titles.map(async (title) => {
				const chapters = await ctx.db
					.query('libraryChapters')
					.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
					.collect();

				let queued = 0;
				let downloading = 0;
				let downloaded = 0;
				let failed = 0;
				for (const chapter of chapters) {
					switch (chapter.downloadStatus) {
						case DOWNLOAD_STATUS.QUEUED:
							queued += 1;
							break;
						case DOWNLOAD_STATUS.DOWNLOADING:
							downloading += 1;
							break;
						case DOWNLOAD_STATUS.DOWNLOADED:
							downloaded += 1;
							break;
						case DOWNLOAD_STATUS.FAILED:
							failed += 1;
							break;
					}
				}

				const collectionIds = collectionIdsByTitleId.get(String(title._id)) ?? [];

				return {
					...title,
					userStatus: title.userStatusId ? statusById.get(String(title.userStatusId)) ?? null : null,
					userRating: title.userRating ?? null,
					collections: collectionIds
						.map((collectionId) => collectionById.get(String(collectionId)) ?? null)
						.filter((collection): collection is NonNullable<typeof collection> => collection !== null)
						.sort((left, right) => left.position - right.position),
					variantsCount: variantCountsByTitleId.get(String(title._id)) ?? 0,
					chapterStats: {
						total: chapters.length,
						queued,
						downloading,
						downloaded,
						failed
					}
				};
			})
		);

		return enriched.sort((left, right) => right.updatedAt - left.updatedAt);
	}
});

export const listTitleChapters = query({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const chapters = await ctx.db
			.query('libraryChapters')
			.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
			.collect();

		return chapters.sort((left, right) => left.sequence - right.sequence);
	}
});

export const getMineById = query({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const [chapters, userStatus, collections, variants] = await Promise.all([
			ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
				.collect(),
			resolveOwnedTitleUserStatus(ctx, title),
			listCollectionsForTitle(ctx, title),
			listVariantsForTitle(ctx, title)
		]);

		let queued = 0;
		let downloading = 0;
		let downloaded = 0;
		let failed = 0;
		for (const chapter of chapters) {
			switch (chapter.downloadStatus) {
				case DOWNLOAD_STATUS.QUEUED:
					queued += 1;
					break;
				case DOWNLOAD_STATUS.DOWNLOADING:
					downloading += 1;
					break;
				case DOWNLOAD_STATUS.DOWNLOADED:
					downloaded += 1;
					break;
				case DOWNLOAD_STATUS.FAILED:
					failed += 1;
					break;
			}
		}

		const progressRows = await ctx.db
			.query('chapterProgress')
			.withIndex('by_owner_user_id_library_title_id_updated_at', (q) =>
				q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
			)
			.collect();

		const titleComments = await ctx.db
			.query('chapterComments')
			.withIndex('by_owner_user_id_library_title_id_updated_at', (q) =>
				q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
			)
			.collect();

		const chapterById = new Map(chapters.map((chapter) => [chapter._id, chapter]));
		const latestProgress = [...progressRows].sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
		const downloadProfile = await ctx.db
			.query('downloadProfiles')
			.withIndex('by_owner_user_id_library_title_id', (q) =>
				q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
			)
			.unique();

		return {
			...title,
			userStatus,
			userRating: title.userRating ?? null,
			collections,
			preferredVariantId: title.preferredVariantId ?? null,
			variants,
			chapterStats: {
				total: chapters.length,
				queued,
				downloading,
				downloaded,
				failed
			},
			readingProgress: {
				startedChapters: progressRows.length,
				latest:
					latestProgress && chapterById.has(latestProgress.chapterId)
						? {
								chapterId: latestProgress.chapterId,
								pageIndex: latestProgress.pageIndex,
								updatedAt: latestProgress.updatedAt
							}
						: null
			},
			titleComments: titleComments
				.sort((left, right) => right.updatedAt - left.updatedAt)
				.map((comment) => {
					const chapter = chapterById.get(comment.chapterId);
					return {
						_id: comment._id,
						chapterId: comment.chapterId,
						chapterName: chapter?.chapterName ?? '',
						chapterNumber: chapter?.chapterNumber ?? null,
						pageIndex: comment.pageIndex,
						message: comment.message,
						createdAt: comment.createdAt,
						updatedAt: comment.updatedAt
					};
				}),
			downloadProfile: downloadProfile
				? {
						enabled: downloadProfile.enabled,
						paused: downloadProfile.paused,
						autoDownload: downloadProfile.autoDownload,
						lastCheckedAt: downloadProfile.lastCheckedAt ?? null,
						lastSuccessAt: downloadProfile.lastSuccessAt ?? null,
						lastError: downloadProfile.lastError ?? null
					}
				: null,
			chapters: chapters.sort((left, right) => right.sequence - left.sequence)
		};
	}
});

export const findMineBySource = query({
	args: {
		canonicalKey: v.optional(v.string()),
		sourceId: v.optional(v.string()),
		titleUrl: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return null;
		}

		const ownerUserId = identity.subject as GenericId<'users'>;
		if (args.canonicalKey?.trim()) {
			const byCanonical = await ctx.db
				.query('libraryTitles')
				.withIndex('by_owner_user_id_canonical_key', (q) =>
					q.eq('ownerUserId', ownerUserId).eq('canonicalKey', args.canonicalKey!.trim())
				)
				.unique();
			if (byCanonical) {
				return {
					_id: byCanonical._id,
					title: byCanonical.title,
					sourceId: byCanonical.sourceId,
					titleUrl: byCanonical.titleUrl
				};
			}
		}

		const sourceId = args.sourceId?.trim() ?? '';
		const titleUrl = args.titleUrl?.trim() ?? '';
		if (!sourceId || !titleUrl) {
			return null;
		}

		const variant = await ctx.db
			.query('titleVariants')
			.withIndex('by_owner_user_id_source_id_title_url', (q) =>
				q.eq('ownerUserId', ownerUserId).eq('sourceId', sourceId).eq('titleUrl', titleUrl)
			)
			.unique();
		if (!variant) {
			return null;
		}
		const match = await ctx.db.get(variant.libraryTitleId);
		if (!match || match.ownerUserId !== ownerUserId) {
			return null;
		}

		return {
			_id: match._id,
			title: match.title,
			sourceId: variant.sourceId,
			titleUrl: variant.titleUrl
		};
	}
});

export const getReaderByChapterId = query({
	args: {
		chapterId: v.id('libraryChapters')
	},
	handler: async (ctx, args) => {
		const chapter = await requireOwnedChapter(ctx, args.chapterId);
		const title = await ctx.db.get(chapter.libraryTitleId);
		if (!title || title.ownerUserId !== chapter.ownerUserId) {
			throw new Error('Library title not found');
		}

		const chapters = await ctx.db
			.query('libraryChapters')
			.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
			.collect();

		const progress = await getOwnedChapterProgressRow(ctx, chapter._id);

		return {
			title,
			chapter,
			chapters: chapters.sort((left, right) => left.sequence - right.sequence),
			progress: progress
				? {
						id: progress._id,
						pageIndex: progress.pageIndex,
						updatedAt: progress.updatedAt
					}
				: null
		};
	}
});

export const listChapterComments = query({
	args: {
		chapterId: v.id('libraryChapters')
	},
	handler: async (ctx, args) => {
		const chapter = await requireOwnedChapter(ctx, args.chapterId);
		const comments = await ctx.db
			.query('chapterComments')
			.withIndex('by_owner_user_id_chapter_id_updated_at', (q) =>
				q.eq('ownerUserId', chapter.ownerUserId).eq('chapterId', chapter._id)
			)
			.collect();

		return comments
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.map((item) => ({
				_id: item._id,
				chapterId: item.chapterId,
				pageIndex: item.pageIndex,
				message: item.message,
				createdAt: item.createdAt,
				updatedAt: item.updatedAt
			}));
	}
});

export const upsertChapterProgress = mutation({
	args: {
		chapterId: v.id('libraryChapters'),
		pageIndex: v.float64()
	},
	handler: async (ctx, args) => {
		const chapter = await requireOwnedChapter(ctx, args.chapterId);
		const now = Date.now();
		const existing = await getOwnedChapterProgressRow(ctx, chapter._id);
		if (existing) {
			await ctx.db.patch(existing._id, {
				pageIndex: args.pageIndex,
				updatedAt: now
			});
			await ctx.db.patch(chapter.libraryTitleId, {
				lastReadAt: now,
				updatedAt: now
			});
			return { ok: true, progressId: existing._id };
		}

		const progressId = await ctx.db.insert('chapterProgress', {
			ownerUserId: chapter.ownerUserId,
			libraryTitleId: chapter.libraryTitleId,
			chapterId: chapter._id,
			pageIndex: args.pageIndex,
			createdAt: now,
			updatedAt: now
		});

		await ctx.db.patch(chapter.libraryTitleId, {
			lastReadAt: now,
			updatedAt: now
		});

		return { ok: true, progressId };
	}
});

export const resetChapterProgress = mutation({
	args: {
		chapterId: v.id('libraryChapters')
	},
	handler: async (ctx, args) => {
		const chapter = await requireOwnedChapter(ctx, args.chapterId);
		const existing = await getOwnedChapterProgressRow(ctx, chapter._id);
		if (existing) {
			await ctx.db.delete(existing._id);
		}
		return { ok: true };
	}
});

export const createChapterComment = mutation({
	args: {
		chapterId: v.id('libraryChapters'),
		pageIndex: v.float64(),
		message: v.string()
	},
	handler: async (ctx, args) => {
		const chapter = await requireOwnedChapter(ctx, args.chapterId);
		const now = Date.now();
		const commentId = await ctx.db.insert('chapterComments', {
			ownerUserId: chapter.ownerUserId,
			libraryTitleId: chapter.libraryTitleId,
			chapterId: chapter._id,
			pageIndex: args.pageIndex,
			message: args.message.trim(),
			createdAt: now,
			updatedAt: now
		});
		return { ok: true, commentId };
	}
});

export const updateChapterComment = mutation({
	args: {
		commentId: v.id('chapterComments'),
		message: v.string()
	},
	handler: async (ctx, args) => {
		const comment = await requireOwnedChapterComment(ctx, args.commentId);
		await ctx.db.patch(comment._id, {
			message: args.message.trim(),
			updatedAt: Date.now()
		});
		return { ok: true };
	}
});

export const deleteChapterComment = mutation({
	args: {
		commentId: v.id('chapterComments')
	},
	handler: async (ctx, args) => {
		const comment = await requireOwnedChapterComment(ctx, args.commentId);
		await ctx.db.delete(comment._id);
		return { ok: true };
	}
});

export const listAllMineChapters = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}
		const userId = identity.subject as GenericId<'users'>;
		const titles = await ctx.db
			.query('libraryTitles')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
			.collect();

		const rows = [];
		for (const title of titles) {
			const chapters = await ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
				.collect();
			for (const chapter of chapters) {
				rows.push({
					...chapter,
					title: title.title,
					titleCoverUrl: title.coverUrl ?? null,
					localCoverPath: title.localCoverPath ?? null
				});
			}
		}

		return rows.sort((left, right) => right.updatedAt - left.updatedAt);
	}
});

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

		const [titles, profileRows, installedExtensions, commandRows] = await Promise.all([
			ctx.db
				.query('libraryTitles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
				.collect(),
			ctx.db
				.query('downloadProfiles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
				.collect(),
			ctx.db.query('installedExtensions').collect(),
			ctx.db
				.query('commands')
				.withIndex('by_requested_by_user_id_created_at', (q) => q.eq('requestedByUserId', ownerUserId))
				.collect()
		]);

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
			const chapters = await ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
				.collect();

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

		const downloadCommands = commandRows.filter((row) => row.commandType === 'downloads.chapter');
		const activeTaskMap = new Map<
			string,
			{
				titleId: string;
				title: string;
				chapter: string;
				status: 'queued' | 'downloading';
				progressPercent: number;
				chaptersTotal: number;
				chaptersQueued: number;
				chaptersFailed: number;
				isPaused: boolean;
				error: string | null;
				coverUrl: string | null;
				localCoverPath: string | null;
				updatedAt: number;
			}
		>();
		const recentTaskMap = new Map<
			string,
			{
				titleId: string;
				title: string;
				chapter: string;
				status: 'completed' | 'failed' | 'cancelled';
				progressPercent: number;
				chaptersTotal: number;
				chaptersQueued: number;
				chaptersFailed: number;
				isPaused: boolean;
				error: string | null;
				coverUrl: string | null;
				localCoverPath: string | null;
				updatedAt: number;
			}
		>();

		for (const row of downloadCommands) {
			const payload = (row.payload ?? {}) as Record<string, unknown>;
			const titleId = String(payload.titleId ?? '').trim();
			if (!titleId) continue;
			const title = titles.find((item) => String(item._id) === titleId);
			if (!title) continue;

			const titleStats = chapterStatsByTitleId.get(titleId) ?? {
				total: 0,
				downloaded: 0,
				downloadedBytes: 0,
				lastDownloadedAt: null
			};
			const profile = profileByTitleId.get(titleId);
			const chapterName = String(payload.chapterName ?? '').trim() || 'Chapter';
			const progressPercent = downloadCommandPercent(row.progress ?? null, row.status);

			if (['queued', 'leased', 'running'].includes(row.status)) {
				const current = activeTaskMap.get(titleId);
				const nextStatus = row.status === 'running' ? 'downloading' : (current?.status ?? 'queued');
				const nextFailed = current?.chaptersFailed ?? 0;
				activeTaskMap.set(titleId, {
					titleId,
					title: title.title,
					chapter:
						!current || row.updatedAt >= current.updatedAt ? chapterName : current.chapter,
					status: nextStatus,
					progressPercent:
						!current || row.updatedAt >= current.updatedAt
							? progressPercent
							: current.progressPercent,
					chaptersTotal: titleStats.total,
					chaptersQueued: (current?.chaptersQueued ?? 0) + 1,
					chaptersFailed: nextFailed,
					isPaused: profile?.paused ?? false,
					error: current?.error ?? null,
					coverUrl: title.coverUrl ?? null,
					localCoverPath: title.localCoverPath ?? null,
					updatedAt: Math.max(current?.updatedAt ?? 0, row.updatedAt)
				});
				continue;
			}

			if (!['succeeded', 'failed', 'cancelled'].includes(row.status)) continue;
			const mappedStatus =
				row.status === 'succeeded'
					? 'completed'
					: row.status === 'failed'
						? 'failed'
						: 'cancelled';
			const current = recentTaskMap.get(titleId);
			const failedCount =
				(current?.chaptersFailed ?? 0) + (mappedStatus === 'failed' ? 1 : 0);
			if (current && current.updatedAt > row.updatedAt) {
				recentTaskMap.set(titleId, {
					...current,
					chaptersFailed: failedCount
				});
				continue;
			}

			recentTaskMap.set(titleId, {
				titleId,
				title: title.title,
				chapter: chapterName,
				status: mappedStatus,
				progressPercent: mappedStatus === 'completed' ? 100 : progressPercent,
				chaptersTotal: titleStats.total,
				chaptersQueued: 0,
				chaptersFailed: failedCount,
				isPaused: profile?.paused ?? false,
				error: row.lastErrorMessage ?? null,
				coverUrl: title.coverUrl ?? null,
				localCoverPath: title.localCoverPath ?? null,
				updatedAt: row.updatedAt
			});
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
				const queuedTasks = activeTaskMap.get(titleId)?.chaptersQueued ?? 0;
				const updatedAt =
					profile?.updatedAt ??
					stats.lastDownloadedAt ??
					title.updatedAt;

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
			activeTasks: [...activeTaskMap.values()]
				.sort((left, right) => right.updatedAt - left.updatedAt)
				.slice(0, activeLimit),
			recentTasks: [...recentTaskMap.values()]
				.sort((left, right) => right.updatedAt - left.updatedAt)
				.slice(0, recentLimit),
			watchedTitles
		};
	}
});

export const listUserStatuses = query({
	args: {},
	handler: async (ctx) => {
		const userId = await requireViewerUserId(ctx);
		const rows = await ctx.db
			.query('libraryUserStatuses')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
			.collect();

		return rows
			.sort((left, right) => left.position - right.position)
			.map((row) => ({
				id: row._id,
				key: row.key,
				label: row.label,
				position: row.position,
				isDefault: row.isDefault
			}));
	}
});

export const ensureDefaultUserStatuses = mutation({
	args: {},
	handler: async (ctx) => {
		const userId = await requireViewerUserId(ctx);
		const existing = await ctx.db
			.query('libraryUserStatuses')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
			.collect();

		if (existing.length > 0) {
			return { created: false, count: existing.length };
		}

		const now = Date.now();
		for (const [index, status] of DEFAULT_USER_STATUSES.entries()) {
			await ctx.db.insert('libraryUserStatuses', {
				ownerUserId: userId,
				key: status.key,
				label: status.label,
				position: index,
				isDefault: true,
				createdAt: now,
				updatedAt: now
			});
		}

		return { created: true, count: DEFAULT_USER_STATUSES.length };
	}
});

export const createUserStatus = mutation({
	args: {
		label: v.string()
	},
	handler: async (ctx, args) => {
		const userId = await requireViewerUserId(ctx);
		const rows = await ctx.db
			.query('libraryUserStatuses')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
			.collect();
		const now = Date.now();
		const nextPosition = rows.reduce((max, row) => Math.max(max, row.position), -1) + 1;
		const statusId = await ctx.db.insert('libraryUserStatuses', {
			ownerUserId: userId,
			key: slugifyStatusKey(args.label, rows.map((row) => row.key)),
			label: args.label.trim(),
			position: nextPosition,
			isDefault: false,
			createdAt: now,
			updatedAt: now
		});

		const created = await ctx.db.get(statusId);
		if (!created) {
			throw new Error('Failed to create status');
		}

		return {
			id: created._id,
			key: created.key,
			label: created.label,
			position: created.position,
			isDefault: created.isDefault
		};
	}
});

export const updateUserStatus = mutation({
	args: {
		statusId: v.id('libraryUserStatuses'),
		label: v.string(),
		position: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const status = await requireOwnedUserStatus(ctx, args.statusId);
		await ctx.db.patch(status._id, {
			label: args.label.trim(),
			position: args.position ?? status.position,
			updatedAt: Date.now()
		});

		const updated = await ctx.db.get(status._id);
		if (!updated) {
			throw new Error('Status not found');
		}

		return {
			id: updated._id,
			key: updated.key,
			label: updated.label,
			position: updated.position,
			isDefault: updated.isDefault
		};
	}
});

export const deleteUserStatus = mutation({
	args: {
		statusId: v.id('libraryUserStatuses')
	},
	handler: async (ctx, args) => {
		const status = await requireOwnedUserStatus(ctx, args.statusId);
		if (status.isDefault) {
			throw new Error('Default statuses cannot be deleted');
		}

		const titles = await ctx.db
			.query('libraryTitles')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', status.ownerUserId))
			.collect();
		const now = Date.now();
		for (const title of titles) {
			if (title.userStatusId !== status._id) {
				continue;
			}
			await ctx.db.patch(title._id, {
				userStatusId: undefined,
				updatedAt: now
			});
		}

		await ctx.db.delete(status._id);
		return { deleted: true };
	}
});

export const listCollections = query({
	args: {},
	handler: async (ctx) => {
		const userId = await requireViewerUserId(ctx);
		const [rows, collectionTitleRows] = await Promise.all([
			ctx.db
				.query('libraryCollections')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
				.collect(),
			ctx.db
				.query('libraryCollectionTitles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
				.collect()
		]);
		const titlesCountByCollectionId = new Map<string, number>();
		for (const row of collectionTitleRows) {
			const key = String(row.collectionId);
			titlesCountByCollectionId.set(key, (titlesCountByCollectionId.get(key) ?? 0) + 1);
		}

		return rows
			.sort((left, right) => left.position - right.position)
			.map((row) => ({
				id: row._id,
				name: row.name,
				position: row.position,
				isDefault: row.isDefault,
				titlesCount: titlesCountByCollectionId.get(String(row._id)) ?? 0
			}));
	}
});

export const ensureDefaultCollections = mutation({
	args: {},
	handler: async (ctx) => {
		const userId = await requireViewerUserId(ctx);
		const existing = await ctx.db
			.query('libraryCollections')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
			.collect();

		if (existing.length > 0) {
			return { created: false, count: existing.length };
		}

		const now = Date.now();
		for (const [index, collection] of DEFAULT_COLLECTIONS.entries()) {
			await ctx.db.insert('libraryCollections', {
				ownerUserId: userId,
				name: collection.name,
				position: index,
				isDefault: true,
				createdAt: now,
				updatedAt: now
			});
		}

		return { created: true, count: DEFAULT_COLLECTIONS.length };
	}
});

export const createCollection = mutation({
	args: {
		name: v.string()
	},
	handler: async (ctx, args) => {
		const userId = await requireViewerUserId(ctx);
		const rows = await ctx.db
			.query('libraryCollections')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
			.collect();
		const now = Date.now();
		const nextPosition = rows.reduce((max, row) => Math.max(max, row.position), -1) + 1;
		const collectionId = await ctx.db.insert('libraryCollections', {
			ownerUserId: userId,
			name: args.name.trim(),
			position: nextPosition,
			isDefault: false,
			createdAt: now,
			updatedAt: now
		});

		const created = await ctx.db.get(collectionId);
		if (!created) {
			throw new Error('Failed to create collection');
		}

		return {
			id: created._id,
			name: created.name,
			position: created.position,
			isDefault: created.isDefault,
			titlesCount: 0
		};
	}
});

export const updateCollection = mutation({
	args: {
		collectionId: v.id('libraryCollections'),
		name: v.string(),
		position: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const collection = await requireOwnedCollection(ctx, args.collectionId);
		await ctx.db.patch(collection._id, {
			name: args.name.trim(),
			position: args.position ?? collection.position,
			updatedAt: Date.now()
		});

		const updated = await ctx.db.get(collection._id);
		if (!updated) {
			throw new Error('Collection not found');
		}

		return {
			id: updated._id,
			name: updated.name,
			position: updated.position,
			isDefault: updated.isDefault,
			titlesCount: await countTitlesInCollection(ctx, updated.ownerUserId, updated._id)
		};
	}
});

export const deleteCollection = mutation({
	args: {
		collectionId: v.id('libraryCollections')
	},
	handler: async (ctx, args) => {
		const collection = await requireOwnedCollection(ctx, args.collectionId);
		if (collection.isDefault) {
			throw new Error('Default collections cannot be deleted');
		}

		const collectionTitles = await ctx.db
			.query('libraryCollectionTitles')
			.withIndex('by_owner_user_id_collection_id', (q) =>
				q.eq('ownerUserId', collection.ownerUserId).eq('collectionId', collection._id)
			)
			.collect();
		for (const row of collectionTitles) {
			await ctx.db.delete(row._id);
		}

		await ctx.db.delete(collection._id);
		return { deleted: true };
	}
});

export const updateTitlePreferences = mutation({
	args: {
		titleId: v.id('libraryTitles'),
		userStatusId: v.optional(v.union(v.id('libraryUserStatuses'), v.null())),
		userRating: v.optional(v.union(v.float64(), v.null())),
		collectionIds: v.optional(v.array(v.id('libraryCollections')))
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const now = Date.now();
		const patch: {
			userStatusId?: GenericId<'libraryUserStatuses'> | undefined;
			userRating?: number | undefined;
			updatedAt?: number;
		} = {};

		if (args.userStatusId !== undefined) {
			if (args.userStatusId === null) {
				patch.userStatusId = undefined;
			} else {
				const status = await requireOwnedUserStatus(ctx, args.userStatusId);
				patch.userStatusId = status._id;
			}
		}

		if (args.userRating !== undefined) {
			if (args.userRating === null) {
				patch.userRating = undefined;
			} else {
				const normalized = Math.max(0, Math.min(5, args.userRating));
				patch.userRating = normalized;
			}
		}

		if (Object.keys(patch).length > 0) {
			patch.updatedAt = now;
			await ctx.db.patch(title._id, patch);
		}

		if (args.collectionIds !== undefined) {
			const nextCollectionIds = [...new Set(args.collectionIds.map((collectionId) => String(collectionId)))];
			const ownedCollections = new Map<string, GenericId<'libraryCollections'>>();
			for (const rawCollectionId of nextCollectionIds) {
				const collection = await requireOwnedCollection(
					ctx,
					rawCollectionId as GenericId<'libraryCollections'>
				);
				ownedCollections.set(rawCollectionId, collection._id);
			}

			const existingRows = await ctx.db
				.query('libraryCollectionTitles')
				.withIndex('by_owner_user_id_library_title_id', (q) =>
					q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
				)
				.collect();
			const existingByCollectionId = new Map(
				existingRows.map((row) => [String(row.collectionId), row] as const)
			);

			for (const row of existingRows) {
				if (!ownedCollections.has(String(row.collectionId))) {
					await ctx.db.delete(row._id);
				}
			}

			for (const [collectionId, ownedCollectionId] of ownedCollections) {
				if (existingByCollectionId.has(collectionId)) {
					continue;
				}
				await ctx.db.insert('libraryCollectionTitles', {
					ownerUserId: title.ownerUserId,
					libraryTitleId: title._id,
					collectionId: ownedCollectionId,
					createdAt: now
				});
			}

			await ctx.db.patch(title._id, {
				updatedAt: now
			});
		}

		return { ok: true };
	}
});

export const importForUser = mutation({
	args: {
		userId: v.id('users'),
		canonicalKey: v.string(),
		sourceId: v.string(),
		sourcePkg: v.string(),
		sourceLang: v.string(),
		titleUrl: v.string(),
		author: v.optional(v.string()),
		artist: v.optional(v.string()),
		title: v.string(),
		description: v.optional(v.string()),
		coverUrl: v.optional(v.string()),
		genre: v.optional(v.string()),
		status: v.optional(v.float64()),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		return importForUserCore(ctx, {
			userId: args.userId,
			canonicalKey: args.canonicalKey,
			sourceId: args.sourceId,
			sourcePkg: args.sourcePkg,
			sourceLang: args.sourceLang,
			titleUrl: args.titleUrl,
			author: args.author,
			artist: args.artist,
			title: args.title,
			description: args.description,
			coverUrl: args.coverUrl,
			genre: args.genre,
			status: args.status,
			now: args.now
		});
	}
});

export const requestChapterSync = mutation({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const preferredVariant = await getPreferredVariantForTitle(ctx, title);
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error('Not authenticated');
		}
		if (!preferredVariant) {
			throw new Error('Library title has no linked source variant');
		}
		const now = Date.now();
		const commandId = await ctx.db.insert('commands', {
			commandType: 'library.chapters.sync',
			targetCapability: 'library.chapters.sync',
			requestedByUserId: identity.subject as GenericId<'users'>,
			payload: {
				titleId: title._id,
				sourceId: preferredVariant.sourceId,
				titleUrl: preferredVariant.titleUrl
			},
			idempotencyKey: `library.chapters.sync:${String(title._id)}:${now}`,
			status: 'queued',
			priority: 100,
			runAfter: now,
			attemptCount: 0,
			maxAttempts: 3,
			createdAt: now,
			updatedAt: now
		});

		return { commandId };
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
		if (
			chapter.downloadStatus === DOWNLOAD_STATUS.QUEUED ||
			chapter.downloadStatus === DOWNLOAD_STATUS.DOWNLOADING
		) {
			return { commandId: null, alreadyQueued: true };
		}

		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error('Not authenticated');
		}
		const now = Date.now();

		await ctx.db.patch(chapter._id, {
			downloadStatus: DOWNLOAD_STATUS.QUEUED,
			downloadedPages: 0,
			totalPages: undefined,
			lastErrorMessage: undefined,
			updatedAt: now
		});

		const commandId = await ctx.db.insert('commands', {
			commandType: 'downloads.chapter',
			targetCapability: 'downloads.chapter',
			requestedByUserId: identity.subject as GenericId<'users'>,
			payload: {
				chapterId: chapter._id,
				titleId: title._id,
				sourceId: chapter.sourceId,
				titleUrl: chapter.titleUrl,
				chapterUrl: chapter.chapterUrl,
				title: title.title,
				chapterName: chapter.chapterName
			},
			idempotencyKey: `downloads.chapter:${String(chapter._id)}:${now}`,
			status: 'queued',
			priority: 100,
			runAfter: now,
			attemptCount: 0,
			maxAttempts: 3,
			createdAt: now,
			updatedAt: now
		});

		return { commandId, alreadyQueued: false };
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
		const now = Date.now();
		const profiles = await ctx.db
			.query('downloadProfiles')
			.withIndex('by_owner_user_id_enabled_updated_at', (q) =>
				q.eq('ownerUserId', userId).eq('enabled', true)
			)
			.collect();

		let checked = 0;
		let enqueued = 0;
		for (const profile of profiles.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, limit)) {
			if (profile.paused) {
				continue;
			}

			const title = await ctx.db.get(profile.libraryTitleId);
			if (!title || title.ownerUserId !== userId) {
				continue;
			}

			const chapters = await ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
				.collect();

			checked += 1;
			let localEnqueued = 0;
			for (const chapter of chapters) {
				if (
					chapter.downloadStatus !== DOWNLOAD_STATUS.MISSING &&
					chapter.downloadStatus !== DOWNLOAD_STATUS.FAILED
				) {
					continue;
				}

				await ctx.db.patch(chapter._id, {
					downloadStatus: DOWNLOAD_STATUS.QUEUED,
					downloadedPages: 0,
					totalPages: undefined,
					lastErrorMessage: undefined,
					updatedAt: now
				});
				localEnqueued += 1;
				enqueued += 1;

				await ctx.db.insert('commands', {
					commandType: 'downloads.chapter',
					targetCapability: 'downloads.chapter',
					requestedByUserId: userId,
					payload: {
						chapterId: chapter._id,
						titleId: title._id,
						sourceId: chapter.sourceId,
						titleUrl: chapter.titleUrl,
						chapterUrl: chapter.chapterUrl,
						title: title.title,
						chapterName: chapter.chapterName
					},
					idempotencyKey: `downloads.cycle:${String(chapter._id)}:${now}:${localEnqueued}`,
					status: 'queued',
					priority: 100 + localEnqueued,
					runAfter: now,
					attemptCount: 0,
					maxAttempts: 3,
					createdAt: now,
					updatedAt: now
				});
			}

			await ctx.db.patch(profile._id, {
				lastCheckedAt: now,
				lastSuccessAt: localEnqueued > 0 ? now : profile.lastSuccessAt,
				lastError: undefined,
				updatedAt: now
			});
		}

		return { checked, enqueued };
	}
});

export const requestMissingDownloads = mutation({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error('Not authenticated');
		}

		const chapters = await ctx.db
			.query('libraryChapters')
			.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
			.collect();

		const eligible = chapters.filter(
			(chapter) =>
				chapter.downloadStatus === DOWNLOAD_STATUS.MISSING ||
				chapter.downloadStatus === DOWNLOAD_STATUS.FAILED
		);

		const now = Date.now();
		const commandIds: GenericId<'commands'>[] = [];
		for (const [index, chapter] of eligible.entries()) {
			await ctx.db.patch(chapter._id, {
				downloadStatus: DOWNLOAD_STATUS.QUEUED,
				downloadedPages: 0,
				totalPages: undefined,
				lastErrorMessage: undefined,
				updatedAt: now
			});

			commandIds.push(
				await ctx.db.insert('commands', {
					commandType: 'downloads.chapter',
					targetCapability: 'downloads.chapter',
					requestedByUserId: identity.subject as GenericId<'users'>,
					payload: {
						chapterId: chapter._id,
						titleId: title._id,
						sourceId: chapter.sourceId,
						titleUrl: chapter.titleUrl,
						chapterUrl: chapter.chapterUrl,
						title: title.title,
						chapterName: chapter.chapterName
					},
					idempotencyKey: `downloads.chapter:${String(chapter._id)}:${now}:${index}`,
					status: 'queued',
					priority: 100 + index,
					runAfter: now,
					attemptCount: 0,
					maxAttempts: 3,
					createdAt: now,
					updatedAt: now
				})
			);
		}

		return {
			enqueued: commandIds.length,
			commandIds
		};
	}
});

export const upsertChaptersForTitle = mutation({
	args: {
		titleId: v.id('libraryTitles'),
		sourceId: v.string(),
		titleUrl: v.string(),
		chapters: v.array(
			v.object({
				url: v.string(),
				name: v.string(),
				dateUpload: v.optional(v.float64()),
				chapterNumber: v.optional(v.float64()),
				scanlator: v.optional(v.string())
			})
		),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const title = await ctx.db.get(args.titleId);
		if (!title) {
			throw new Error('Library title not found');
		}
		const variant = await findVariantForTitle(ctx, title._id, args.sourceId, args.titleUrl);
		if (!variant) {
			throw new Error('Title variant not found for chapter sync');
		}

		const existing = await ctx.db
			.query('libraryChapters')
			.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', args.titleId))
			.collect();
		const byUrl = new Map(
			existing
				.filter((chapter) => chapter.titleVariantId === variant._id)
				.map((chapter) => [chapter.chapterUrl, chapter])
		);

		for (const [index, chapter] of args.chapters.entries()) {
			const current = byUrl.get(chapter.url);
			if (current) {
				await ctx.db.patch(current._id, {
					titleVariantId: variant._id,
					sourceId: variant.sourceId,
					sourcePkg: variant.sourcePkg,
					sourceLang: variant.sourceLang,
					titleUrl: variant.titleUrl,
					chapterName: chapter.name,
					chapterNumber: chapter.chapterNumber,
					scanlator: chapter.scanlator,
					dateUpload: chapter.dateUpload,
					sequence: index,
					updatedAt: args.now
				});
				continue;
			}

			await ctx.db.insert('libraryChapters', {
				ownerUserId: title.ownerUserId,
				libraryTitleId: title._id,
				titleVariantId: variant._id,
				sourceId: variant.sourceId,
				sourcePkg: variant.sourcePkg,
				sourceLang: variant.sourceLang,
				titleUrl: variant.titleUrl,
				chapterUrl: chapter.url,
				chapterName: chapter.name,
				chapterNumber: chapter.chapterNumber,
				scanlator: chapter.scanlator,
				dateUpload: chapter.dateUpload,
				sequence: index,
				downloadStatus: DOWNLOAD_STATUS.MISSING,
				downloadedPages: 0,
				createdAt: args.now,
				updatedAt: args.now
			});
		}

		await ctx.db.patch(title._id, {
			updatedAt: args.now
		});

		return { ok: true, chapterCount: args.chapters.length };
	}
});

export const setLocalCoverPath = mutation({
	args: {
		titleId: v.id('libraryTitles'),
		localCoverPath: v.optional(v.string()),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const title = await ctx.db.get(args.titleId);
		if (!title) {
			throw new Error('Library title not found');
		}

		await ctx.db.patch(title._id, {
			localCoverPath: args.localCoverPath,
			updatedAt: args.now
		});

		return { ok: true };
	}
});

export const setChapterDownloadState = mutation({
	args: {
		chapterId: v.id('libraryChapters'),
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
					: (args.lastErrorMessage ?? undefined),
			downloadedAt: args.status === DOWNLOAD_STATUS.DOWNLOADED ? args.now : chapter.downloadedAt,
			updatedAt: args.now
		});

		return { ok: true };
	}
});

async function importForUserCore(
	ctx: MutationCtx,
	args: {
		userId: GenericId<'users'>;
		canonicalKey: string;
		sourceId: string;
		sourcePkg: string;
		sourceLang: string;
		titleUrl: string;
		author?: string;
		artist?: string;
		title: string;
		description?: string;
		coverUrl?: string;
		genre?: string;
		status?: number;
		now: number;
	}
) {
	const existingVariant = await ctx.db
		.query('titleVariants')
		.withIndex('by_owner_user_id_source_id_title_url', (q) =>
			q.eq('ownerUserId', args.userId).eq('sourceId', args.sourceId).eq('titleUrl', args.titleUrl)
		)
		.unique();
	if (existingVariant) {
		const existingTitle = await ctx.db.get(existingVariant.libraryTitleId);
		if (!existingTitle || existingTitle.ownerUserId !== args.userId) {
			throw new Error('Linked library title not found for existing variant');
		}

		await ctx.db.patch(existingVariant._id, {
			sourcePkg: args.sourcePkg,
			sourceLang: args.sourceLang,
			title: args.title,
			author: args.author,
			artist: args.artist,
			description: args.description,
			coverUrl: args.coverUrl,
			genre: args.genre,
			status: args.status,
			updatedAt: args.now,
			lastSyncedAt: args.now
		});

		const shouldRefreshTitleSnapshot =
			existingTitle.preferredVariantId === existingVariant._id ||
			(existingTitle.sourceId === existingVariant.sourceId &&
				existingTitle.titleUrl === existingVariant.titleUrl);
		if (shouldRefreshTitleSnapshot) {
			await applyVariantSnapshotToTitle(ctx, existingTitle._id, {
				sourceId: args.sourceId,
				sourcePkg: args.sourcePkg,
				sourceLang: args.sourceLang,
				titleUrl: args.titleUrl,
				title: args.title,
				author: args.author,
				artist: args.artist,
				description: args.description,
				coverUrl: args.coverUrl,
				genre: args.genre,
				status: args.status,
				preferredVariantId: existingVariant._id,
				now: args.now
			});
		}

		return { created: false, titleId: existingTitle._id };
	}

	const existing = await ctx.db
		.query('libraryTitles')
		.withIndex('by_owner_user_id_canonical_key', (q) =>
			q.eq('ownerUserId', args.userId).eq('canonicalKey', args.canonicalKey)
		)
		.unique();

	if (existing) {
		const variantId = await ctx.db.insert('titleVariants', {
			ownerUserId: args.userId,
			libraryTitleId: existing._id,
			sourceId: args.sourceId,
			sourcePkg: args.sourcePkg,
			sourceLang: args.sourceLang,
			titleUrl: args.titleUrl,
			title: args.title,
			author: args.author,
			artist: args.artist,
			description: args.description,
			coverUrl: args.coverUrl,
			genre: args.genre,
			status: args.status,
			isPreferred: existing.preferredVariantId === undefined,
			createdAt: args.now,
			updatedAt: args.now,
			lastSyncedAt: args.now
		});
		if (!existing.preferredVariantId) {
			await applyVariantSnapshotToTitle(ctx, existing._id, {
				sourceId: args.sourceId,
				sourcePkg: args.sourcePkg,
				sourceLang: args.sourceLang,
				titleUrl: args.titleUrl,
				title: args.title,
				author: args.author,
				artist: args.artist,
				description: args.description,
				coverUrl: args.coverUrl,
				genre: args.genre,
				status: args.status,
				preferredVariantId: variantId,
				now: args.now
			});
		} else {
			await ctx.db.patch(existing._id, {
				updatedAt: args.now
			});
		}
		return { created: false, titleId: existing._id };
	}

	const titleId = await ctx.db.insert('libraryTitles', {
		ownerUserId: args.userId,
		canonicalKey: args.canonicalKey,
		title: args.title,
		sourcePkg: args.sourcePkg,
		sourceLang: args.sourceLang,
		sourceId: args.sourceId,
		titleUrl: args.titleUrl,
		author: args.author,
		artist: args.artist,
		description: args.description,
		coverUrl: args.coverUrl,
		genre: args.genre,
		status: args.status,
		preferredVariantId: undefined,
		createdAt: args.now,
		updatedAt: args.now
	});
	const variantId = await ctx.db.insert('titleVariants', {
		ownerUserId: args.userId,
		libraryTitleId: titleId,
		sourceId: args.sourceId,
		sourcePkg: args.sourcePkg,
		sourceLang: args.sourceLang,
		titleUrl: args.titleUrl,
		title: args.title,
		author: args.author,
		artist: args.artist,
		description: args.description,
		coverUrl: args.coverUrl,
		genre: args.genre,
		status: args.status,
		isPreferred: true,
		createdAt: args.now,
		updatedAt: args.now,
		lastSyncedAt: args.now
	});
	await ctx.db.patch(titleId, {
		preferredVariantId: variantId
	});

	return { created: true, titleId };
}

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

async function getOwnedChapterProgressRow(
	ctx: QueryCtx | MutationCtx,
	chapterId: GenericId<'libraryChapters'>
) {
	const identity = await requireViewerIdentity(ctx);

	return ctx.db
		.query('chapterProgress')
		.withIndex('by_owner_user_id_chapter_id', (q) =>
			q.eq('ownerUserId', identity.subject as GenericId<'users'>).eq('chapterId', chapterId)
		)
		.unique();
}

async function requireOwnedChapterComment(
	ctx: QueryCtx | MutationCtx,
	commentId: GenericId<'chapterComments'>
) {
	const identity = await requireViewerIdentity(ctx);
	const comment = await ctx.db.get(commentId);
	if (!comment || comment.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Chapter comment not found');
	}

	return comment;
}

async function requireOwnedUserStatus(
	ctx: QueryCtx | MutationCtx,
	statusId: GenericId<'libraryUserStatuses'>
) {
	const identity = await requireViewerIdentity(ctx);
	const status = await ctx.db.get(statusId);
	if (!status || status.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Library status not found');
	}
	return status;
}

async function requireOwnedCollection(
	ctx: QueryCtx | MutationCtx,
	collectionId: GenericId<'libraryCollections'>
) {
	const identity = await requireViewerIdentity(ctx);
	const collection = await ctx.db.get(collectionId);
	if (!collection || collection.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Library collection not found');
	}
	return collection;
}

async function getPreferredVariantForTitle(
	ctx: QueryCtx | MutationCtx,
	title: {
		_id: GenericId<'libraryTitles'>;
		ownerUserId: GenericId<'users'>;
		preferredVariantId?: GenericId<'titleVariants'>;
	}
) {
	if (title.preferredVariantId) {
		const preferred = await ctx.db.get(title.preferredVariantId);
		if (preferred && preferred.ownerUserId === title.ownerUserId && preferred.libraryTitleId === title._id) {
			return preferred;
		}
	}

	const variants = await ctx.db
		.query('titleVariants')
		.withIndex('by_owner_user_id_library_title_id', (q) =>
			q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
		)
		.collect();

	return (
		variants.find((variant) => variant.isPreferred) ??
		variants.sort((left, right) => left.createdAt - right.createdAt)[0] ??
		null
	);
}

async function findVariantForTitle(
	ctx: QueryCtx | MutationCtx,
	titleId: GenericId<'libraryTitles'>,
	sourceId: string,
	titleUrl: string
) {
	return ctx.db
		.query('titleVariants')
		.withIndex('by_library_title_id_source_id_title_url', (q) =>
			q.eq('libraryTitleId', titleId).eq('sourceId', sourceId).eq('titleUrl', titleUrl)
		)
		.unique();
}

async function listVariantsForTitle(
	ctx: QueryCtx | MutationCtx,
	title: {
		_id: GenericId<'libraryTitles'>;
		ownerUserId: GenericId<'users'>;
		preferredVariantId?: GenericId<'titleVariants'>;
		sourceId: string;
		sourcePkg: string;
		sourceLang: string;
		titleUrl: string;
		title: string;
		author?: string;
		artist?: string;
		description?: string;
		coverUrl?: string;
		genre?: string;
		status?: number;
	}
) {
	const variants = await ctx.db
		.query('titleVariants')
		.withIndex('by_owner_user_id_library_title_id', (q) =>
			q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
		)
		.collect();

	return variants
		.map((variant) => ({
			id: variant._id,
			sourceId: variant.sourceId,
			sourcePkg: variant.sourcePkg,
			sourceLang: variant.sourceLang,
			titleUrl: variant.titleUrl,
			title: variant.title,
			author: variant.author ?? null,
			artist: variant.artist ?? null,
			description: variant.description ?? null,
			coverUrl: variant.coverUrl ?? null,
			genre: variant.genre ?? null,
			status: variant.status ?? null,
			isPreferred: title.preferredVariantId
				? variant._id === title.preferredVariantId
				: variant.isPreferred,
			lastSyncedAt: variant.lastSyncedAt ?? null
		}))
		.sort((left, right) => {
			if (left.isPreferred !== right.isPreferred) {
				return left.isPreferred ? -1 : 1;
			}
			return left.title.localeCompare(right.title);
		});
}

async function resolveOwnedTitleUserStatus(
	ctx: QueryCtx | MutationCtx,
	title: {
		ownerUserId: GenericId<'users'>;
		userStatusId?: GenericId<'libraryUserStatuses'>;
	}
) {
	if (!title.userStatusId) {
		return null;
	}

	const status = await ctx.db.get(title.userStatusId);
	if (!status || status.ownerUserId !== title.ownerUserId) {
		return null;
	}

	return {
		id: status._id,
		key: status.key,
		label: status.label,
		position: status.position,
		isDefault: status.isDefault
	};
}

async function listCollectionsForTitle(
	ctx: QueryCtx | MutationCtx,
	title: {
		_id: GenericId<'libraryTitles'>;
		ownerUserId: GenericId<'users'>;
	}
) {
	const rows = await ctx.db
		.query('libraryCollectionTitles')
		.withIndex('by_owner_user_id_library_title_id', (q) =>
			q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
		)
		.collect();

	const collections = await Promise.all(
		rows.map(async (row) => {
			const collection = await ctx.db.get(row.collectionId);
			if (!collection || collection.ownerUserId !== title.ownerUserId) {
				return null;
			}

			return {
				id: collection._id,
				name: collection.name,
				position: collection.position,
				isDefault: collection.isDefault
			};
		})
	);

	return collections
		.filter((collection): collection is NonNullable<typeof collection> => collection !== null)
		.sort((left, right) => left.position - right.position);
}

async function loadOwnerUserStatusMap(ctx: QueryCtx | MutationCtx, ownerUserId: GenericId<'users'>) {
	const statuses = await ctx.db
		.query('libraryUserStatuses')
		.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
		.collect();

	return new Map(
		statuses.map((status) => [
			String(status._id),
			{
				id: status._id,
				key: status.key,
				label: status.label,
				position: status.position,
				isDefault: status.isDefault
			}
		])
	);
}

async function loadOwnerCollectionMap(ctx: QueryCtx | MutationCtx, ownerUserId: GenericId<'users'>) {
	const collections = await ctx.db
		.query('libraryCollections')
		.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
		.collect();

	return new Map(
		collections.map((collection) => [
			String(collection._id),
			{
				id: collection._id,
				name: collection.name,
				position: collection.position,
				isDefault: collection.isDefault
			}
		])
	);
}

async function loadOwnerCollectionIdsByTitleId(
	ctx: QueryCtx | MutationCtx,
	ownerUserId: GenericId<'users'>
) {
	const rows = await ctx.db
		.query('libraryCollectionTitles')
		.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
		.collect();

	const collectionIdsByTitleId = new Map<string, GenericId<'libraryCollections'>[]>();
	for (const row of rows) {
		const key = String(row.libraryTitleId);
		const next = collectionIdsByTitleId.get(key) ?? [];
		next.push(row.collectionId);
		collectionIdsByTitleId.set(key, next);
	}

	return collectionIdsByTitleId;
}

async function loadOwnerVariantCountsByTitleId(
	ctx: QueryCtx | MutationCtx,
	ownerUserId: GenericId<'users'>
) {
	const rows = await ctx.db
		.query('titleVariants')
		.withIndex('by_owner_user_id_library_title_id', (q) => q.eq('ownerUserId', ownerUserId))
		.collect();

	const counts = new Map<string, number>();
	for (const row of rows) {
		const key = String(row.libraryTitleId);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	return counts;
}

async function countTitlesInCollection(
	ctx: QueryCtx | MutationCtx,
	ownerUserId: GenericId<'users'>,
	collectionId: GenericId<'libraryCollections'>
) {
	const rows = await ctx.db
		.query('libraryCollectionTitles')
		.withIndex('by_owner_user_id_collection_id', (q) =>
			q.eq('ownerUserId', ownerUserId).eq('collectionId', collectionId)
		)
		.collect();

	return rows.length;
}

async function applyVariantSnapshotToTitle(
	ctx: MutationCtx,
	titleId: GenericId<'libraryTitles'>,
	args: {
		sourceId: string;
		sourcePkg: string;
		sourceLang: string;
		titleUrl: string;
		title: string;
		author?: string;
		artist?: string;
		description?: string;
		coverUrl?: string;
		genre?: string;
		status?: number;
		preferredVariantId?: GenericId<'titleVariants'>;
		now: number;
	}
) {
	await ctx.db.patch(titleId, {
		title: args.title,
		sourceId: args.sourceId,
		sourcePkg: args.sourcePkg,
		sourceLang: args.sourceLang,
		titleUrl: args.titleUrl,
		author: args.author,
		artist: args.artist,
		description: args.description,
		coverUrl: args.coverUrl,
		genre: args.genre,
		status: args.status,
		preferredVariantId: args.preferredVariantId,
		updatedAt: args.now
	});
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

function downloadCommandPercent(progress: unknown, status: string) {
	if (status === 'succeeded') return 100;
	if (!progress || typeof progress !== 'object') return 0;

	const row = progress as Record<string, unknown>;
	const percent = Number(row.percent ?? NaN);
	if (Number.isFinite(percent) && percent >= 0) {
		return Math.max(0, Math.min(100, Math.round(percent)));
	}

	const downloadedPages = Number(row.downloadedPages ?? NaN);
	const totalPages = Number(row.totalPages ?? NaN);
	if (Number.isFinite(downloadedPages) && Number.isFinite(totalPages) && totalPages > 0) {
		return Math.max(0, Math.min(100, Math.round((downloadedPages / totalPages) * 100)));
	}

	return 0;
}

function cleanExtensionLabel(name: string) {
	return name.replace(/^tachiyomi:\s*/i, '').trim();
}

function humanizeSourcePkg(sourcePkg: string) {
	const segment = sourcePkg.split('.').filter(Boolean).at(-1) ?? sourcePkg;
	if (segment.toLowerCase() === 'mangadex') return 'MangaDex';
	return segment
		.replace(/[-_]+/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/\b\w/g, (value) => value.toUpperCase());
}

function slugifyStatusKey(label: string, existingKeys: string[]) {
	const base =
		label
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '') || 'status';
	let candidate = base;
	let index = 2;
	while (existingKeys.includes(candidate)) {
		candidate = `${base}_${index}`;
		index += 1;
	}
	return candidate;
}
