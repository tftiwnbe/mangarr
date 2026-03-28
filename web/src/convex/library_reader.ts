import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { mutation, query, type QueryCtx } from './_generated/server';
import { buildChapterRouteBase, buildTitleRouteBase, buildUniqueRouteSegmentMap } from '../lib/utils/route-segments';
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

function buildTitleRouteSegments<T extends { _id: GenericId<'libraryTitles'>; title: string }>(titles: readonly T[]) {
	return buildUniqueRouteSegmentMap({
		items: titles,
		getId: (title) => String(title._id),
		getBase: (title) => buildTitleRouteBase(title.title)
	});
}

function buildChapterRouteSegments<
	T extends {
		_id: GenericId<'libraryChapters'>;
		chapterName: string;
		chapterNumber?: number | null;
	}
>(chapters: readonly T[]) {
	return buildUniqueRouteSegmentMap({
		items: chapters,
		getId: (chapter) => String(chapter._id),
		getBase: (chapter) => buildChapterRouteBase(chapter.chapterName, chapter.chapterNumber ?? null)
	});
}

async function findOwnedTitleByRouteSegment(
	ctx: QueryCtx,
	ownerUserId: GenericId<'users'>,
	routeSegment: string
) {
	const titles = await ctx.db
		.query('libraryTitles')
		.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
		.collect();
	const routeSegments = buildTitleRouteSegments(titles);
	return (
		titles.find((title: (typeof titles)[number]) => routeSegments.get(String(title._id)) === routeSegment) ??
		null
	);
}

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

function isOfflineMetadataReady(title: {
	author?: string | null;
	artist?: string | null;
	description?: string | null;
	genre?: string | null;
	status?: number | null;
}) {
	const hasCreator =
		typeof title.author === 'string' && title.author.trim().length > 0
			? true
			: typeof title.artist === 'string' && title.artist.trim().length > 0;
	return (
		hasCreator &&
		typeof title.description === 'string' &&
		title.description.trim().length > 0 &&
		typeof title.genre === 'string' &&
		title.genre.trim().length > 0 &&
		Number(title.status ?? 0) > 0
	);
}

function summarizeOfflineReadiness(
	title: {
		coverUrl?: string | null;
		localCoverPath?: string | null;
		author?: string | null;
		artist?: string | null;
		description?: string | null;
		genre?: string | null;
		status?: number | null;
	},
	chapters: Array<{
		downloadStatus: (typeof DOWNLOAD_STATUS)[keyof typeof DOWNLOAD_STATUS];
	}>
) {
	const downloadStats = summarizeDownloadStats(chapters);
	const metadataReady = isOfflineMetadataReady(title);
	const cachedCover = typeof title.localCoverPath === 'string' && title.localCoverPath.trim().length > 0;
	return {
		titlePageReady: metadataReady && downloadStats.total > 0,
		metadataReady,
		cachedCover,
		downloadedChapters: downloadStats.downloaded,
		totalChapters: downloadStats.total,
		fullyDownloaded: downloadStats.total > 0 && downloadStats.downloaded === downloadStats.total,
		missingCoverCache:
			!cachedCover && typeof title.coverUrl === 'string' && title.coverUrl.trim().length > 0
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
		const titleRouteSegments = buildTitleRouteSegments(titles);

		return [...titles]
			.filter((title) => title.listedInLibrary !== false)
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.map((title) => {
				const chapters = chaptersByTitleId.get(String(title._id)) ?? [];
				const collectionIds = collectionIdsByTitleId.get(String(title._id)) ?? [];

					return {
						...title,
						routeSegment: titleRouteSegments.get(String(title._id)) ?? buildTitleRouteBase(title.title),
						userStatus: title.userStatusId ? (statusById.get(String(title.userStatusId)) ?? null) : null,
						userRating: title.userRating ?? null,
					collections: collectionIds
							.map((collectionId) => collectionById.get(String(collectionId)) ?? null)
							.filter((collection): collection is NonNullable<typeof collection> => collection !== null)
							.sort((left, right) => left.position - right.position),
						variantsCount: variantCountsByTitleId.get(String(title._id)) ?? 0,
						chapterStats: summarizeDownloadStats(chapters),
						offlineReadiness: summarizeOfflineReadiness(title, chapters)
					};
				});
	}
});

export const listHiddenMine = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}

		const ownerUserId = identity.subject as GenericId<'users'>;
		const titles = await ctx.db
			.query('libraryTitles')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
			.collect();
		const titleRouteSegments = buildTitleRouteSegments(titles);

		return titles
			.filter((title) => title.listedInLibrary === false)
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.map((title) => ({
				_id: title._id,
				title: title.title,
				sourceId: title.sourceId,
				sourcePkg: title.sourcePkg,
				sourceLang: title.sourceLang,
				titleUrl: title.titleUrl,
				routeSegment: titleRouteSegments.get(String(title._id)) ?? buildTitleRouteBase(title.title),
				coverUrl: title.coverUrl ?? null,
				localCoverPath: title.localCoverPath ?? null,
				createdAt: title.createdAt,
				updatedAt: title.updatedAt
			}));
	}
});

