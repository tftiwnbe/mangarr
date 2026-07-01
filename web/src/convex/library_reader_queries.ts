import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import type { Doc } from './_generated/dataModel';
import { query, type QueryCtx } from './_generated/server';
import { buildChapterRouteBase, buildTitleRouteBaseFromUrl } from '../lib/utils/route-segments';
import { chapterGroupKeyForRow, collapseChapterReleases } from './chapter_groups';
import { DOWNLOAD_STATUS } from './library_shared_access';
import { cleanExtensionLabel, humanizeSourcePkg } from './library_shared_values';
import { pickStorageTitleBase } from './storage_names';
import {
	chapterBelongsToVariant,
	getPreferredVariantForTitle,
	getOwnedChapterProgressRow,
	loadOwnerCollectionIdsByTitleId,
	loadOwnerCollectionMap,
	loadOwnerUserStatusMap,
	resolveStorageTitleBaseForTitle,
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

		const [
			allTitles,
			statusById,
			collectionById,
			collectionIdsByTitleId,
			downloadProfiles,
			variants,
			installedExtensions
		] =
			await Promise.all([
			ctx.db
				.query('libraryTitles')
				.withIndex('by_owner_user_id_updated_at', (q) => q.eq('ownerUserId', userId))
				.order('desc')
				.take(limit + offset),
			loadOwnerUserStatusMap(ctx, userId),
			loadOwnerCollectionMap(ctx, userId),
			loadOwnerCollectionIdsByTitleId(ctx, userId),
			ctx.db
				.query('downloadProfiles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
				.collect(),
			ctx.db.query('titleVariants').collect(),
			ctx.db.query('installedExtensions').collect()
		]);
		const downloadProfileByTitleId = new Map(
			downloadProfiles.map((profile) => [String(profile.libraryTitleId), profile] as const)
		);
		const preferredVariantByTitleId = new Map(
			variants
				.filter((variant) => variant.ownerUserId === userId && variant.isPreferred)
				.map((variant) => [String(variant.libraryTitleId), variant] as const)
		);
		const sourceNamesById = new Map<string, string>();
		const sourceNamesByPkg = new Map<string, string>();
		for (const extension of installedExtensions) {
			const extensionName = cleanExtensionLabel(extension.name);
			sourceNamesByPkg.set(extension.pkg, extensionName);
			for (const source of extension.sources ?? []) {
				sourceNamesById.set(source.id, source.name);
			}
		}

		const titles = allTitles.slice(offset);

		return titles
			.filter((title) => title.listedInLibrary !== false)
			.map((title) => {
				const activeSource = preferredVariantByTitleId.get(String(title._id)) ?? title;
				const collectionIds = collectionIdsByTitleId.get(String(title._id)) ?? [];
				const downloadProfile = downloadProfileByTitleId.get(String(title._id)) ?? null;
				const currentSourceName =
					sourceNamesById.get(activeSource.sourceId) ??
					sourceNamesByPkg.get(activeSource.sourcePkg) ??
					humanizeSourcePkg(activeSource.sourcePkg);
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
					author: title.author ?? null,
					artist: title.artist ?? null,
					coverUrl: title.coverUrl ?? null,
					localCoverPath: title.localCoverPath ?? null,
					status: title.status ?? null,
					genre: title.genre ?? null,
					lastReadAt: title.lastReadAt ?? null,
					createdAt: title.createdAt,
					updatedAt: title.updatedAt,
					currentSourceId: activeSource.sourceId,
					currentSourceLabel: `${currentSourceName}${activeSource.sourceLang ? ` [${activeSource.sourceLang}]` : ''}`,
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
					downloadProfile: downloadProfile
						? {
								enabled: downloadProfile.enabled,
								paused: downloadProfile.paused
							}
						: null,
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
			titles.map(
				async (title) =>
					[String(title._id), await resolveOwnerTitleRouteSegment(ctx, title)] as const
			)
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
	args: {
		entries: v.array(
			v.object({
				sourceId: v.string(),
				titleUrl: v.string()
			})
		)
	},
	handler: async (ctx, args) => {
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
		const requestedEntries: Array<{ sourceId: string; titleUrl: string }> = [];
		const seen = new Set<string>();
		for (const entry of args.entries) {
			const sourceId = entry.sourceId.trim();
			const titleUrl = entry.titleUrl.trim();
			if (!sourceId || !titleUrl) continue;
			const key = `${sourceId}::${titleUrl}`;
			if (seen.has(key)) continue;
			seen.add(key);
			requestedEntries.push({ sourceId, titleUrl });
		}
		if (requestedEntries.length === 0) {
			return [];
		}

		const resolvedTitleById = new Map<
			string,
			Promise<{
				libraryId: string;
				listedInLibrary: boolean;
				routeSegment: string;
			}>
		>();
		const resolveTitleLookup = (title: {
			_id: GenericId<'libraryTitles'>;
			ownerUserId: GenericId<'users'>;
			title: string;
			titleUrl?: string | null;
			routeBase?: string | null;
			listedInLibrary?: boolean | null;
		}) => {
			const titleId = String(title._id);
			const existing = resolvedTitleById.get(titleId);
			if (existing) return existing;
			const promise = (async () => ({
				libraryId: titleId,
				listedInLibrary: title.listedInLibrary !== false,
				routeSegment:
					(await resolveOwnerTitleRouteSegment(ctx, title)) ??
					buildTitleRouteBaseFromUrl(title.titleUrl, title.title)
			}))();
			resolvedTitleById.set(titleId, promise);
			return promise;
		};

		return (
			await Promise.all(
				requestedEntries.map(async (entry) => {
					let title = await ctx.db
						.query('libraryTitles')
						.withIndex('by_owner_user_id_source_id_title_url', (q) =>
							q
								.eq('ownerUserId', ownerUserId)
								.eq('sourceId', entry.sourceId)
								.eq('titleUrl', entry.titleUrl)
						)
						.unique();

					if (!title) {
						const variant = await ctx.db
							.query('titleVariants')
							.withIndex('by_owner_user_id_source_id_title_url', (q) =>
								q
									.eq('ownerUserId', ownerUserId)
									.eq('sourceId', entry.sourceId)
									.eq('titleUrl', entry.titleUrl)
							)
							.unique();
						if (variant) {
							const candidate = await ctx.db.get(variant.libraryTitleId);
							if (candidate && candidate.ownerUserId === ownerUserId) {
								title = candidate;
							}
						}
					}

					if (!title) {
						return null;
					}

					const resolved = await resolveTitleLookup(title);
					return {
						sourceId: entry.sourceId,
						titleUrl: entry.titleUrl,
						...resolved
					};
				})
			)
		).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
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
		const activeReleases = chapters.filter((chapter) =>
			chapterBelongsToVariant(chapter, activeChapterSource)
		);
		const progressByGroupKey = new Map<string, { pageIndex: number; updatedAt: number }>();
		for (const row of progressRows) {
			const release = activeReleases.find((chapter) => String(chapter._id) === String(row.chapterId));
			if (!release) continue;
			const groupKey = chapterGroupKeyForRow(release);
			const current = progressByGroupKey.get(groupKey);
			if (!current || row.updatedAt > current.updatedAt) {
				progressByGroupKey.set(groupKey, {
					pageIndex: row.pageIndex,
					updatedAt: row.updatedAt
				});
			}
		}
		const activeChapters = collapseChapterReleases(activeReleases).filter((chapter) => {
			if (chapter.releases.some((release) => release.isAvailableFromSource !== false)) {
				return true;
			}
			if (chapter.downloadStatus !== DOWNLOAD_STATUS.MISSING) {
				return true;
			}
			return progressByGroupKey.has(chapter.chapterGroupKey);
		});
		const chapterRouteSegments = buildChapterRouteSegments(activeChapters);
		const progressByChapterId = new Map(
			activeChapters
				.filter((chapter) => progressByGroupKey.has(chapter.chapterGroupKey))
				.map((chapter) => [
					String(chapter._id),
					{
						pageIndex: progressByGroupKey.get(chapter.chapterGroupKey)!.pageIndex,
						updatedAt: progressByGroupKey.get(chapter.chapterGroupKey)!.updatedAt
					}
				] as const)
		);

		return sortLibraryChaptersInReadingOrder(activeChapters).map((chapter) => {
			const progress = progressByChapterId.get(String(chapter._id)) ?? null;
			return {
				...chapter,
				title: title.title,
				routeSegment:
					chapterRouteSegments.get(String(chapter._id)) ??
					buildChapterRouteBase(chapter.chapterName, chapter.chapterNumber ?? null),
				releaseCount: chapter.releaseCount,
				hasAlternateReleases: chapter.hasAlternateReleases,
				scanlators: chapter.scanlators,
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
		const activeChapters = collapseChapterReleases(
			chapters.filter((item) => chapterBelongsToVariant(item, activeChapterSource))
		).filter(
			(item) =>
				item.releases.some((release) => release.isAvailableFromSource !== false) ||
				item.downloadStatus !== DOWNLOAD_STATUS.MISSING ||
				item.releaseIds.some((releaseId) => releaseId === chapter._id)
		);
		const currentChapter =
			activeChapters.find(
				(item) =>
					item.chapterGroupKey ===
					chapterGroupKeyForRow({
						chapterGroupKey: chapter.chapterGroupKey,
						chapterName: chapter.chapterName,
						chapterNumber: chapter.chapterNumber
					})
			) ?? activeChapters.find((item) => item.releaseIds.some((releaseId) => releaseId === chapter._id));
		if (!currentChapter) {
			throw new Error('Library chapter group not found');
		}
		const chapterRouteSegments = buildChapterRouteSegments(activeChapters);

		const progress =
			(await Promise.all(
				currentChapter.releaseIds.map((releaseId) => getOwnedChapterProgressRow(ctx, releaseId))
			))
				.filter((row): row is NonNullable<typeof row> => row !== null)
				.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;

		return {
			title: {
				...title,
				routeSegment: titleRouteSegment
			},
			chapter: {
				...currentChapter,
				routeSegment:
					chapterRouteSegments.get(String(currentChapter._id)) ??
					buildChapterRouteBase(currentChapter.chapterName, currentChapter.chapterNumber ?? null)
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
		const activeChapters = collapseChapterReleases(
			chapters.filter((item) => chapterBelongsToVariant(item, activeChapterSource))
		).filter(
			(item) =>
				item.releases.some((release) => release.isAvailableFromSource !== false) ||
				item.downloadStatus !== DOWNLOAD_STATUS.MISSING
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

		const progress =
			(await Promise.all(chapter.releaseIds.map((releaseId) => getOwnedChapterProgressRow(ctx, releaseId))))
				.filter((row): row is NonNullable<typeof row> => row !== null)
				.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;

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

		return chapters.map((chapter) => {
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

export const listAllMineChaptersForTitle = query({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const [chapters, preferredVariant] = await Promise.all([
			ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
				.collect(),
			getPreferredVariantForTitle(ctx, title)
		]);
		const activeChapterSource = preferredVariant ?? title;
		const activeChapters = chapters.filter((chapter) =>
			chapterBelongsToVariant(chapter, activeChapterSource)
		);

		return activeChapters
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.map((chapter) => ({
				...chapter,
				title: title.title,
				sourcePkg: chapter.sourcePkg,
				sourceLang: chapter.sourceLang,
				titleCoverUrl: title.coverUrl ?? null,
				localCoverPath: title.localCoverPath ?? null
			}));
	}
});

export const listDownloadedMineChapters = query({
	args: {
		titleId: v.optional(v.id('libraryTitles')),
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}
		const userId = identity.subject as GenericId<'users'>;
		const limit = Math.min(Math.max(100, Math.floor(args.limit ?? 5000)), 10000);

		const chapters =
			args.titleId != null
				? await (async () => {
						const title = await requireOwnedTitle(ctx, args.titleId!);
						const [downloadedRows, preferredVariant] = await Promise.all([
							ctx.db
								.query('libraryChapters')
								.withIndex('by_library_title_id_download_status', (q) =>
									q.eq('libraryTitleId', args.titleId!).eq('downloadStatus', DOWNLOAD_STATUS.DOWNLOADED)
								)
								.order('desc')
								.take(limit),
							getPreferredVariantForTitle(ctx, title)
						]);
						const activeChapterSource = preferredVariant ?? title;
						return downloadedRows.filter(
							(chapter) =>
								chapter.ownerUserId === userId &&
								typeof chapter.localRelativePath === 'string' &&
								chapter.localRelativePath.length > 0 &&
								chapterBelongsToVariant(chapter, activeChapterSource)
						);
					})()
				: await ctx.db
						.query('libraryChapters')
						.withIndex('by_owner_user_id_download_status', (q) =>
							q.eq('ownerUserId', userId).eq('downloadStatus', DOWNLOAD_STATUS.DOWNLOADED)
						)
						.order('desc')
						.take(limit);

		return chapters.map((chapter) => ({
			...chapter,
			sourcePkg: chapter.sourcePkg,
			sourceLang: chapter.sourceLang
		}));
	}
});

export const listReconcileDownloadTitles = query({
	args: {
		titleId: v.optional(v.id('libraryTitles'))
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}
		const userId = identity.subject as GenericId<'users'>;

		const profileRows = await ctx.db
				.query('downloadProfiles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
				.collect();
		const watchedTitleIds = [...new Set(profileRows.map((profile) => String(profile.libraryTitleId)))];
		if (args.titleId != null) {
			if (!watchedTitleIds.includes(String(args.titleId))) {
				return [];
			}
			const title = await ctx.db.get(args.titleId);
			return title && title.ownerUserId === userId
				? [{ titleId: title._id, title: title.title, updatedAt: title.updatedAt }]
				: [];
		}

		const titles = await Promise.all(
			watchedTitleIds.map((titleId) => ctx.db.get(titleId as GenericId<'libraryTitles'>))
		);
		return titles
			.filter((title): title is NonNullable<typeof title> => title !== null && title.ownerUserId === userId)
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.map((title) => ({
				titleId: title._id,
				title: title.title,
				updatedAt: title.updatedAt
			}));
	}
});

export const listNormalizeDownloadTitles = query({
	args: {
		titleId: v.optional(v.id('libraryTitles'))
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}
		const userId = identity.subject as GenericId<'users'>;

		const profileRows = await ctx.db
			.query('downloadProfiles')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
			.collect();
		const watchedTitleIds = [...new Set(profileRows.map((profile) => String(profile.libraryTitleId)))];
		const titles =
			args.titleId != null
				? watchedTitleIds.includes(String(args.titleId))
					? [await ctx.db.get(args.titleId)].filter(
							(title): title is NonNullable<typeof title> =>
								title !== null && title.ownerUserId === userId
						)
					: []
				: (
						await Promise.all(
							watchedTitleIds.map((titleId) => ctx.db.get(titleId as GenericId<'libraryTitles'>))
						)
					)
						.filter(
							(title): title is NonNullable<typeof title> =>
								title !== null && title.ownerUserId === userId
						)
						.sort((left, right) => right.updatedAt - left.updatedAt);

		const variants = await ctx.db
			.query('titleVariants')
			.withIndex('by_owner_user_id_library_title_id', (q) => q.eq('ownerUserId', userId))
			.collect();
		const variantsByTitleId = new Map<string, typeof variants>();
		for (const variant of variants) {
			const key = String(variant.libraryTitleId);
			const current = variantsByTitleId.get(key) ?? [];
			current.push(variant);
			variantsByTitleId.set(key, current);
		}

		return titles.map((title) => ({
			titleId: title._id,
			storageTitleBase: pickStorageTitleBase({
				canonicalTitle: title.title,
				canonicalTitleUrl: title.titleUrl,
				variants: (variantsByTitleId.get(String(title._id)) ?? []).map((variant) => ({
					title: variant.title,
					titleUrl: variant.titleUrl
				}))
			}),
			downloadedChapterCount: title.downloadedChapterCount ?? 0
		}));
	}
});

export const getStorageTitleBases = query({
	args: {
		titleIds: v.array(v.id('libraryTitles'))
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return {};
		}
		const userId = identity.subject as GenericId<'users'>;
		const uniqueTitleIds = [...new Set(args.titleIds.map((titleId) => String(titleId)))].slice(0, 1000);
		const titles = await Promise.all(
			uniqueTitleIds.map((titleId) => ctx.db.get(titleId as GenericId<'libraryTitles'>))
		);
		const entries = await Promise.all(
			titles
				.filter((title): title is NonNullable<typeof title> => title !== null && title.ownerUserId === userId)
				.map(async (title) => [String(title._id), await resolveStorageTitleBaseForTitle(ctx, title)] as const)
		);
		return Object.fromEntries(entries);
	}
});

async function buildContinueReadingEntry(
	ctx: QueryCtx,
	userId: GenericId<'users'>,
	title: Doc<'libraryTitles'>,
	titleRouteSegments: Map<string, string>
) {
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
	const activeReleases = chapters.filter((chapter: Doc<'libraryChapters'>) =>
		chapterBelongsToVariant(chapter, activeChapterSource)
	);
	const releaseById = new Map(
		activeReleases.map((chapter: Doc<'libraryChapters'>) => [String(chapter._id), chapter] as const)
	);
	const progressByGroupKey = new Map<
		string,
		{ chapterId: GenericId<'libraryChapters'>; pageIndex: number; updatedAt: number }
	>();
	for (const row of allProgress) {
		const release = releaseById.get(String(row.chapterId));
		if (!release) continue;
		const groupKey = chapterGroupKeyForRow(release);
		const current = progressByGroupKey.get(groupKey);
		if (!current || row.updatedAt > current.updatedAt) {
			progressByGroupKey.set(groupKey, {
				chapterId: row.chapterId,
				pageIndex: row.pageIndex,
				updatedAt: row.updatedAt
			});
		}
	}

	const activeChapters = collapseChapterReleases(activeReleases).filter((chapter) => {
		if (chapter.releases.some((release) => release.isAvailableFromSource !== false)) {
			return true;
		}
		if (chapter.downloadStatus !== DOWNLOAD_STATUS.MISSING) {
			return true;
		}
		return progressByGroupKey.has(chapter.chapterGroupKey);
	});
	const chapterRouteSegments = buildChapterRouteSegments(activeChapters);
	const latestProgress =
		[...progressByGroupKey.entries()].sort(([, left], [, right]) => right.updatedAt - left.updatedAt)[0] ??
		null;

	if (!latestProgress) return null;

	const progressChapter =
		activeChapters.find((chapter) => chapter.chapterGroupKey === latestProgress[0]) ?? null;
	if (!progressChapter) return null;

	const latestChapterProgress = latestProgress[1] ?? null;
	const chaptersRead = activeChapters.filter((chapter) => progressByGroupKey.has(chapter.chapterGroupKey)).length;

	if (activeChapters.length > 0 && chaptersRead >= activeChapters.length) {
		return null;
	}

	const lastReadAt = title.lastReadAt ?? 0;
	const unreadChapters = activeChapters.filter((chapter) => !progressByGroupKey.has(chapter.chapterGroupKey));
	const latestUnreadUpdateAt = unreadChapters
		.filter((chapter) => !progressByGroupKey.has(chapter.chapterGroupKey))
		.flatMap((chapter) => chapter.releases)
		.reduce((latest, release) => Math.max(latest, release.updatedAt ?? 0), 0);
	const latestUnreadPublishedAt = unreadChapters
		.flatMap((chapter) => chapter.releases)
		.reduce((latest, release) => Math.max(latest, release.dateUpload ?? 0), 0);

	return {
		titleId: title._id,
		title: title.title,
		routeSegment:
			titleRouteSegments.get(String(title._id)) ??
			buildTitleRouteBaseFromUrl(title.titleUrl, title.title),
		coverUrl: title.coverUrl ?? null,
		localCoverPath: title.localCoverPath ?? null,
		lastReadAt,
		latestUnreadUpdateAt,
		latestUnreadPublishedAt,
		hasUnreadUpdateSinceLastRead: latestUnreadUpdateAt > lastReadAt,
		chaptersTotal: activeChapters.length,
		chaptersRead,
		chapter: {
			id: progressChapter._id,
			name: progressChapter.chapterName,
			number: progressChapter.chapterNumber ?? null,
			routeSegment:
				chapterRouteSegments.get(String(progressChapter._id)) ??
				buildChapterRouteBase(progressChapter.chapterName, progressChapter.chapterNumber ?? null),
			totalPages: progressChapter.totalPages ?? null,
			pageIndex: latestChapterProgress?.pageIndex ?? 0,
			hasProgress: latestChapterProgress !== null
		}
	};
}

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
			candidates.map((title) => buildContinueReadingEntry(ctx, userId, title, titleRouteSegments))
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

export const listContinueReadingUpdates = query({
	args: {
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return { items: [], totalInProgress: 0, totalUpdated: 0 };

		const userId = identity.subject as GenericId<'users'>;
		const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 5)), 12);
		const continueLimit = Math.min(Math.max(1, Math.floor(args.limit ?? 5)), 12);

		const recentTitles = await ctx.db
			.query('libraryTitles')
			.withIndex('by_owner_user_id_last_read_at', (q) =>
				q.eq('ownerUserId', userId).gt('lastReadAt', 0)
			)
			.order('desc')
			.collect();
		const downloadProfiles = await ctx.db
			.query('downloadProfiles')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
			.collect();
		const monitoredTitleIds = new Set(
			downloadProfiles
				.filter((profile) => profile.enabled && !profile.paused)
				.map((profile) => String(profile.libraryTitleId))
		);

		const inProgress = recentTitles.filter((title) => title.listedInLibrary !== false);
		const totalInProgress = inProgress.length;
		const candidates = inProgress.slice(0, Math.max(limit * 12, 48));

		if (candidates.length === 0) return { items: [], totalInProgress, totalUpdated: 0 };

		const titleRouteSegments = buildTitleRouteSegments(candidates);
		const enriched = await Promise.all(
			candidates.map((title) => buildContinueReadingEntry(ctx, userId, title, titleRouteSegments))
		);
		const continueReadingTitleIds = new Set(
			enriched
				.filter(
					(entry): entry is NonNullable<typeof entry> => entry !== null && entry.chapter !== null
				)
				.sort((left, right) => right.lastReadAt - left.lastReadAt)
				.slice(0, continueLimit)
				.map((entry) => String(entry.titleId))
		);

		const updatedItems = enriched
			.filter(
				(entry): entry is NonNullable<typeof entry> =>
					entry !== null &&
					entry.chapter !== null &&
					entry.hasUnreadUpdateSinceLastRead &&
					entry.latestUnreadPublishedAt > 0 &&
					monitoredTitleIds.has(String(entry.titleId)) &&
					!continueReadingTitleIds.has(String(entry.titleId))
			)
			.sort((left, right) => right.latestUnreadPublishedAt - left.latestUnreadPublishedAt);

		return {
			items: updatedItems.slice(0, limit),
			totalInProgress,
			totalUpdated: updatedItems.length
		};
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
