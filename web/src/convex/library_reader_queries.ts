import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { query } from './_generated/server';
import { buildChapterRouteBase, buildTitleRouteBaseFromUrl } from '../lib/utils/route-segments';
import {
	chapterBelongsToVariant,
	getPreferredVariantForTitle,
	getOwnedChapterProgressRow,
	loadOwnerCollectionIdsByTitleId,
	loadOwnerCollectionMap,
	loadOwnerUserStatusMap,
	requireOwnedChapter,
	requireOwnedTitle
} from './library_shared';
import {
	buildChapterRouteSegments,
	buildTitleRouteSegments,
	findOwnedTitleByRouteSegment,
	loadTitleOverviewContext,
	resolveOwnerTitleRouteSegment,
	sortLibraryChaptersInReadingOrder,
	summarizeOfflineReadiness
} from './library_reader_support';

export const listMine = query({
	args: {
		limit: v.optional(v.float64()),
		offset: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}
		const userId = identity.subject as GenericId<'users'>;
		const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 5000)), 10000);
		const offset = Math.max(0, Math.floor(args.offset ?? 0));

		const [allTitles, statusById, collectionById, collectionIdsByTitleId] = await Promise.all([
			ctx.db
				.query('libraryTitles')
				.withIndex('by_owner_user_id_updated_at', (q) => q.eq('ownerUserId', userId))
				.order('desc')
				.take(limit + offset),
			loadOwnerUserStatusMap(ctx, userId),
			loadOwnerCollectionMap(ctx, userId),
			loadOwnerCollectionIdsByTitleId(ctx, userId)
		]);

		const titles = allTitles.slice(offset);

		return titles
			.filter((title) => title.listedInLibrary !== false)
			.map((title) => {
				const collectionIds = collectionIdsByTitleId.get(String(title._id)) ?? [];
				const chapterStats = {
					total: title.chapterCount ?? 0,
					queued: title.queuedChapterCount ?? 0,
					downloading: title.downloadingChapterCount ?? 0,
					downloaded: title.downloadedChapterCount ?? 0,
					failed: title.failedChapterCount ?? 0
				};
				return {
					_id: title._id,
					routeSegment: null,
					title: title.title,
					coverUrl: title.coverUrl ?? null,
					localCoverPath: title.localCoverPath ?? null,
					status: title.status ?? null,
					genre: title.genre ?? null,
					lastReadAt: title.lastReadAt ?? null,
					createdAt: title.createdAt,
					updatedAt: title.updatedAt,
					userStatus: title.userStatusId
						? (statusById.get(String(title.userStatusId)) ?? null)
						: null,
					userRating: title.userRating ?? null,
					collections: collectionIds
						.map((collectionId) => collectionById.get(String(collectionId)) ?? null)
						.filter(
							(collection): collection is NonNullable<typeof collection> => collection !== null
						)
						.sort((left, right) => left.position - right.position),
					chapterStats,
					offlineReadiness: summarizeOfflineReadiness(title, {
						total: chapterStats.total,
						downloaded: chapterStats.downloaded
					})
				};
			});
	}
});

export const listHiddenMine = query({
	args: {
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}

		const ownerUserId = identity.subject as GenericId<'users'>;
		const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 200)), 500);
		const titles = await ctx.db
			.query('libraryTitles')
			.withIndex('by_owner_user_id_listed_in_library_updated_at', (q) =>
				q.eq('ownerUserId', ownerUserId).eq('listedInLibrary', false)
			)
			.order('desc')
			.take(limit);
		const routeSegments = await Promise.all(
			titles.map(async (title) => [
				String(title._id),
				await resolveOwnerTitleRouteSegment(ctx, title)
			] as const)
		);
		const titleRouteSegments = new Map(routeSegments);

		return titles.map((title) => ({
			_id: title._id,
			title: title.title,
			sourceId: title.sourceId,
			sourcePkg: title.sourcePkg,
			sourceLang: title.sourceLang,
			titleUrl: title.titleUrl,
			routeSegment:
				titleRouteSegments.get(String(title._id)) ??
				buildTitleRouteBaseFromUrl(title.titleUrl, title.title),
			coverUrl: title.coverUrl ?? null,
			localCoverPath: title.localCoverPath ?? null,
			createdAt: title.createdAt,
			updatedAt: title.updatedAt
		}));
	}
});

