import type { GenericId } from 'convex/values';

import type { MutationCtx, QueryCtx } from './_generated/server';

export const DOWNLOAD_STATUS = {
	MISSING: 'missing',
	QUEUED: 'queued',
	DOWNLOADING: 'downloading',
	DOWNLOADED: 'downloaded',
	FAILED: 'failed'
} as const;

export const DEFAULT_USER_STATUSES = [
	{ key: 'reading', label: 'Reading' },
	{ key: 'completed', label: 'Completed' },
	{ key: 'on_hold', label: 'On Hold' },
	{ key: 'dropped', label: 'Dropped' },
	{ key: 'plan_to_read', label: 'Plan to Read' }
] as const;

export const DEFAULT_COLLECTIONS = [{ name: 'Favorites' }, { name: 'Queue' }, { name: 'Archive' }] as const;

export async function requireOwnedTitle(
	ctx: QueryCtx | MutationCtx,
	titleId: GenericId<'libraryTitles'>
) {
	const identity = await requireViewerIdentity(ctx);
	const title = await ctx.db.get(titleId);
	if (!title || title.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Library title not found');
	}

	return title;
}

export async function requireOwnedChapter(
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

export async function getOwnedChapterProgressRow(
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

export async function requireOwnedChapterComment(
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

export async function requireOwnedUserStatus(
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

export async function requireOwnedCollection(
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

export async function requireOwnedVariant(
	ctx: QueryCtx | MutationCtx,
	variantId: GenericId<'titleVariants'>
) {
	const identity = await requireViewerIdentity(ctx);
	const variant = await ctx.db.get(variantId);
	if (!variant || variant.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Library variant not found');
	}
	return variant;
}

type InstalledSourceCatalogItem = {
	id: string;
	pkg: string;
	lang: string;
	name: string;
	enabled: boolean;
};

export async function loadInstalledSourceCatalog(ctx: QueryCtx | MutationCtx) {
	const extensions = await ctx.db.query('installedExtensions').collect();
	const byId = new Map<string, InstalledSourceCatalogItem>();
	const byPkg = new Map<string, InstalledSourceCatalogItem[]>();

	for (const extension of extensions) {
		const sources =
			extension.sources ??
			extension.sourceIds.map((id) => ({
				id,
				name: id,
				lang: extension.lang,
				supportsLatest: false,
				enabled: true
			}));
		for (const source of sources) {
			const item: InstalledSourceCatalogItem = {
				id: source.id,
				pkg: extension.pkg,
				lang: source.lang,
				name: source.name,
				enabled: source.enabled !== false
			};
			byId.set(item.id, item);
			const pkgItems = byPkg.get(item.pkg) ?? [];
			pkgItems.push(item);
			byPkg.set(item.pkg, pkgItems);
		}
	}

	return { byId, byPkg };
}

export function variantInstalledSourceRecord(
	catalog: { byId: Map<string, InstalledSourceCatalogItem> },
	variant: { sourceId: string; sourcePkg: string }
) {
	const installed = catalog.byId.get(variant.sourceId);
	return installed && installed.pkg === variant.sourcePkg ? installed : null;
}

export function pickVariantNormalizationAssignments(
	variants: Array<{
		_id: GenericId<'titleVariants'>;
		sourceId: string;
		sourcePkg: string;
		sourceLang: string;
		titleUrl: string;
	}>,
	catalog: {
		byId: Map<string, InstalledSourceCatalogItem>;
		byPkg: Map<string, InstalledSourceCatalogItem[]>;
	}
) {
	const assignments = new Map<
		string,
		{
			sourceId: string;
			sourceLang: string;
			sourceName: string;
		}
	>();

	const variantsByPkg = new Map<string, typeof variants>();
	for (const variant of variants) {
		const pkgVariants = variantsByPkg.get(variant.sourcePkg) ?? [];
		pkgVariants.push(variant);
		variantsByPkg.set(variant.sourcePkg, pkgVariants);
	}

	for (const [sourcePkg, pkgVariants] of variantsByPkg.entries()) {
		const installedSources = catalog.byPkg.get(sourcePkg) ?? [];
		const activeSourceIds = new Set(
			pkgVariants
				.filter((variant) => variantInstalledSourceRecord(catalog, variant) !== null)
				.map((variant) => variant.sourceId)
		);
		const staleVariants = pkgVariants.filter(
			(variant) => variantInstalledSourceRecord(catalog, variant) === null
		);
		if (staleVariants.length === 0) continue;

		const remainingSources = installedSources.filter((source) => !activeSourceIds.has(source.id));
		const consumedSourceIds = new Set<string>();

		for (const variant of staleVariants) {
			const langMatches = remainingSources.filter(
				(source) => !consumedSourceIds.has(source.id) && source.lang === variant.sourceLang
			);
			if (langMatches.length === 1) {
				const matched = langMatches[0];
				assignments.set(String(variant._id), {
					sourceId: matched.id,
					sourceLang: matched.lang,
					sourceName: matched.name
				});
				consumedSourceIds.add(matched.id);
			}
		}

		const unresolved = staleVariants.filter((variant) => !assignments.has(String(variant._id)));
		const unresolvedRemainingSources = remainingSources.filter(
			(source) => !consumedSourceIds.has(source.id)
		);
		if (unresolved.length === 1 && unresolvedRemainingSources.length === 1) {
			const matched = unresolvedRemainingSources[0];
			assignments.set(String(unresolved[0]._id), {
				sourceId: matched.id,
				sourceLang: matched.lang,
				sourceName: matched.name
			});
		}
	}

	return assignments;
}

export async function getPreferredVariantForTitle(
	ctx: QueryCtx | MutationCtx,
	title: {
		_id: GenericId<'libraryTitles'>;
		ownerUserId: GenericId<'users'>;
		preferredVariantId?: GenericId<'titleVariants'>;
	}
) {
	if (title.preferredVariantId) {
		const preferred = await ctx.db.get(title.preferredVariantId);
		if (
			preferred &&
			preferred.ownerUserId === title.ownerUserId &&
			preferred.libraryTitleId === title._id
		) {
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

export async function findVariantForTitle(
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

export async function listVariantsForTitle(
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
	const [variants, installedSourceCatalog] = await Promise.all([
		ctx.db
			.query('titleVariants')
			.withIndex('by_owner_user_id_library_title_id', (q) =>
				q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
			)
			.collect(),
		loadInstalledSourceCatalog(ctx)
	]);

	return variants
		.map((variant) => ({
			...variant,
			installedSource: variantInstalledSourceRecord(installedSourceCatalog, variant)
		}))
		.map((variant) => ({
			id: variant._id,
			sourceId: variant.sourceId,
			sourcePkg: variant.sourcePkg,
			sourceLang: variant.sourceLang,
			sourceName: variant.installedSource?.name ?? null,
			titleUrl: variant.titleUrl,
			title: variant.title,
			author: variant.author ?? null,
			artist: variant.artist ?? null,
			description: variant.description ?? null,
			coverUrl: variant.coverUrl ?? null,
			genre: variant.genre ?? null,
			status: variant.status ?? null,
			isInstalled: variant.installedSource !== null,
			isEnabled: variant.installedSource?.enabled ?? false,
			isStale: variant.installedSource === null,
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

export async function resolveOwnedTitleUserStatus(
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

export async function listCollectionsForTitle(
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

export async function loadOwnerUserStatusMap(
	ctx: QueryCtx | MutationCtx,
	ownerUserId: GenericId<'users'>
) {
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

export async function loadOwnerCollectionMap(
	ctx: QueryCtx | MutationCtx,
	ownerUserId: GenericId<'users'>
) {
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

export async function loadOwnerCollectionIdsByTitleId(
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

export async function loadOwnerChaptersByTitleId(
	ctx: QueryCtx | MutationCtx,
	ownerUserId: GenericId<'users'>
) {
	const chapters = await ctx.db
		.query('libraryChapters')
		.withIndex('by_owner_user_id_library_title_id', (q) => q.eq('ownerUserId', ownerUserId))
		.collect();

	const byTitleId = new Map<string, (typeof chapters)[number][]>();
	for (const chapter of chapters) {
		const key = String(chapter.libraryTitleId);
		const next = byTitleId.get(key) ?? [];
		next.push(chapter);
		byTitleId.set(key, next);
	}

	return { chapters, byTitleId };
}

export async function loadOwnerVariantCountsByTitleId(
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

export async function countTitlesInCollection(
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

export async function setTitlePreferredVariant(
	ctx: MutationCtx,
	titleId: GenericId<'libraryTitles'>,
	preferredVariantId: GenericId<'titleVariants'> | undefined,
	now: number
) {
	const title = await ctx.db.get(titleId);
	if (!title) {
		throw new Error('Library title not found');
	}

	const variants = await ctx.db
		.query('titleVariants')
		.withIndex('by_owner_user_id_library_title_id', (q) =>
			q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
		)
		.collect();

	let preferredVariant =
		preferredVariantId !== undefined
			? (variants.find((variant) => variant._id === preferredVariantId) ?? null)
			: null;

	if (!preferredVariant && variants.length > 0) {
		preferredVariant =
			[...variants].sort((left, right) => left.createdAt - right.createdAt)[0] ?? null;
	}

	for (const variant of variants) {
		const nextPreferred = preferredVariant ? variant._id === preferredVariant._id : false;
		if (variant.isPreferred !== nextPreferred) {
			await ctx.db.patch(variant._id, {
				isPreferred: nextPreferred,
				updatedAt: now
			});
		}
	}

	if (preferredVariant) {
		await applyVariantSnapshotToTitle(ctx, title._id, {
			sourceId: preferredVariant.sourceId,
			sourcePkg: preferredVariant.sourcePkg,
			sourceLang: preferredVariant.sourceLang,
			titleUrl: preferredVariant.titleUrl,
			title: pickString(title.title, preferredVariant.title) ?? preferredVariant.title,
			author: pickString(title.author, preferredVariant.author),
			artist: pickString(title.artist, preferredVariant.artist),
			description: pickString(title.description, preferredVariant.description),
			coverUrl: pickString(title.coverUrl, preferredVariant.coverUrl),
			genre: pickString(title.genre, preferredVariant.genre),
			status: pickNumber(title.status, preferredVariant.status),
			preferredVariantId: preferredVariant._id,
			now
		});
		return preferredVariant._id;
	}

	await ctx.db.patch(title._id, {
		preferredVariantId: undefined,
		updatedAt: now
	});
	return undefined;
}

export async function markTitleListedInLibrary(
	ctx: MutationCtx,
	title: {
		_id: GenericId<'libraryTitles'>;
		listedInLibrary?: boolean;
		updatedAt: number;
	},
	now: number
) {
	if (title.listedInLibrary === true) {
		return false;
	}

	await ctx.db.patch(title._id, {
		listedInLibrary: true,
		updatedAt: Math.max(now, title.updatedAt)
	});
	return true;
}

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

export async function applyVariantSnapshotToTitle(
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

export async function requireViewerIdentity(ctx: QueryCtx | MutationCtx) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new Error('Not authenticated');
	}
	return identity;
}

export async function requireViewerUserId(ctx: QueryCtx | MutationCtx) {
	const identity = await requireViewerIdentity(ctx);
	return identity.subject as GenericId<'users'>;
}

export function downloadChapterPercent(row: {
	downloadStatus: (typeof DOWNLOAD_STATUS)[keyof typeof DOWNLOAD_STATUS];
	downloadedPages: number;
	totalPages?: number;
}) {
	if (row.downloadStatus === DOWNLOAD_STATUS.DOWNLOADED) return 100;
	const downloadedPages = Number(row.downloadedPages ?? NaN);
	const totalPages = Number(row.totalPages ?? NaN);
	if (Number.isFinite(downloadedPages) && Number.isFinite(totalPages) && totalPages > 0) {
		return Math.max(0, Math.min(100, Math.round((downloadedPages / totalPages) * 100)));
	}

	return 0;
}

export function cleanExtensionLabel(name: string) {
	return name.replace(/^tachiyomi:\s*/i, '').trim();
}

export function humanizeSourcePkg(sourcePkg: string) {
	const segment = sourcePkg.split('.').filter(Boolean).at(-1) ?? sourcePkg;
	if (segment.toLowerCase() === 'mangadex') return 'MangaDex';
	return segment
		.replace(/[-_]+/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/\b\w/g, (value) => value.toUpperCase());
}

export function slugifyStatusKey(label: string, existingKeys: string[]) {
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

export function variantIdentityKey(sourceId: string, titleUrl: string) {
	return `${sourceId}::${titleUrl}`;
}

export function pickString(...values: Array<string | undefined | null>) {
	for (const value of values) {
		const normalized = value?.trim();
		if (normalized) {
			return normalized;
		}
	}
	return undefined;
}

export function pickNumber(...values: Array<number | undefined | null>) {
	for (const value of values) {
		if (value !== undefined && value !== null && Number.isFinite(value)) {
			return value;
		}
	}
	return undefined;
}

export function maxNumber(...values: Array<number | undefined | null>) {
	const finite = values.filter(
		(value): value is number => value !== undefined && value !== null && Number.isFinite(value)
	);
	if (finite.length === 0) {
		return undefined;
	}
	return Math.max(...finite);
}

export function preferredDownloadStatus(
	left: (typeof DOWNLOAD_STATUS)[keyof typeof DOWNLOAD_STATUS],
	right: (typeof DOWNLOAD_STATUS)[keyof typeof DOWNLOAD_STATUS]
) {
	const rank: Record<(typeof DOWNLOAD_STATUS)[keyof typeof DOWNLOAD_STATUS], number> = {
		[DOWNLOAD_STATUS.MISSING]: 0,
		[DOWNLOAD_STATUS.FAILED]: 1,
		[DOWNLOAD_STATUS.QUEUED]: 2,
		[DOWNLOAD_STATUS.DOWNLOADING]: 3,
		[DOWNLOAD_STATUS.DOWNLOADED]: 4
	};
	return rank[right] > rank[left] ? right : left;
}
