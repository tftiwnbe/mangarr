import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { mutation, query, type MutationCtx } from './_generated/server';
import { requireBridgeIdentity } from './bridge_auth';

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

export const importForUser = mutation({
	args: {
		userId: v.id('users'),
		canonicalKey: v.string(),
		sourceId: v.string(),
		sourcePkg: v.string(),
		sourceLang: v.string(),
		titleUrl: v.string(),
		title: v.string(),
		description: v.optional(v.string()),
		coverUrl: v.optional(v.string()),
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
			title: args.title,
			description: args.description,
			coverUrl: args.coverUrl,
			now: args.now
		});
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
		title: string;
		description?: string;
		coverUrl?: string;
		now: number;
	}
) {
	const existing = await ctx.db
		.query('libraryTitles')
		.withIndex('by_owner_user_id_canonical_key', (q) =>
			q.eq('ownerUserId', args.userId).eq('canonicalKey', args.canonicalKey)
		)
		.unique();

	if (existing) {
		await ctx.db.patch(existing._id, {
			title: args.title,
			sourcePkg: args.sourcePkg,
			sourceLang: args.sourceLang,
			sourceId: args.sourceId,
			titleUrl: args.titleUrl,
			description: args.description,
			coverUrl: args.coverUrl,
			updatedAt: args.now
		});
		return { created: false, titleId: existing._id };
	}

	const titleId = await ctx.db.insert('libraryTitles', {
		ownerUserId: args.userId,
		canonicalKey: args.canonicalKey,
		title: args.title,
		sourcePkg: args.sourcePkg,
		sourceLang: args.sourceLang,
		sourceId: args.sourceId,
		titleUrl: args.titleUrl,
		description: args.description,
		coverUrl: args.coverUrl,
		createdAt: args.now,
		updatedAt: args.now
	});

	return { created: true, titleId };
}