export const getMineTotalCount = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return { listedCount: 0, totalCount: 0 };
		}

		const ownerUserId = identity.subject as GenericId<'users'>;
		const titles = await ctx.db
			.query('libraryTitles')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
			.collect();

		let listedCount = 0;
		for (const title of titles) {
			if (title.listedInLibrary !== false) {
				listedCount += 1;
			}
		}

		return {
			listedCount,
			totalCount: titles.length
		};
	}
});

export const getMineVisibilitySummary = query({
	args: {
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return {
				listedCount: 0,
				hiddenCount: 0,
				hiddenTitles: []
			};
		}

		const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 500)), 1000);
		const titles = await ctx.db
			.query('libraryTitles')
			.withIndex('by_owner_user_id', (q) =>
				q.eq('ownerUserId', identity.subject as GenericId<'users'>)
			)
			.take(limit);

		let listedCount = 0;
		let hiddenCount = 0;
		const hiddenTitles: Array<{
			_id: GenericId<'libraryTitles'>;
			title: string;
			sourceId: string;
			sourcePkg: string;
			sourceLang: string;
			titleUrl: string;
			coverUrl: string | null;
			localCoverPath: string | null;
			createdAt: number;
			updatedAt: number;
		}> = [];
		for (const title of titles) {
			if (title.listedInLibrary === false) {
				hiddenCount += 1;
				hiddenTitles.push({
					_id: title._id,
					title: title.title,
					sourceId: title.sourceId,
					sourcePkg: title.sourcePkg,
					sourceLang: title.sourceLang,
					titleUrl: title.titleUrl,
					coverUrl: title.coverUrl ?? null,
					localCoverPath: title.localCoverPath ?? null,
					createdAt: title.createdAt,
					updatedAt: title.updatedAt
				});
			} else {
				listedCount += 1;
			}
		}

		return {
			listedCount,
			hiddenCount,
			hiddenTitles: hiddenTitles.sort((left, right) => right.updatedAt - left.updatedAt)
		};
	}
});

export const getMineImportedSourceLookup = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [] as Array<{
				sourceId: string;
				titleUrl: string;
				libraryId: string;
				listedInLibrary: boolean;
				routeSegment: string;
			}>;
		}

		const ownerUserId = identity.subject as GenericId<'users'>;
		const [titles, variants] = await Promise.all([
			ctx.db
				.query('libraryTitles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
				.collect(),
			ctx.db
				.query('titleVariants')
				.withIndex('by_owner_user_id_library_title_id', (q) => q.eq('ownerUserId', ownerUserId))
				.collect()
		]);
		const titleRouteSegments = buildTitleRouteSegments(titles);

		const visibleTitleIds = new Set(titles.map((title) => String(title._id)));
		const titleById = new Map(titles.map((title) => [String(title._id), title]));
		const entries: Array<{
			sourceId: string;
			titleUrl: string;
			libraryId: string;
			listedInLibrary: boolean;
			routeSegment: string;
		}> = [];
		for (const title of titles) {
			entries.push({
				sourceId: title.sourceId,
				titleUrl: title.titleUrl,
				libraryId: String(title._id),
				listedInLibrary: title.listedInLibrary !== false,
				routeSegment:
					titleRouteSegments.get(String(title._id)) ??
					buildTitleRouteBaseFromUrl(title.titleUrl, title.title)
			});
		}
		for (const variant of variants) {
			if (!visibleTitleIds.has(String(variant.libraryTitleId))) continue;
			const primaryEntry = titleById.get(String(variant.libraryTitleId));
			entries.push({
				sourceId: variant.sourceId,
				titleUrl: variant.titleUrl,
				libraryId: String(variant.libraryTitleId),
				listedInLibrary: primaryEntry?.listedInLibrary !== false,
				routeSegment:
					titleRouteSegments.get(String(variant.libraryTitleId)) ??
					buildTitleRouteBaseFromUrl(primaryEntry?.titleUrl, primaryEntry?.title ?? '')
			});
		}
		return entries;
	}
});

