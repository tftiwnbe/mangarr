import { v } from 'convex/values';

import { mutation, query } from './_generated/server';

export const getContentLanguages = query({
	args: {},
	handler: async (ctx) => {
		const installation = await ctx.db
			.query('installation')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique();

		return {
			preferred: installation?.preferredContentLanguages ?? []
		};
	}
});

export const setContentLanguages = mutation({
	args: {
		preferred: v.array(v.string()),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		const installation = await ctx.db
			.query('installation')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique();

		if (installation) {
			await ctx.db.patch(installation._id, {
				preferredContentLanguages: args.preferred,
				updatedAt: args.now
			});
		} else {
			await ctx.db.insert('installation', {
				key: 'main',
				setupState: 'open',
				schemaVersion: '1',
				preferredContentLanguages: args.preferred,
				createdAt: args.now,
				updatedAt: args.now
			});
		}

		return {
			preferred: args.preferred
		};
	}
});