export const getMineVisibilitySummary = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return {
				listedCount: 0,
				hiddenCount: 0,
				hiddenTitles: []
			};
		}

		const titles = await ctx.db
			.query('libraryTitles')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', identity.subject as GenericId<'users'>))
			.collect();

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
			return {};
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
		const lookup: Record<
			string,
			{
				libraryId: string;
				listedInLibrary: boolean;
				routeSegment: string;
			}
		> = {};
		for (const title of titles) {
			lookup[`${title.sourceId}::${title.titleUrl}`] = {
				libraryId: String(title._id),
				listedInLibrary: title.listedInLibrary !== false,
				routeSegment: titleRouteSegments.get(String(title._id)) ?? buildTitleRouteBase(title.title)
			};
		}
		for (const variant of variants) {
			if (!visibleTitleIds.has(String(variant.libraryTitleId))) continue;
			const primaryEntry = titleById.get(String(variant.libraryTitleId));
			lookup[`${variant.sourceId}::${variant.titleUrl}`] = {
				libraryId: String(variant.libraryTitleId),
				listedInLibrary: primaryEntry?.listedInLibrary !== false,
				routeSegment:
					titleRouteSegments.get(String(variant.libraryTitleId)) ??
					buildTitleRouteBase(primaryEntry?.title ?? '')
			};
		}
		return lookup;
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
		const chapterRouteSegments = buildChapterRouteSegments(chapters);

		return chapters
			.sort((left, right) => left.sequence - right.sequence)
			.map((chapter) => ({
				...chapter,
				routeSegment:
					chapterRouteSegments.get(String(chapter._id)) ??
					buildChapterRouteBase(chapter.chapterName, chapter.chapterNumber ?? null)
			}));
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

		const [overviewTitles, chapters, userStatus, collections, variants, progressRows, downloadProfile] =
			await Promise.all([
				ctx.db
					.query('libraryTitles')
					.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', title.ownerUserId))
					.collect(),
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
					.query('downloadProfiles')
					.withIndex('by_owner_user_id_library_title_id', (q) =>
						q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
					)
					.unique()
			]);

		const latestProgress =
			[...progressRows].sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
		const titleRouteSegments = buildTitleRouteSegments(overviewTitles);

		return {
			...title,
			routeSegment: titleRouteSegments.get(String(title._id)) ?? buildTitleRouteBase(title.title),
			userStatus,
			userRating: title.userRating ?? null,
			collections,
			preferredVariantId: title.preferredVariantId ?? null,
			variants,
			chapterStats: summarizeDownloadStats(chapters),
			readingProgress: {
				startedChapters: progressRows.length,
				latest: latestProgress
					? {
							chapterId: latestProgress.chapterId,
							pageIndex: latestProgress.pageIndex,
							updatedAt: latestProgress.updatedAt
						}
					: null
			},
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
			offlineReadiness: summarizeOfflineReadiness(title, chapters)
		};
	}
});

export const getMineById = query({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const [titles, chapters, userStatus, collections, variants, progressRows, titleComments, downloadProfile] =
			await Promise.all([
				ctx.db
					.query('libraryTitles')
					.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', title.ownerUserId))
					.collect(),
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
		const titleRouteSegments = buildTitleRouteSegments(titles);

		return {
			...title,
			routeSegment: titleRouteSegments.get(String(title._id)) ?? buildTitleRouteBase(title.title),
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
				chapters: chapters.sort((left, right) => right.sequence - left.sequence),
				offlineReadiness: summarizeOfflineReadiness(title, chapters)
			};
	}
});

export const getMineOverviewById = query({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const [titles, chapters, userStatus, collections, variants, progressRows, downloadProfile] = await Promise.all([
			ctx.db
				.query('libraryTitles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', title.ownerUserId))
				.collect(),
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
				.query('downloadProfiles')
				.withIndex('by_owner_user_id_library_title_id', (q) =>
					q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
				)
				.unique()
		]);

		const latestProgress =
			[...progressRows].sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
		const titleRouteSegments = buildTitleRouteSegments(titles);

		return {
			...title,
			routeSegment: titleRouteSegments.get(String(title._id)) ?? buildTitleRouteBase(title.title),
			userStatus,
			userRating: title.userRating ?? null,
			collections,
			preferredVariantId: title.preferredVariantId ?? null,
			variants,
			chapterStats: summarizeDownloadStats(chapters),
			readingProgress: {
				startedChapters: progressRows.length,
				latest: latestProgress
					? {
							chapterId: latestProgress.chapterId,
							pageIndex: latestProgress.pageIndex,
							updatedAt: latestProgress.updatedAt
						}
					: null
			},
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
				offlineReadiness: summarizeOfflineReadiness(title, chapters)
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

		const [titles, chapters] = await Promise.all([
			ctx.db
				.query('libraryTitles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', title.ownerUserId))
				.collect(),
			ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
				.collect()
		]);
		const chapterRouteSegments = buildChapterRouteSegments(chapters);
		const titleRouteSegments = buildTitleRouteSegments(titles);

		const progress = await getOwnedChapterProgressRow(ctx, chapter._id);

		return {
			title: {
				...title,
				routeSegment: titleRouteSegments.get(String(title._id)) ?? buildTitleRouteBase(title.title)
			},
			chapter: {
				...chapter,
				routeSegment:
					chapterRouteSegments.get(String(chapter._id)) ??
					buildChapterRouteBase(chapter.chapterName, chapter.chapterNumber ?? null)
			},
			chapters: chapters
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
		const chapterRouteSegments = buildChapterRouteSegments(chapters);
		const chapter =
			chapters.find(
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
			chapters: chapters
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
