import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { mutation, type MutationCtx } from './_generated/server';
import { buildTitleRouteBase } from '../lib/utils/route-segments';
import { requireBridgeIdentity } from './bridge_auth';
import {
	applyVariantSnapshotToTitle,
	DOWNLOAD_STATUS,
	findVariantForTitle,
	getPreferredVariantForTitle,
	requireOwnedTitle
} from './library_shared';
import { pickBestMergeCandidate } from './title_identity';

export {
	createChapterComment,
	deleteChapterComment,
	findMineBySource,
	getMineById,
	getMineImportedSourceLookup,
	getMineOverviewById,
	getMineOverviewByRouteSegment,
	getMineVisibilitySummary,
	listHiddenMine,
	getMineChapterById,
	getReaderByChapterId,
	getReaderByRouteSegments,
	listTitleComments,
	listAllMineChapters,
	listChapterComments,
	listMine,
	listTitleChapters,
	markChaptersReadThrough,
	resetChapterProgress,
	resetTitleProgress,
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
	setTitleListedInLibrary,
	listUserStatuses,
	mergeTitles,
	updateCollection,
	updateTitlePreferences,
	updateUserStatus
} from './library_organization';
export { linkVariant, normalizeTitleVariants, removeVariant } from './library_title_variants';
export {
	cancelQueuedChapterDownload,
	getDownloadDashboard,
	recoverActiveDownloads,
	requestChapterDownload,
	requestMissingDownloads,
	runDownloadCycle,
	setChapterDownloadState,
	updateDownloadProfile
} from './library_downloads';
export {
	ensureTitleReady,
	beginTitleOpen,
	ensureTitleCoverCache,
	ensureTitleMetadata,
	ensureTitlesOfflineReady,
	ensureTitlesCoverCache,
	ensureTitlesMetadata,
	getExploreTitlePreview,
	upsertTitleMetadataFromBridge
} from './library_metadata';

export const importForUser = mutation({
	args: {
		userId: v.id('users'),
		canonicalKey: v.string(),
		sourceId: v.string(),
		sourcePkg: v.string(),
		sourceLang: v.string(),
		titleUrl: v.string(),
		author: v.optional(v.union(v.string(), v.null())),
		artist: v.optional(v.union(v.string(), v.null())),
		title: v.string(),
		description: v.optional(v.union(v.string(), v.null())),
		coverUrl: v.optional(v.union(v.string(), v.null())),
		genre: v.optional(v.union(v.string(), v.null())),
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
			author: args.author ?? undefined,
			artist: args.artist ?? undefined,
			title: args.title,
			description: args.description ?? undefined,
			coverUrl: args.coverUrl ?? undefined,
			genre: args.genre ?? undefined,
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
		let chapterRowsChanged = false;

		for (const [index, chapter] of args.chapters.entries()) {
			seenChapterUrls.add(chapter.url);
			const current = byUrl.get(chapter.url);
			if (current) {
				const needsPatch =
					current.titleVariantId !== variant._id ||
					current.sourceId !== variant.sourceId ||
					current.sourcePkg !== variant.sourcePkg ||
					current.sourceLang !== variant.sourceLang ||
					current.titleUrl !== variant.titleUrl ||
					current.chapterName !== chapter.name ||
					current.chapterNumber !== chapter.chapterNumber ||
					current.scanlator !== chapter.scanlator ||
					current.dateUpload !== chapter.dateUpload ||
					current.sequence !== index;
				if (needsPatch) {
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
					chapterRowsChanged = true;
				}
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
			chapterRowsChanged = true;
		}

		const staleChapters = existing.filter(
			(chapter) =>
				chapter.titleVariantId === variant._id && !seenChapterUrls.has(chapter.chapterUrl)
		);

		if (staleChapters.length > 0) {
			const staleChapterIds = new Set(staleChapters.map((c) => String(c._id)));
			// Batch-load all progress and comment rows for the title, then filter to
			// only the stale chapters — 2 queries instead of 2 × staleChapters.length.
			const [allProgressRows, allCommentRows] = await Promise.all([
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
					.collect()
			]);
			for (const progress of allProgressRows) {
				if (staleChapterIds.has(String(progress.chapterId))) {
					await ctx.db.delete(progress._id);
				}
			}
			for (const comment of allCommentRows) {
				if (staleChapterIds.has(String(comment.chapterId))) {
					await ctx.db.delete(comment._id);
				}
			}
			for (const staleChapter of staleChapters) {
				await ctx.db.delete(staleChapter._id);
			}
			chapterRowsChanged = true;
		}

		if (chapterRowsChanged) {
			await ctx.db.patch(title._id, {
				updatedAt: args.now
			});
		}

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
	const attachVariantToTitle = async (existing: {
		_id: GenericId<'libraryTitles'>;
		preferredVariantId?: GenericId<'titleVariants'>;
	}) => {
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
	};

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
		return attachVariantToTitle(existing);
	}

	const [candidateTitles, candidateVariants] = await Promise.all([
		ctx.db
			.query('libraryTitles')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', args.userId))
			.collect(),
		ctx.db
			.query('titleVariants')
			.withIndex('by_owner_user_id_library_title_id', (q) => q.eq('ownerUserId', args.userId))
			.collect()
	]);

	const variantsByTitleId = new Map<string, typeof candidateVariants>();
	for (const variant of candidateVariants) {
		const key = String(variant.libraryTitleId);
		const existingEntries = variantsByTitleId.get(key);
		if (existingEntries) {
			existingEntries.push(variant);
		} else {
			variantsByTitleId.set(key, [variant]);
		}
	}

	const inferredTarget = pickBestMergeCandidate(
		{
			title: args.title,
			author: args.author,
			artist: args.artist,
			sourcePkg: args.sourcePkg,
			sourceLang: args.sourceLang,
			titleUrl: args.titleUrl
		},
		candidateTitles.map((candidate) => ({
			item: candidate,
			snapshots: [
				{
					title: candidate.title,
					author: candidate.author,
					artist: candidate.artist,
					sourcePkg: candidate.sourcePkg,
					sourceLang: candidate.sourceLang,
					titleUrl: candidate.titleUrl
				},
				...(variantsByTitleId.get(String(candidate._id)) ?? []).map((variant) => ({
					title: variant.title,
					author: variant.author,
					artist: variant.artist,
					sourcePkg: variant.sourcePkg,
					sourceLang: variant.sourceLang,
					titleUrl: variant.titleUrl
				}))
			]
		}))
	);

	if (inferredTarget) {
		return attachVariantToTitle(inferredTarget.item);
	}

	const titleId = await ctx.db.insert('libraryTitles', {
		ownerUserId: args.userId,
		canonicalKey: args.canonicalKey,
		title: args.title,
		routeBase: buildTitleRouteBase(args.title),
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
		listedInLibrary: false,
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
