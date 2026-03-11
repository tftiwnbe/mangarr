import { v } from 'convex/values';

import { query } from './_generated/server';

export const search = query({
	args: {
		query: v.string(),
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 30), 100));
		const needle = args.query.trim().toLowerCase();
		const rows = await ctx.db.query('exploreCatalog').collect();
		const filtered = rows
			.filter((row) => {
				if (!needle) return true;
				return (
					row.title.toLowerCase().includes(needle) ||
					row.description.toLowerCase().includes(needle) ||
					row.extensionPkg.toLowerCase().includes(needle)
				);
			})
			.sort((left, right) => left.title.localeCompare(right.title))
			.slice(0, limit);

		return filtered.map((row) => ({
			canonicalKey: row.canonicalKey,
			title: row.title,
			description: row.description,
			lang: row.lang,
			extensionPkg: row.extensionPkg,
			coverRef: row.coverRef ?? null
		}));
	}
});

export const getTitle = query({
	args: {
		canonicalKey: v.string()
	},
	handler: async (ctx, args) => {
		const row = await ctx.db
			.query('exploreCatalog')
			.withIndex('by_canonical_key', (q) => q.eq('canonicalKey', args.canonicalKey))
			.unique();

		if (!row) {
			return null;
		}

		return {
			canonicalKey: row.canonicalKey,
			title: row.title,
			description: row.description,
			lang: row.lang,
			extensionPkg: row.extensionPkg,
			coverRef: row.coverRef ?? null
		};
	}
});