export const listTitleChapters = query({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const [chapters, preferredVariant, progressRows] = await Promise.all([
			ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
				.collect(),
			getPreferredVariantForTitle(ctx, title),
			ctx.db
				.query('chapterProgress')
				.withIndex('by_owner_user_id_library_title_id_updated_at', (q) =>
					q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
				)
				.collect()
		]);
		const activeChapterSource = preferredVariant ?? title;
		const activeChapters = chapters.filter((chapter) =>
			chapterBelongsToVariant(chapter, activeChapterSource)
		);
		const activeChapterIds = new Set(activeChapters.map((chapter) => String(chapter._id)));
		const chapterRouteSegments = buildChapterRouteSegments(activeChapters);
		const progressByChapterId = new Map(
			progressRows
				.filter((row) => activeChapterIds.has(String(row.chapterId)))
				.map((row) => [String(row.chapterId), row] as const)
		);

		return sortLibraryChaptersInReadingOrder(activeChapters).map((chapter) => {
			const progress = progressByChapterId.get(String(chapter._id)) ?? null;
			return {
				...chapter,
				title: title.title,
				routeSegment:
					chapterRouteSegments.get(String(chapter._id)) ??
					buildChapterRouteBase(chapter.chapterName, chapter.chapterNumber ?? null),
				isRead: progress !== null,
				progressPageIndex: progress?.pageIndex ?? null,
				progressUpdatedAt: progress?.updatedAt ?? null
			};
		});
	}
});

export const getMineOverviewByRouteSegment = query({
	args: {
		routeSegment: v.string()
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return null;
		}

		const title = await findOwnedTitleByRouteSegment(
			ctx,
			identity.subject as GenericId<'users'>,
			args.routeSegment.trim()
		);
		if (!title) {
			return null;
		}

		const ctx_ = loadTitleOverviewContext(ctx, title);
		const {
			routeSegment,
			chapterStats,
			readingProgress,
			downloadProfileData,
			offlineReadiness,
			userStatus,
			collections,
			variants
		} = await ctx_;

		return {
			...title,
			routeSegment,
			userStatus,
			userRating: title.userRating ?? null,
			collections,
			preferredVariantId: title.preferredVariantId ?? null,
			variants,
			chapterStats,
			readingProgress,
			downloadProfile: downloadProfileData,
			offlineReadiness
		};
	}
});

export const getMineById = query({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const [ctx_, titleComments] = await Promise.all([
			loadTitleOverviewContext(ctx, title),
			ctx.db
				.query('chapterComments')
				.withIndex('by_owner_user_id_library_title_id_updated_at', (q) =>
					q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
				)
				.collect()
		]);

		const {
			routeSegment,
			chapters,
			userStatus,
			collections,
			variants,
			chapterStats,
			readingProgress,
			downloadProfileData,
			offlineReadiness
		} = ctx_;

		const chapterById = new Map(chapters.map((chapter) => [chapter._id, chapter]));

		return {
			...title,
			routeSegment,
			userStatus,
			userRating: title.userRating ?? null,
			collections,
			preferredVariantId: title.preferredVariantId ?? null,
			variants,
			chapterStats,
			readingProgress,
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
			downloadProfile: downloadProfileData,
			chapters: chapters.sort((left, right) => right.sequence - left.sequence),
			offlineReadiness
		};
	}
});

