import type { GenericId } from 'convex/values';

import type { MutationCtx } from './_generated/server';
import { DOWNLOAD_STATUS } from './library_shared_access';
import { setTitlePreferredVariant } from './library_shared_titles';
import { maxNumber, pickNumber, pickString, preferredDownloadStatus, variantIdentityKey } from './library_shared_values';

export async function mergeOwnedTitles(
	ctx: MutationCtx,
	targetTitle: {
		_id: GenericId<'libraryTitles'>;
		ownerUserId: GenericId<'users'>;
		preferredVariantId?: GenericId<'titleVariants'>;
		listedInLibrary?: boolean;
		userStatusId?: GenericId<'libraryUserStatuses'>;
		userRating?: number;
		localCoverPath?: string;
		lastReadAt?: number;
	},
	sourceTitle: {
		_id: GenericId<'libraryTitles'>;
		ownerUserId: GenericId<'users'>;
		preferredVariantId?: GenericId<'titleVariants'>;
		listedInLibrary?: boolean;
		userStatusId?: GenericId<'libraryUserStatuses'>;
		userRating?: number;
		localCoverPath?: string;
		lastReadAt?: number;
	},
	now: number
) {
	const [
		targetVariants,
		sourceVariants,
		targetCollections,
		sourceCollections,
		targetProfile,
		sourceProfile
	] = await Promise.all([
		ctx.db
			.query('titleVariants')
			.withIndex('by_owner_user_id_library_title_id', (q) =>
				q.eq('ownerUserId', targetTitle.ownerUserId).eq('libraryTitleId', targetTitle._id)
			)
			.collect(),
		ctx.db
			.query('titleVariants')
			.withIndex('by_owner_user_id_library_title_id', (q) =>
				q.eq('ownerUserId', sourceTitle.ownerUserId).eq('libraryTitleId', sourceTitle._id)
			)
			.collect(),
		ctx.db
			.query('libraryCollectionTitles')
			.withIndex('by_owner_user_id_library_title_id', (q) =>
				q.eq('ownerUserId', targetTitle.ownerUserId).eq('libraryTitleId', targetTitle._id)
			)
			.collect(),
		ctx.db
			.query('libraryCollectionTitles')
			.withIndex('by_owner_user_id_library_title_id', (q) =>
				q.eq('ownerUserId', sourceTitle.ownerUserId).eq('libraryTitleId', sourceTitle._id)
			)
			.collect(),
		ctx.db
			.query('downloadProfiles')
			.withIndex('by_owner_user_id_library_title_id', (q) =>
				q.eq('ownerUserId', targetTitle.ownerUserId).eq('libraryTitleId', targetTitle._id)
			)
			.unique(),
		ctx.db
			.query('downloadProfiles')
			.withIndex('by_owner_user_id_library_title_id', (q) =>
				q.eq('ownerUserId', sourceTitle.ownerUserId).eq('libraryTitleId', sourceTitle._id)
			)
			.unique()
	]);

	const targetVariantsByKey = new Map(
		targetVariants.map(
			(variant) => [variantIdentityKey(variant.sourceId, variant.titleUrl), variant] as const
		)
	);
	const variantIdRemap = new Map<string, GenericId<'titleVariants'>>();
	for (const sourceVariant of sourceVariants) {
		const identityKey = variantIdentityKey(sourceVariant.sourceId, sourceVariant.titleUrl);
		const existingTargetVariant = targetVariantsByKey.get(identityKey) ?? null;
		if (existingTargetVariant) {
			await ctx.db.patch(existingTargetVariant._id, {
				sourcePkg:
					pickString(existingTargetVariant.sourcePkg, sourceVariant.sourcePkg) ??
					existingTargetVariant.sourcePkg,
				sourceLang:
					pickString(existingTargetVariant.sourceLang, sourceVariant.sourceLang) ??
					existingTargetVariant.sourceLang,
				title:
					pickString(existingTargetVariant.title, sourceVariant.title) ??
					existingTargetVariant.title,
				author: pickString(existingTargetVariant.author, sourceVariant.author),
				artist: pickString(existingTargetVariant.artist, sourceVariant.artist),
				description: pickString(existingTargetVariant.description, sourceVariant.description),
				coverUrl: pickString(existingTargetVariant.coverUrl, sourceVariant.coverUrl),
				genre: pickString(existingTargetVariant.genre, sourceVariant.genre),
				status: pickNumber(existingTargetVariant.status, sourceVariant.status),
				lastSyncedAt: maxNumber(existingTargetVariant.lastSyncedAt, sourceVariant.lastSyncedAt),
				updatedAt: now
			});
			variantIdRemap.set(String(sourceVariant._id), existingTargetVariant._id);
			await ctx.db.delete(sourceVariant._id);
			continue;
		}

		await ctx.db.patch(sourceVariant._id, {
			libraryTitleId: targetTitle._id,
			isPreferred: false,
			updatedAt: now
		});
		variantIdRemap.set(String(sourceVariant._id), sourceVariant._id);
		targetVariantsByKey.set(identityKey, {
			...sourceVariant,
			libraryTitleId: targetTitle._id,
			isPreferred: false,
			updatedAt: now
		});
	}

	const targetCollectionIds = new Set(targetCollections.map((row) => String(row.collectionId)));
	for (const row of sourceCollections) {
		if (targetCollectionIds.has(String(row.collectionId))) {
			await ctx.db.delete(row._id);
			continue;
		}
		await ctx.db.patch(row._id, {
			libraryTitleId: targetTitle._id
		});
		targetCollectionIds.add(String(row.collectionId));
	}

	if (sourceProfile && targetProfile) {
		await ctx.db.patch(targetProfile._id, {
			enabled: targetProfile.enabled || sourceProfile.enabled,
			paused: targetProfile.paused && sourceProfile.paused,
			autoDownload: targetProfile.autoDownload || sourceProfile.autoDownload,
			lastCheckedAt: maxNumber(targetProfile.lastCheckedAt, sourceProfile.lastCheckedAt),
			lastSuccessAt: maxNumber(targetProfile.lastSuccessAt, sourceProfile.lastSuccessAt),
			lastError: pickString(targetProfile.lastError, sourceProfile.lastError),
			updatedAt: now
		});
		await ctx.db.delete(sourceProfile._id);
	} else if (sourceProfile) {
		await ctx.db.patch(sourceProfile._id, {
			libraryTitleId: targetTitle._id,
			updatedAt: now
		});
	}

	const sourceChapters = await ctx.db
		.query('libraryChapters')
		.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', sourceTitle._id))
		.collect();

	for (const sourceChapter of sourceChapters) {
		const mappedVariantId =
			(sourceChapter.titleVariantId
				? variantIdRemap.get(String(sourceChapter.titleVariantId))
				: targetVariantsByKey.get(
						variantIdentityKey(sourceChapter.sourceId, sourceChapter.titleUrl)
					)?._id) ?? undefined;
		const existingTargetChapter = await ctx.db
			.query('libraryChapters')
			.withIndex('by_library_title_id_chapter_url', (q) =>
				q.eq('libraryTitleId', targetTitle._id).eq('chapterUrl', sourceChapter.chapterUrl)
			)
			.unique();

		if (existingTargetChapter) {
			await ctx.db.patch(
				existingTargetChapter._id,
				buildMergedChapterPatch(existingTargetChapter, sourceChapter, mappedVariantId, now)
			);
			await moveChapterActivity(
				ctx,
				targetTitle.ownerUserId,
				sourceTitle._id,
				sourceChapter._id,
				targetTitle._id,
				existingTargetChapter._id,
				now
			);
			await ctx.db.delete(sourceChapter._id);
			continue;
		}

		await ctx.db.patch(sourceChapter._id, {
			libraryTitleId: targetTitle._id,
			titleVariantId: mappedVariantId,
			updatedAt: now
		});
		await moveChapterActivity(
			ctx,
			targetTitle.ownerUserId,
			sourceTitle._id,
			sourceChapter._id,
			targetTitle._id,
			sourceChapter._id,
			now
		);
	}

	await ctx.db.patch(targetTitle._id, {
		listedInLibrary:
			targetTitle.listedInLibrary === undefined && sourceTitle.listedInLibrary === undefined
				? undefined
				: (targetTitle.listedInLibrary ?? false) || (sourceTitle.listedInLibrary ?? false),
		userStatusId: targetTitle.userStatusId ?? sourceTitle.userStatusId,
		userRating: targetTitle.userRating ?? sourceTitle.userRating,
		localCoverPath: targetTitle.localCoverPath ?? sourceTitle.localCoverPath,
		lastReadAt: maxNumber(targetTitle.lastReadAt, sourceTitle.lastReadAt),
		updatedAt: now
	});

	const finalTargetTitle = await ctx.db.get(targetTitle._id);
	if (!finalTargetTitle) {
		throw new Error('Merged target title not found');
	}

	const preferredVariantId =
		(targetTitle.preferredVariantId &&
		(await ctx.db.get(targetTitle.preferredVariantId))?.libraryTitleId === targetTitle._id
			? targetTitle.preferredVariantId
			: undefined) ??
		(sourceTitle.preferredVariantId
			? variantIdRemap.get(String(sourceTitle.preferredVariantId))
			: undefined);

	await setTitlePreferredVariant(ctx, finalTargetTitle._id, preferredVariantId, now);
	await ctx.db.delete(sourceTitle._id);
}

