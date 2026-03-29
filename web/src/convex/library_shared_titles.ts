import type { GenericId } from 'convex/values';

import type { MutationCtx, QueryCtx } from './_generated/server';
import { loadInstalledSourceCatalog, variantInstalledSourceRecord } from './library_shared_sources';
import { pickNumber, pickString } from './library_shared_values';

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
