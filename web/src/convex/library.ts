import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { mutation, query, type MutationCtx } from './_generated/server';
import { requireBridgeIdentity } from './bridge_auth';
import {
	applyVariantSnapshotToTitle,
	cleanExtensionLabel,
	DOWNLOAD_STATUS,
	downloadChapterPercent,
	findVariantForTitle,
	getPreferredVariantForTitle,
	humanizeSourcePkg,
	loadInstalledSourceCatalog,
	loadOwnerChaptersByTitleId,
	pickVariantNormalizationAssignments,
	requireOwnedChapter,
	requireOwnedTitle,
	requireOwnedVariant,
	requireViewerUserId,
	setTitlePreferredVariant,
	variantInstalledSourceRecord
} from './library_shared';

export {
	createChapterComment,
	deleteChapterComment,
	findMineBySource,
	getMineById,
	getMineChapterById,
	getReaderByChapterId,
	listAllMineChapters,
	listChapterComments,
	listMine,
	listTitleChapters,
	resetChapterProgress,
	updateChapterComment,
	upsertChapterProgress
} from './library_reader';
export {
	createCollection,
	createUserStatus,
	deleteCollection,
	deleteUserStatus,
	ensureDefaultCollections,
	ensureDefaultUserStatuses,
	listCollections,
	listMergeCandidates,
	listUserStatuses,
	mergeTitles,
	updateCollection,
	updateTitlePreferences,
	updateUserStatus
} from './library_organization';
export {
	cancelQueuedChapterDownload,
	getDownloadDashboard,
	requestChapterDownload,
	requestMissingDownloads,
	runDownloadCycle,
	setChapterDownloadState,
	updateDownloadProfile
} from './library_downloads';
export {
	ensureTitleMetadata,
	ensureTitlesMetadata,
	upsertTitleMetadataFromBridge
} from './library_metadata';

