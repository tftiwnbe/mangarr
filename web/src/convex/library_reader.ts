import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import {
	DOWNLOAD_STATUS,
	getOwnedChapterProgressRow,
	listCollectionsForTitle,
	listVariantsForTitle,
	loadOwnerChaptersByTitleId,
	loadOwnerCollectionIdsByTitleId,
	loadOwnerCollectionMap,
	loadOwnerUserStatusMap,
	loadOwnerVariantCountsByTitleId,
	requireOwnedChapter,
	requireOwnedChapterComment,
	requireOwnedTitle,
	resolveOwnedTitleUserStatus
} from './library_shared';

function summarizeDownloadStats(
	chapters: Array<{
		downloadStatus: (typeof DOWNLOAD_STATUS)[keyof typeof DOWNLOAD_STATUS];
	}>
) {
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

	return {
		total: chapters.length,
		queued,
		downloading,
		downloaded,
		failed
	};
}

export const listMine = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}
		const userId = identity.subject as GenericId<'users'>;
		const [
			titles,
			statusById,
			collectionById,
			collectionIdsByTitleId,
			variantCountsByTitleId,
			{ byTitleId: chaptersByTitleId }
		] = await Promise.all([
			ctx.db
				.query('libraryTitles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
				.collect(),
			loadOwnerUserStatusMap(ctx, userId),
			loadOwnerCollectionMap(ctx, userId),
			loadOwnerCollectionIdsByTitleId(ctx, userId),
			loadOwnerVariantCountsByTitleId(ctx, userId),
			loadOwnerChaptersByTitleId(ctx, userId)
		]);

		return [...titles]
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.map((title) => {
				const chapters = chaptersByTitleId.get(String(title._id)) ?? [];
				const collectionIds = collectionIdsByTitleId.get(String(title._id)) ?? [];

				return {
					...title,
					userStatus: title.userStatusId ? (statusById.get(String(title.userStatusId)) ?? null) : null,
					userRating: title.userRating ?? null,
					collections: collectionIds
						.map((collectionId) => collectionById.get(String(collectionId)) ?? null)
						.filter((collection): collection is NonNullable<typeof collection> => collection !== null)
						.sort((left, right) => left.position - right.position),
					variantsCount: variantCountsByTitleId.get(String(title._id)) ?? 0,
					chapterStats: summarizeDownloadStats(chapters)
				};
			});
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
		const [chapters, userStatus, collections, variants, progressRows, titleComments, downloadProfile] =
			await Promise.all([
				ctx.db
					.query('libraryChapters')
					.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
					.collect(),
				resolveOwnedTitleUserStatus(ctx, title),
				listCollectionsForTitle(ctx, title),
				listVariantsForTitle(ctx, title),
				ctx.db
					.query('chapterProgress')
					.withIndex('by_owner_user_id_library_title_id_updated_at', (q) =>
						q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
					)
					.collect(),
				ctx.db
					.query('chapterComments')
					.withIndex('by_owner_user_id_library_title_id_updated_at', (q) =>
						q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
					)
					.collect(),
				ctx.db
					.query('downloadProfiles')
					.withIndex('by_owner_user_id_library_title_id', (q) =>
						q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
					)
					.unique()
			]);

		const chapterById = new Map(chapters.map((chapter) => [chapter._id, chapter]));
		const latestProgress =
			[...progressRows].sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;

		return {
			...title,
			userStatus,
			userRating: title.userRating ?? null,
			collections,
			preferredVariantId: title.preferredVariantId ?? null,
			variants,
			chapterStats: summarizeDownloadStats(chapters),
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
		const [titles, { chapters }] = await Promise.all([
			ctx.db
				.query('libraryTitles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
				.collect(),
			loadOwnerChaptersByTitleId(ctx, userId)
		]);
		const titleById = new Map(
			[...titles]
				.sort((left, right) => right.updatedAt - left.updatedAt)
				.map((title) => [String(title._id), title] as const)
		);

		return chapters
			.map((chapter) => {
				const title = titleById.get(String(chapter.libraryTitleId));
				return {
					...chapter,
					title: title?.title ?? '',
					titleCoverUrl: title?.coverUrl ?? null,
					localCoverPath: title?.localCoverPath ?? null
				};
			})
			.sort((left, right) => right.updatedAt - left.updatedAt);
	}
});

export const getMineChapterById = query({
	args: {
		chapterId: v.id('libraryChapters')
	},
	handler: async (ctx, args) => {
		const chapter = await requireOwnedChapter(ctx, args.chapterId);
		const title = await ctx.db.get(chapter.libraryTitleId);
		if (!title || title.ownerUserId !== chapter.ownerUserId) {
			return null;
		}

		return {
			...chapter,
			title: title.title,
			titleCoverUrl: title.coverUrl ?? null,
			localCoverPath: title.localCoverPath ?? null
		};
	}
});
