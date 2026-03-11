import { v } from 'convex/values';

import { mutation, query } from './_generated/server';

function seededTitles(pkg: string, lang: string) {
	const stem = pkg
		.split('.')
		.slice(-1)[0]
		.replace(/[^a-z0-9]+/gi, ' ')
		.trim();
	const label = stem.length > 0 ? stem : 'source';
	const titles = [
		`${label} Chronicles`,
		`${label} Odyssey`,
		`${label} Academy`,
		`${label} Archive`,
		`${label} Runner`
	];
	return titles.map((title, index) => ({
		canonicalKey: `${pkg}::${index + 1}`,
		title,
		description: `Imported from ${pkg}`,
		lang
	}));
}

export const getRepository = query({
	args: {},
	handler: async (ctx) => {
		const installation = await ctx.db
			.query('installation')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique();
		return {
			url: installation?.extensionRepoUrl ?? '',
			configured: Boolean(installation?.extensionRepoUrl)
		};
	}
});

export const listInstalled = query({
	args: {},
	handler: async (ctx) => {
		const extensions = await ctx.db.query('installedExtensions').collect();
		return extensions.sort((left, right) => right.updatedAt - left.updatedAt);
	}
});

export const setRepository = mutation({
	args: {
		url: v.string(),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		const installation = await ctx.db
			.query('installation')
			.withIndex('by_key', (q) => q.eq('key', 'main'))
			.unique();

		if (installation) {
			await ctx.db.patch(installation._id, {
				extensionRepoUrl: args.url,
				updatedAt: args.now
			});
			return { updated: true, created: false };
		}

		await ctx.db.insert('installation', {
			key: 'main',
			setupState: 'open',
			schemaVersion: '1',
			releaseChannel: 'v2.0.0-alpha',
			extensionRepoUrl: args.url,
			createdAt: args.now,
			updatedAt: args.now
		});
		return { updated: true, created: true };
	}
});

export const upsertInstalled = mutation({
	args: {
		pkg: v.string(),
		name: v.string(),
		lang: v.string(),
		version: v.string(),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('installedExtensions')
			.withIndex('by_pkg', (q) => q.eq('pkg', args.pkg))
			.unique();

		if (existing) {
			await ctx.db.patch(existing._id, {
				name: args.name,
				lang: args.lang,
				version: args.version,
				status: 'installed',
				updatedAt: args.now
			});
		} else {
			await ctx.db.insert('installedExtensions', {
				pkg: args.pkg,
				name: args.name,
				lang: args.lang,
				version: args.version,
				status: 'installed',
				installedAt: args.now,
				updatedAt: args.now
			});
		}

		const existingCatalog = await ctx.db
			.query('exploreCatalog')
			.withIndex('by_extension_pkg', (q) => q.eq('extensionPkg', args.pkg))
			.collect();
		if (existingCatalog.length === 0) {
			const titles = seededTitles(args.pkg, args.lang);
			for (const title of titles) {
				await ctx.db.insert('exploreCatalog', {
					extensionPkg: args.pkg,
					canonicalKey: title.canonicalKey,
					title: title.title,
					description: title.description,
					lang: title.lang,
					createdAt: args.now,
					updatedAt: args.now
				});
			}
		}

		return { ok: true };
	}
});