export const getMineOverviewById = query({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const {
			routeSegment,
			chapterStats,
			readingProgress,
			downloadProfileData,
			offlineReadiness,
			userStatus,
			collections,
			variants
		} = await loadTitleOverviewContext(ctx, title);

		return {
			...title,
			routeSegment,
			userStatus,
			userRating: title.userRating ?? null,
			collections,
			preferredVariantId: title.preferredVariantId ?? null,
			variants,
			chapterStats,
			readingProgress,
			downloadProfile: downloadProfileData,
			offlineReadiness
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
		if (variant) {
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

		return null;
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

		const [titleRouteSegment, chapters, preferredVariant] = await Promise.all([
			resolveOwnerTitleRouteSegment(ctx, title),
			ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
				.collect(),
			getPreferredVariantForTitle(ctx, title)
		]);
		const activeChapterSource = preferredVariant ?? title;
		const activeChapters = chapters.filter(
			(item) =>
				item.isAvailableFromSource !== false && chapterBelongsToVariant(item, activeChapterSource)
		);
		const chapterRouteSegments = buildChapterRouteSegments(activeChapters);

		const progress = await getOwnedChapterProgressRow(ctx, chapter._id);

		return {
			title: {
				...title,
				routeSegment: titleRouteSegment
			},
			chapter: {
				...chapter,
				routeSegment:
					chapterRouteSegments.get(String(chapter._id)) ??
					buildChapterRouteBase(chapter.chapterName, chapter.chapterNumber ?? null)
			},
			chapters: activeChapters
				.sort((left, right) => left.sequence - right.sequence)
				.map((item) => ({
					...item,
					routeSegment:
						chapterRouteSegments.get(String(item._id)) ??
						buildChapterRouteBase(item.chapterName, item.chapterNumber ?? null)
				})),
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

export const getReaderByRouteSegments = query({
	args: {
		titleRouteSegment: v.string(),
		chapterRouteSegment: v.string()
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return null;
		}

		const title = await findOwnedTitleByRouteSegment(
			ctx,
			identity.subject as GenericId<'users'>,
			args.titleRouteSegment.trim()
		);
		if (!title) {
			return null;
		}

		const chapters = await ctx.db
			.query('libraryChapters')
			.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
			.collect();
		const preferredVariant = await getPreferredVariantForTitle(ctx, title);
		const activeChapterSource = preferredVariant ?? title;
		const activeChapters = chapters.filter(
			(item) =>
				item.isAvailableFromSource !== false && chapterBelongsToVariant(item, activeChapterSource)
		);
		const chapterRouteSegments = buildChapterRouteSegments(activeChapters);
		const chapter =
			activeChapters.find(
				(item) =>
					(chapterRouteSegments.get(String(item._id)) ??
						buildChapterRouteBase(item.chapterName, item.chapterNumber ?? null)) ===
					args.chapterRouteSegment.trim()
			) ?? null;
		if (!chapter) {
			return null;
		}

		const progress = await getOwnedChapterProgressRow(ctx, chapter._id);

		return {
			title: {
				...title,
				routeSegment: args.titleRouteSegment.trim()
			},
			chapter: {
				...chapter,
				routeSegment:
					chapterRouteSegments.get(String(chapter._id)) ??
					buildChapterRouteBase(chapter.chapterName, chapter.chapterNumber ?? null)
			},
			chapters: activeChapters
				.sort((left, right) => left.sequence - right.sequence)
				.map((item) => ({
					...item,
					routeSegment:
						chapterRouteSegments.get(String(item._id)) ??
						buildChapterRouteBase(item.chapterName, item.chapterNumber ?? null)
				})),
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

export const listTitleComments = query({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const [comments, chapters] = await Promise.all([
			ctx.db
				.query('chapterComments')
				.withIndex('by_owner_user_id_library_title_id_updated_at', (q) =>
					q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
				)
				.collect(),
			ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
				.collect()
		]);

		const chapterById = new Map(chapters.map((chapter) => [chapter._id, chapter] as const));
		return comments
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
			});
	}
});

export const listAllMineChapters = query({
	args: {
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}
		const userId = identity.subject as GenericId<'users'>;
		const limit = Math.min(Math.max(100, Math.floor(args.limit ?? 2000)), 10000);

		const chapters = await ctx.db
			.query('libraryChapters')
			.withIndex('by_owner_user_id_updated_at', (q) => q.eq('ownerUserId', userId))
			.order('desc')
			.take(limit);

		const referencedTitleIds = [...new Set(chapters.map((c) => String(c.libraryTitleId)))];
		const titles = await Promise.all(
			referencedTitleIds.map((id) => ctx.db.get(id as GenericId<'libraryTitles'>))
		);

		const titleById = new Map(
			titles
				.filter((t): t is NonNullable<typeof t> => t !== null)
				.map((title) => [String(title._id), title] as const)
		);

		return chapters
			.map((chapter) => {
				const title = titleById.get(String(chapter.libraryTitleId));
				return {
					...chapter,
					title: title?.title ?? '',
					sourcePkg: chapter.sourcePkg,
					sourceLang: chapter.sourceLang,
					titleCoverUrl: title?.coverUrl ?? null,
					localCoverPath: title?.localCoverPath ?? null
				};
			});
	}
});

export const listContinueReading = query({
	args: {
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return { items: [], totalInProgress: 0 };

		const userId = identity.subject as GenericId<'users'>;
		const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 5)), 12);

		const recentTitles = await ctx.db
			.query('libraryTitles')
			.withIndex('by_owner_user_id_last_read_at', (q) =>
				q.eq('ownerUserId', userId).gt('lastReadAt', 0)
			)
			.order('desc')
			.collect();

		const inProgress = recentTitles.filter((title) => title.listedInLibrary !== false);

		const totalInProgress = inProgress.length;
		const candidates = inProgress.slice(0, limit * 4);

		if (candidates.length === 0) return { items: [], totalInProgress: 0 };

		const titleRouteSegments = buildTitleRouteSegments(candidates);

		const enriched = await Promise.all(
			candidates.map(async (title) => {
				const [chapters, preferredVariant, allProgress] = await Promise.all([
					ctx.db
						.query('libraryChapters')
						.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
						.collect(),
					getPreferredVariantForTitle(ctx, title),
					ctx.db
						.query('chapterProgress')
						.withIndex('by_owner_user_id_library_title_id_updated_at', (q) =>
							q.eq('ownerUserId', userId).eq('libraryTitleId', title._id)
						)
						.collect()
				]);

				const activeChapterSource = preferredVariant ?? title;
				const activeChapters = chapters.filter((chapter) =>
					chapterBelongsToVariant(chapter, activeChapterSource)
				);
				const orderedChapters = sortLibraryChaptersInReadingOrder(activeChapters);
				const chapterRouteSegments = buildChapterRouteSegments(activeChapters);

				const activeChapterIds = new Set(activeChapters.map((c) => String(c._id)));
				const activeProgress = allProgress.filter((row) =>
					activeChapterIds.has(String(row.chapterId))
				);
				const latestProgress =
					[...activeProgress].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;

				const progressChapter = latestProgress
					? (activeChapters.find((c) => String(c._id) === String(latestProgress.chapterId)) ?? null)
					: null;
				const targetChapter = progressChapter ?? orderedChapters[0] ?? null;
				if (!targetChapter) return null;

				const chaptersRead = activeProgress.length;

				if (activeChapters.length > 0 && chaptersRead >= activeChapters.length) {
					return null;
				}

				return {
					titleId: title._id,
					title: title.title,
					routeSegment:
						titleRouteSegments.get(String(title._id)) ??
						buildTitleRouteBaseFromUrl(title.titleUrl, title.title),
					coverUrl: title.coverUrl ?? null,
					localCoverPath: title.localCoverPath ?? null,
					lastReadAt: title.lastReadAt ?? 0,
					chaptersTotal: activeChapters.length,
					chaptersRead,
					chapter: {
						id: targetChapter._id,
						name: targetChapter.chapterName,
						number: targetChapter.chapterNumber ?? null,
						routeSegment:
							chapterRouteSegments.get(String(targetChapter._id)) ??
							buildChapterRouteBase(targetChapter.chapterName, targetChapter.chapterNumber ?? null),
						totalPages: targetChapter.totalPages ?? null,
						pageIndex: latestProgress?.pageIndex ?? 0,
						hasProgress: latestProgress !== null
					}
				};
			})
		);

		const items = enriched
			.filter(
				(entry): entry is NonNullable<typeof entry> => entry !== null && entry.chapter !== null
			)
			.sort((left, right) => right.lastReadAt - left.lastReadAt)
			.slice(0, limit);

		return { items, totalInProgress };
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
			sourcePkg: chapter.sourcePkg,
			sourceLang: chapter.sourceLang,
			titleCoverUrl: title.coverUrl ?? null,
			localCoverPath: title.localCoverPath ?? null
		};
	}
});
