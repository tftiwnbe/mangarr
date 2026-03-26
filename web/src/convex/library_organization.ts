import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import {
	countTitlesInCollection,
	DEFAULT_COLLECTIONS,
	DEFAULT_USER_STATUSES,
	loadOwnerUserStatusMap,
	loadOwnerVariantCountsByTitleId,
	mergeOwnedTitles,
	requireOwnedCollection,
	requireOwnedTitle,
	requireOwnedUserStatus,
	requireOwnedVariant,
	requireViewerUserId,
	setTitlePreferredVariant,
	slugifyStatusKey
} from './library_shared';

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
			key: slugifyStatusKey(
				args.label,
				rows.map((row) => row.key)
			),
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
		collectionIds: v.optional(v.array(v.id('libraryCollections'))),
		preferredVariantId: v.optional(v.union(v.id('titleVariants'), v.null()))
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const now = Date.now();
		let nextPreferredVariantId: GenericId<'titleVariants'> | undefined;
		let shouldUpdatePreferredVariant = false;
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
				patch.userRating = Math.max(0, Math.min(5, args.userRating));
			}
		}

		if (args.preferredVariantId !== undefined) {
			shouldUpdatePreferredVariant = true;
			if (args.preferredVariantId === null) {
				nextPreferredVariantId = undefined;
			} else {
				const preferredVariant = await requireOwnedVariant(ctx, args.preferredVariantId);
				if (preferredVariant.libraryTitleId !== title._id) {
					throw new Error('Preferred variant does not belong to this title');
				}
				nextPreferredVariantId = preferredVariant._id;
			}
		}

		if (Object.keys(patch).length > 0) {
			patch.updatedAt = now;
			await ctx.db.patch(title._id, patch);
		}

		if (args.collectionIds !== undefined) {
			const nextCollectionIds = [
				...new Set(args.collectionIds.map((collectionId) => String(collectionId)))
			];
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

		if (shouldUpdatePreferredVariant) {
			await setTitlePreferredVariant(ctx, title._id, nextPreferredVariantId, now);
		}

		return { ok: true };
	}
});

export const listMergeCandidates = query({
	args: {
		titleId: v.id('libraryTitles'),
		query: v.optional(v.string()),
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 12), 50));
		const search = args.query?.trim().toLowerCase() ?? '';
		const [titles, statusById, variantCountsByTitleId] = await Promise.all([
			ctx.db
				.query('libraryTitles')
				.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', title.ownerUserId))
				.collect(),
			loadOwnerUserStatusMap(ctx, title.ownerUserId),
			loadOwnerVariantCountsByTitleId(ctx, title.ownerUserId)
		]);

		return titles
			.filter((candidate) => candidate._id !== title._id)
			.filter((candidate) => {
				if (!search) return true;
				const haystack = [
					candidate.title,
					candidate.author ?? '',
					candidate.artist ?? '',
					candidate.sourceLang
				]
					.join(' ')
					.toLowerCase();
				return haystack.includes(search);
			})
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.slice(0, limit)
			.map((candidate) => ({
				id: candidate._id,
				title: candidate.title,
				author: candidate.author ?? null,
				artist: candidate.artist ?? null,
				sourceId: candidate.sourceId,
				sourcePkg: candidate.sourcePkg,
				sourceLang: candidate.sourceLang,
				titleUrl: candidate.titleUrl,
				variantsCount: variantCountsByTitleId.get(String(candidate._id)) ?? 0,
				userStatus: candidate.userStatusId
					? (statusById.get(String(candidate.userStatusId)) ?? null)
					: null,
				updatedAt: candidate.updatedAt
			}));
	}
});

export const mergeTitles = mutation({
	args: {
		targetTitleId: v.id('libraryTitles'),
		sourceTitleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		if (args.targetTitleId === args.sourceTitleId) {
			throw new Error('Cannot merge a title into itself');
		}

		const [targetTitle, sourceTitle] = await Promise.all([
			requireOwnedTitle(ctx, args.targetTitleId),
			requireOwnedTitle(ctx, args.sourceTitleId)
		]);
		const now = Date.now();
		await mergeOwnedTitles(ctx, targetTitle, sourceTitle, now);

		return {
			ok: true,
			titleId: targetTitle._id,
			mergedTitleId: sourceTitle._id
		};
	}
});