export async function moveChapterActivity(
	ctx: MutationCtx,
	ownerUserId: GenericId<'users'>,
	sourceTitleId: GenericId<'libraryTitles'>,
	sourceChapterId: GenericId<'libraryChapters'>,
	targetTitleId: GenericId<'libraryTitles'>,
	targetChapterId: GenericId<'libraryChapters'>,
	now: number
) {
	void sourceTitleId;
	const progressRows = await ctx.db
		.query('chapterProgress')
		.withIndex('by_owner_user_id_chapter_id', (q) =>
			q.eq('ownerUserId', ownerUserId).eq('chapterId', sourceChapterId)
		)
		.collect();
	const existingTargetProgress = await ctx.db
		.query('chapterProgress')
		.withIndex('by_owner_user_id_chapter_id', (q) =>
			q.eq('ownerUserId', ownerUserId).eq('chapterId', targetChapterId)
		)
		.collect();
	const targetProgress = existingTargetProgress[0] ?? null;

	for (const row of progressRows) {
		if (targetProgress && targetChapterId !== sourceChapterId) {
			await ctx.db.patch(targetProgress._id, {
				libraryTitleId: targetTitleId,
				pageIndex: Math.max(targetProgress.pageIndex, row.pageIndex),
				updatedAt: Math.max(targetProgress.updatedAt, row.updatedAt, now)
			});
			await ctx.db.delete(row._id);
			continue;
		}

		await ctx.db.patch(row._id, {
			libraryTitleId: targetTitleId,
			chapterId: targetChapterId,
			updatedAt: Math.max(row.updatedAt, now)
		});
	}

	const commentRows = await ctx.db
		.query('chapterComments')
		.withIndex('by_owner_user_id_chapter_id_updated_at', (q) =>
			q.eq('ownerUserId', ownerUserId).eq('chapterId', sourceChapterId)
		)
		.collect();
	for (const row of commentRows) {
		await ctx.db.patch(row._id, {
			libraryTitleId: targetTitleId,
			chapterId: targetChapterId,
			updatedAt: Math.max(row.updatedAt, now)
		});
	}
}

