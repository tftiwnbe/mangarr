import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { mutation, query, type MutationCtx } from './_generated/server';

export const listMine = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}
		const userId = identity.subject as GenericId<'users'>;
		const titles = await ctx.db
			.query('libraryTitles')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
			.collect();
		return titles.sort((left, right) => right.updatedAt - left.updatedAt);
	}
});

export const importFromCatalog = mutation({
	args: {
		canonicalKey: v.string(),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error('Not authenticated');
		}
		const userId = identity.subject as GenericId<'users'>;
		return importForUserCore(ctx, {
			userId,
			canonicalKey: args.canonicalKey,
			now: args.now
		});
	}
});

export const importForUser = mutation({
	args: {
		userId: v.id('users'),
		canonicalKey: v.string(),
		now: v.float64()
	},
	handler: async (ctx, args) =>
		importForUserCore(ctx, {
			userId: args.userId,
			canonicalKey: args.canonicalKey,
			now: args.now
		})
});

async function importForUserCore(
	ctx: MutationCtx,
	args: { userId: GenericId<'users'>; canonicalKey: string; now: number }
) {
	const catalogEntry = await ctx.db
		.query('exploreCatalog')
		.withIndex('by_canonical_key', (q) => q.eq('canonicalKey', args.canonicalKey))
		.unique();

	if (!catalogEntry) {
		throw new Error('Title not found in explore catalog');
	}

	const existing = await ctx.db
		.query('libraryTitles')
		.withIndex('by_owner_user_id_canonical_key', (q) =>
			q.eq('ownerUserId', args.userId).eq('canonicalKey', args.canonicalKey)
		)
		.unique();

	if (existing) {
		await ctx.db.patch(existing._id, { updatedAt: args.now });
		return { created: false, titleId: existing._id };
	}

	const titleId = await ctx.db.insert('libraryTitles', {
		ownerUserId: args.userId,
		canonicalKey: catalogEntry.canonicalKey,
		title: catalogEntry.title,
		sourcePkg: catalogEntry.extensionPkg,
		sourceLang: catalogEntry.lang,
		coverRef: catalogEntry.coverRef,
		createdAt: args.now,
		updatedAt: args.now
	});

	return { created: true, titleId };
}