export const deprecatedGetDownloadDashboard = query({
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

		const [titles, profileRows, installedExtensions, { byTitleId: chaptersByTitleId }] = await Promise.all([
			ctx.db
				.query('libraryTitles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
				.collect(),
			ctx.db
				.query('downloadProfiles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
				.collect(),
			ctx.db.query('installedExtensions').collect(),
			loadOwnerChaptersByTitleId(ctx, ownerUserId)
		]);

		type LibraryTitleRow = (typeof titles)[number];
		type DownloadProfileRow = (typeof profileRows)[number];
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

		const profileByTitleId = new Map<string, DownloadProfileRow>(
			profileRows.map((profile) => [String(profile.libraryTitleId), profile] as const)
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
		const chapterEntries: Array<{
			chapterId: string;
			titleId: string;
			title: string;
			chapter: string;
			chapterUrl: string;
			status: 'queued' | 'downloading' | 'completed' | 'failed';
			progressPercent: number;
			isPaused: boolean;
			error: string | null;
			coverUrl: string | null;
			localCoverPath: string | null;
			localRelativePath: string | null;
			storageKind: 'directory' | 'archive' | null;
			fileSizeBytes: number | null;
			updatedAt: number;
		}> = [];

		for (const title of titles) {
			const chapters = chaptersByTitleId.get(String(title._id)) ?? [];
			const profile = profileByTitleId.get(String(title._id)) ?? null;

			for (const chapter of chapters) {
				if (chapter.downloadStatus === DOWNLOAD_STATUS.QUEUED) {
					chapterEntries.push({
						chapterId: String(chapter._id),
						titleId: String(title._id),
						title: title.title,
						chapter: chapter.chapterName,
						chapterUrl: chapter.chapterUrl,
						status: 'queued',
						progressPercent: 0,
						isPaused: profile?.paused ?? false,
						error: null,
						coverUrl: title.coverUrl ?? null,
						localCoverPath: title.localCoverPath ?? null,
						localRelativePath: chapter.localRelativePath ?? null,
						storageKind: chapter.storageKind ?? null,
						fileSizeBytes: chapter.fileSizeBytes ?? null,
						updatedAt: chapter.updatedAt
					});
				} else if (chapter.downloadStatus === DOWNLOAD_STATUS.DOWNLOADING) {
					chapterEntries.push({
						chapterId: String(chapter._id),
						titleId: String(title._id),
						title: title.title,
						chapter: chapter.chapterName,
						chapterUrl: chapter.chapterUrl,
						status: 'downloading',
						progressPercent: downloadChapterPercent(chapter),
						isPaused: profile?.paused ?? false,
						error: null,
						coverUrl: title.coverUrl ?? null,
						localCoverPath: title.localCoverPath ?? null,
						localRelativePath: chapter.localRelativePath ?? null,
						storageKind: chapter.storageKind ?? null,
						fileSizeBytes: chapter.fileSizeBytes ?? null,
						updatedAt: chapter.updatedAt
					});
				} else if (chapter.downloadStatus === DOWNLOAD_STATUS.DOWNLOADED) {
					chapterEntries.push({
						chapterId: String(chapter._id),
						titleId: String(title._id),
						title: title.title,
						chapter: chapter.chapterName,
						chapterUrl: chapter.chapterUrl,
						status: 'completed',
						progressPercent: 100,
						isPaused: profile?.paused ?? false,
						error: null,
						coverUrl: title.coverUrl ?? null,
						localCoverPath: title.localCoverPath ?? null,
						localRelativePath: chapter.localRelativePath ?? null,
						storageKind: chapter.storageKind ?? null,
						fileSizeBytes: chapter.fileSizeBytes ?? null,
						updatedAt: chapter.updatedAt
					});
				} else if (chapter.downloadStatus === DOWNLOAD_STATUS.FAILED) {
					chapterEntries.push({
						chapterId: String(chapter._id),
						titleId: String(title._id),
						title: title.title,
						chapter: chapter.chapterName,
						chapterUrl: chapter.chapterUrl,
						status: 'failed',
						progressPercent: downloadChapterPercent(chapter),
						isPaused: profile?.paused ?? false,
						error: chapter.lastErrorMessage ?? null,
						coverUrl: title.coverUrl ?? null,
						localCoverPath: title.localCoverPath ?? null,
						localRelativePath: chapter.localRelativePath ?? null,
						storageKind: chapter.storageKind ?? null,
						fileSizeBytes: chapter.fileSizeBytes ?? null,
						updatedAt: chapter.updatedAt
					});
				}
			}

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

		const queuedTaskCountByTitleId = new Map<string, number>();
		for (const task of chapterEntries) {
			if (task.status !== 'queued' && task.status !== 'downloading') continue;
			queuedTaskCountByTitleId.set(
				task.titleId,
				(queuedTaskCountByTitleId.get(task.titleId) ?? 0) + 1
			);
		}

		const watchedTitles = titles
			.map((title: LibraryTitleRow) => {
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
			activeTasks: chapterEntries
				.filter((task) => task.status === 'queued' || task.status === 'downloading')
				.sort((left, right) => right.updatedAt - left.updatedAt)
				.slice(0, activeLimit),
			recentTasks: chapterEntries
				.filter((task) => task.status === 'completed' || task.status === 'failed')
				.sort((left, right) => right.updatedAt - left.updatedAt)
				.slice(0, recentLimit),
			watchedTitles
		};
	}
});

export const deprecatedCancelQueuedChapterDownload = mutation({
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
		const now = Date.now();
		const queuedDownloadCommands = await ctx.db
			.query('commands')
			.withIndex('by_requested_by_user_id_command_type_status_created_at', (q) =>
				q
					.eq('requestedByUserId', userId)
					.eq('commandType', 'downloads.chapter')
					.eq('status', 'queued')
			)
			.order('desc')
			.collect();

		const matchingQueued = queuedDownloadCommands.filter((row) => {
			const payload = (row.payload ?? {}) as Record<string, unknown>;
			return String(payload.chapterId ?? '').trim() === String(chapter._id);
		});

		if (matchingQueued.length === 0) {
			throw new Error('Queued download command was already picked up by the bridge');
		}

		for (const row of matchingQueued) {
			await ctx.db.patch(row._id, {
				status: 'cancelled',
				progress: undefined,
				completedAt: now,
				updatedAt: now
			});
		}

		await ctx.db.patch(chapter._id, {
			downloadStatus: DOWNLOAD_STATUS.MISSING,
			downloadedPages: 0,
			totalPages: undefined,
			lastErrorMessage: undefined,
			updatedAt: now
		});

		return {
			cancelledCount: matchingQueued.length
		};
	}
});

export const linkVariant = mutation({
	args: {
		titleId: v.id('libraryTitles'),
		sourceId: v.string(),
		sourcePkg: v.string(),
		sourceLang: v.string(),
		titleUrl: v.string(),
		title: v.string(),
		author: v.optional(v.union(v.string(), v.null())),
		artist: v.optional(v.union(v.string(), v.null())),
		description: v.optional(v.union(v.string(), v.null())),
		coverUrl: v.optional(v.union(v.string(), v.null())),
		genre: v.optional(v.union(v.string(), v.null())),
		status: v.optional(v.union(v.float64(), v.null()))
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const now = Date.now();
		const existing = await ctx.db
			.query('titleVariants')
			.withIndex('by_owner_user_id_source_id_title_url', (q) =>
				q
					.eq('ownerUserId', title.ownerUserId)
					.eq('sourceId', args.sourceId)
					.eq('titleUrl', args.titleUrl)
			)
			.unique();

		if (existing) {
			if (existing.libraryTitleId !== title._id) {
				throw new Error('Linked to another title');
			}

			await ctx.db.patch(existing._id, {
				sourcePkg: args.sourcePkg,
				sourceLang: args.sourceLang,
				title: args.title,
				author: args.author ?? undefined,
				artist: args.artist ?? undefined,
				description: args.description ?? undefined,
				coverUrl: args.coverUrl ?? undefined,
				genre: args.genre ?? undefined,
				status: args.status ?? undefined,
				updatedAt: now,
				lastSyncedAt: now
			});
			if (title.preferredVariantId === existing._id) {
				await applyVariantSnapshotToTitle(ctx, title._id, {
					sourceId: args.sourceId,
					sourcePkg: args.sourcePkg,
					sourceLang: args.sourceLang,
					titleUrl: args.titleUrl,
					title: args.title,
					author: args.author ?? undefined,
					artist: args.artist ?? undefined,
					description: args.description ?? undefined,
					coverUrl: args.coverUrl ?? undefined,
					genre: args.genre ?? undefined,
					status: args.status ?? undefined,
					preferredVariantId: existing._id,
					now
				});
			} else {
				await ctx.db.patch(title._id, { updatedAt: now });
			}
			return { ok: true, variantId: existing._id, alreadyLinked: true };
		}

		const variantId = await ctx.db.insert('titleVariants', {
			ownerUserId: title.ownerUserId,
			libraryTitleId: title._id,
			sourceId: args.sourceId,
			sourcePkg: args.sourcePkg,
			sourceLang: args.sourceLang,
			titleUrl: args.titleUrl,
			title: args.title,
			author: args.author ?? undefined,
			artist: args.artist ?? undefined,
			description: args.description ?? undefined,
			coverUrl: args.coverUrl ?? undefined,
			genre: args.genre ?? undefined,
			status: args.status ?? undefined,
			isPreferred: false,
			createdAt: now,
			updatedAt: now,
			lastSyncedAt: now
		});

		if (!title.preferredVariantId) {
			await setTitlePreferredVariant(ctx, title._id, variantId, now);
		} else {
			await ctx.db.patch(title._id, { updatedAt: now });
		}

		return { ok: true, variantId, alreadyLinked: false };
	}
});

export const removeVariant = mutation({
	args: {
		titleId: v.id('libraryTitles'),
		variantId: v.id('titleVariants')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const variant = await requireOwnedVariant(ctx, args.variantId);
		if (variant.libraryTitleId !== title._id) {
			throw new Error('Library variant not found');
		}

		const variants = await ctx.db
			.query('titleVariants')
			.withIndex('by_owner_user_id_library_title_id', (q) =>
				q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
			)
			.collect();
		if (variants.length <= 1) {
			throw new Error('Cannot remove the last source');
		}

		const chapters = await ctx.db
			.query('libraryChapters')
			.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
			.collect();
		const variantChapters = chapters.filter((chapter) => chapter.titleVariantId === variant._id);

		for (const chapter of variantChapters) {
			const [progressRows, commentRows] = await Promise.all([
				ctx.db
					.query('chapterProgress')
					.withIndex('by_owner_user_id_chapter_id', (q) =>
						q.eq('ownerUserId', title.ownerUserId).eq('chapterId', chapter._id)
					)
					.collect(),
				ctx.db
					.query('chapterComments')
					.withIndex('by_owner_user_id_chapter_id_updated_at', (q) =>
						q.eq('ownerUserId', title.ownerUserId).eq('chapterId', chapter._id)
					)
					.collect()
			]);

			for (const progress of progressRows) {
				await ctx.db.delete(progress._id);
			}
			for (const comment of commentRows) {
				await ctx.db.delete(comment._id);
			}
			await ctx.db.delete(chapter._id);
		}

		await ctx.db.delete(variant._id);
		const nextPreferredVariantId =
			title.preferredVariantId === variant._id ? undefined : title.preferredVariantId;
		const preferredVariantId = await setTitlePreferredVariant(
			ctx,
			title._id,
			nextPreferredVariantId,
			Date.now()
		);

		return {
			ok: true,
			removedVariantId: variant._id,
			removedChapterCount: variantChapters.length,
			preferredVariantId: preferredVariantId ?? null
		};
	}
});

export const normalizeTitleVariants = mutation({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const now = Date.now();
		const [variants, chapters, installedSourceCatalog] = await Promise.all([
			ctx.db
				.query('titleVariants')
				.withIndex('by_owner_user_id_library_title_id', (q) =>
					q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
				)
				.collect(),
			ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
				.collect(),
			loadInstalledSourceCatalog(ctx)
		]);

		const assignments = pickVariantNormalizationAssignments(variants, installedSourceCatalog);
		let repairedCount = 0;
		const unresolvedVariantIds: string[] = [];

		for (const variant of variants) {
			const installedRecord = variantInstalledSourceRecord(installedSourceCatalog, variant);
			if (installedRecord !== null) {
				continue;
			}

			const assignment = assignments.get(String(variant._id));
			if (!assignment) {
				unresolvedVariantIds.push(String(variant._id));
				continue;
			}

			const conflictingVariant = await ctx.db
				.query('titleVariants')
				.withIndex('by_owner_user_id_source_id_title_url', (q) =>
					q
						.eq('ownerUserId', title.ownerUserId)
						.eq('sourceId', assignment.sourceId)
						.eq('titleUrl', variant.titleUrl)
				)
				.unique();
			if (conflictingVariant && conflictingVariant._id !== variant._id) {
				unresolvedVariantIds.push(String(variant._id));
				continue;
			}

			await ctx.db.patch(variant._id, {
				sourceId: assignment.sourceId,
				sourceLang: assignment.sourceLang,
				updatedAt: now
			});

			for (const chapter of chapters) {
				const belongsToVariant =
					chapter.titleVariantId === variant._id ||
					(!chapter.titleVariantId &&
						chapter.sourceId === variant.sourceId &&
						chapter.sourcePkg === variant.sourcePkg &&
						chapter.titleUrl === variant.titleUrl);
				if (!belongsToVariant) continue;

				await ctx.db.patch(chapter._id, {
					titleVariantId: variant._id,
					sourceId: assignment.sourceId,
					sourceLang: assignment.sourceLang,
					updatedAt: now
				});
			}

			repairedCount += 1;
		}

		await setTitlePreferredVariant(ctx, title._id, title.preferredVariantId, now);

		return {
			ok: true,
			repairedCount,
			unresolvedVariantIds
		};
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

export const deprecatedRequestChapterDownload = mutation({
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

export const deprecatedUpdateDownloadProfile = mutation({
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

export const deprecatedRunDownloadCycle = mutation({
	args: {
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const userId = await requireViewerUserId(ctx);
		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 25), 100));
		const now = Date.now();
		const profiles = (
			await ctx.db
				.query('downloadProfiles')
				.withIndex('by_owner_user_id_enabled_updated_at', (q) =>
					q.eq('ownerUserId', userId).eq('enabled', true)
				)
				.collect()
		)
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.slice(0, limit);
		const activeProfiles = profiles.filter((profile) => !profile.paused);
		const titleIds = [...new Set(activeProfiles.map((profile) => String(profile.libraryTitleId)))];
		const [titles, missingChapters, failedChapters] = await Promise.all([
			Promise.all(
				titleIds.map(async (titleId) => {
					const title = await ctx.db.get(titleId as GenericId<'libraryTitles'>);
					return title && title.ownerUserId === userId ? title : null;
				})
			),
			ctx.db
				.query('libraryChapters')
				.withIndex('by_owner_user_id_download_status', (q) =>
					q.eq('ownerUserId', userId).eq('downloadStatus', DOWNLOAD_STATUS.MISSING)
				)
				.collect(),
			ctx.db
				.query('libraryChapters')
				.withIndex('by_owner_user_id_download_status', (q) =>
					q.eq('ownerUserId', userId).eq('downloadStatus', DOWNLOAD_STATUS.FAILED)
				)
				.collect()
		]);
		const titleById = new Map(
			titles
				.filter((title): title is NonNullable<typeof title> => title !== null)
				.map((title) => [String(title._id), title] as const)
		);
		const eligibleChaptersByTitleId = new Map<
			string,
			Array<(typeof missingChapters)[number] | (typeof failedChapters)[number]>
		>();
		for (const chapter of [...missingChapters, ...failedChapters]) {
			const titleId = String(chapter.libraryTitleId);
			if (!titleById.has(titleId)) {
				continue;
			}
			const next = eligibleChaptersByTitleId.get(titleId) ?? [];
			next.push(chapter);
			eligibleChaptersByTitleId.set(titleId, next);
		}

		let checked = 0;
		let enqueued = 0;
		for (const profile of profiles) {
			if (profile.paused) {
				continue;
			}
			const title = titleById.get(String(profile.libraryTitleId));
			if (!title) {
				continue;
			}
			const chapters = eligibleChaptersByTitleId.get(String(title._id)) ?? [];

			checked += 1;
			let localEnqueued = 0;
			for (const chapter of chapters) {
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

export const deprecatedRequestMissingDownloads = mutation({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error('Not authenticated');
		}

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
		const seenChapterUrls = new Set<string>();

		for (const [index, chapter] of args.chapters.entries()) {
			seenChapterUrls.add(chapter.url);
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

		const staleChapters = existing.filter(
			(chapter) => chapter.titleVariantId === variant._id && !seenChapterUrls.has(chapter.chapterUrl)
		);

		for (const staleChapter of staleChapters) {
			const [progressRows, commentRows] = await Promise.all([
				ctx.db
					.query('chapterProgress')
					.withIndex('by_owner_user_id_chapter_id', (q) =>
						q.eq('ownerUserId', title.ownerUserId).eq('chapterId', staleChapter._id)
					)
					.collect(),
				ctx.db
					.query('chapterComments')
					.withIndex('by_owner_user_id_chapter_id_updated_at', (q) =>
						q.eq('ownerUserId', title.ownerUserId).eq('chapterId', staleChapter._id)
					)
					.collect()
			]);

			for (const progress of progressRows) {
				await ctx.db.delete(progress._id);
			}
			for (const comment of commentRows) {
				await ctx.db.delete(comment._id);
			}
			await ctx.db.delete(staleChapter._id);
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

export const deprecatedUpsertTitleMetadataFromBridge = mutation({
	args: {
		sourceId: v.string(),
		titleUrl: v.string(),
		sourcePkg: v.optional(v.string()),
		sourceLang: v.optional(v.string()),
		title: v.string(),
		author: v.optional(v.string()),
		artist: v.optional(v.string()),
		description: v.optional(v.string()),
		coverUrl: v.optional(v.string()),
		genre: v.optional(v.string()),
		status: v.optional(v.float64()),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);

		const existingCache = await ctx.db
			.query('exploreTitleDetailsCache')
			.withIndex('by_source_id_title_url', (q) =>
				q.eq('sourceId', args.sourceId).eq('titleUrl', args.titleUrl)
			)
			.unique();

		if (existingCache) {
			await ctx.db.patch(existingCache._id, {
				sourcePkg: args.sourcePkg,
				sourceLang: args.sourceLang,
				title: args.title,
				author: args.author,
				artist: args.artist,
				description: args.description,
				coverUrl: args.coverUrl,
				genre: args.genre,
				status: args.status,
				fetchedAt: args.now,
				updatedAt: args.now
			});
		} else {
			await ctx.db.insert('exploreTitleDetailsCache', {
				sourceId: args.sourceId,
				titleUrl: args.titleUrl,
				sourcePkg: args.sourcePkg,
				sourceLang: args.sourceLang,
				title: args.title,
				author: args.author,
				artist: args.artist,
				description: args.description,
				coverUrl: args.coverUrl,
				genre: args.genre,
				status: args.status,
				fetchedAt: args.now,
				createdAt: args.now,
				updatedAt: args.now
			});
		}

		const matchingVariants = await ctx.db
			.query('titleVariants')
			.withIndex('by_source_id_title_url', (q) =>
				q.eq('sourceId', args.sourceId).eq('titleUrl', args.titleUrl)
			)
			.collect();
		const matchingVariantIds = new Set<string>();
		const matchingTitleIds = new Set<string>();

		for (const variant of matchingVariants) {
			matchingVariantIds.add(String(variant._id));
			matchingTitleIds.add(String(variant.libraryTitleId));
			await ctx.db.patch(variant._id, {
				sourcePkg: args.sourcePkg ?? variant.sourcePkg,
				sourceLang: args.sourceLang ?? variant.sourceLang,
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
		}

		const directTitles = await ctx.db
			.query('libraryTitles')
			.withIndex('by_source_id_title_url', (q) =>
				q.eq('sourceId', args.sourceId).eq('titleUrl', args.titleUrl)
			)
			.collect();

		for (const title of directTitles) {
			matchingTitleIds.add(String(title._id));
			await ctx.db.patch(title._id, {
				title: args.title,
				sourcePkg: args.sourcePkg ?? title.sourcePkg,
				sourceLang: args.sourceLang ?? title.sourceLang,
				author: args.author,
				artist: args.artist,
				description: args.description,
				coverUrl: args.coverUrl,
				genre: args.genre,
				status: args.status,
				updatedAt: args.now
			});
		}

		for (const titleId of matchingTitleIds) {
			const title = await ctx.db.get(titleId as GenericId<'libraryTitles'>);
			if (!title || title.preferredVariantId == null) {
				continue;
			}
			if (!matchingVariantIds.has(String(title.preferredVariantId))) {
				continue;
			}

			await applyVariantSnapshotToTitle(ctx, title._id, {
				sourceId: args.sourceId,
				sourcePkg: args.sourcePkg ?? title.sourcePkg,
				sourceLang: args.sourceLang ?? title.sourceLang,
				titleUrl: args.titleUrl,
				title: args.title,
				author: args.author,
				artist: args.artist,
				description: args.description,
				coverUrl: args.coverUrl,
				genre: args.genre,
				status: args.status,
				preferredVariantId: title.preferredVariantId,
				now: args.now
			});
		}

		return {
			ok: true,
			matchedVariants: matchingVariants.length,
			matchedTitles: matchingTitleIds.size
		};
	}
});

export const deprecatedSetChapterDownloadState = mutation({
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