export function buildMergedChapterPatch(
	targetChapter: {
		chapterName: string;
		chapterNumber?: number;
		scanlator?: string;
		dateUpload?: number;
		sequence: number;
		downloadStatus: (typeof DOWNLOAD_STATUS)[keyof typeof DOWNLOAD_STATUS];
		totalPages?: number;
		downloadedPages: number;
		localRelativePath?: string;
		storageKind?: 'directory' | 'archive';
		fileSizeBytes?: number;
		lastErrorMessage?: string;
		downloadedAt?: number;
		titleVariantId?: GenericId<'titleVariants'>;
	},
	sourceChapter: {
		chapterName: string;
		chapterNumber?: number;
		scanlator?: string;
		dateUpload?: number;
		sequence: number;
		downloadStatus: (typeof DOWNLOAD_STATUS)[keyof typeof DOWNLOAD_STATUS];
		totalPages?: number;
		downloadedPages: number;
		localRelativePath?: string;
		storageKind?: 'directory' | 'archive';
		fileSizeBytes?: number;
		lastErrorMessage?: string;
		downloadedAt?: number;
	},
	titleVariantId: GenericId<'titleVariants'> | undefined,
	now: number
) {
	const mergedStatus = preferredDownloadStatus(
		targetChapter.downloadStatus,
		sourceChapter.downloadStatus
	);
	return {
		chapterName:
			pickString(targetChapter.chapterName, sourceChapter.chapterName) ?? sourceChapter.chapterName,
		chapterNumber: pickNumber(targetChapter.chapterNumber, sourceChapter.chapterNumber),
		scanlator: pickString(targetChapter.scanlator, sourceChapter.scanlator),
		dateUpload: maxNumber(targetChapter.dateUpload, sourceChapter.dateUpload),
		sequence: Math.max(targetChapter.sequence, sourceChapter.sequence),
		downloadStatus: mergedStatus,
		totalPages: maxNumber(targetChapter.totalPages, sourceChapter.totalPages),
		downloadedPages: Math.max(targetChapter.downloadedPages, sourceChapter.downloadedPages),
		localRelativePath: pickString(targetChapter.localRelativePath, sourceChapter.localRelativePath),
		storageKind: targetChapter.storageKind ?? sourceChapter.storageKind,
		fileSizeBytes: maxNumber(targetChapter.fileSizeBytes, sourceChapter.fileSizeBytes),
		lastErrorMessage:
			mergedStatus === DOWNLOAD_STATUS.FAILED
				? pickString(targetChapter.lastErrorMessage, sourceChapter.lastErrorMessage)
				: undefined,
		downloadedAt: maxNumber(targetChapter.downloadedAt, sourceChapter.downloadedAt),
		titleVariantId,
		updatedAt: now
	};
}
