import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireBridgeIdentity } from './bridge_auth';

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

export const listSources = query({
	args: {},
	handler: async (ctx) => {
		const extensions = await ctx.db.query('installedExtensions').collect();
		return extensions
			.flatMap((extension) =>
				(extension.sources ?? extension.sourceIds.map((id) => ({
					id,
					name: id,
					lang: extension.lang,
					supportsLatest: false
				}))).map((source) => ({
					...source,
					extensionPkg: extension.pkg,
					extensionName: extension.name,
					extensionVersion: extension.version
				}))
			)
			.sort((left, right) => {
				if (left.extensionName !== right.extensionName) {
					return left.extensionName.localeCompare(right.extensionName);
				}
				return left.name.localeCompare(right.name);
			});
	}
});

export const setRepository = mutation({
	args: {
		url: v.string(),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
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
		sourceIds: v.array(v.string()),
		sources: v.array(
			v.object({
				id: v.string(),
				name: v.string(),
				lang: v.string(),
				supportsLatest: v.boolean()
			})
		),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const existing = await ctx.db
			.query('installedExtensions')
			.withIndex('by_pkg', (q) => q.eq('pkg', args.pkg))
			.unique();

		if (existing) {
			await ctx.db.patch(existing._id, {
				name: args.name,
				lang: args.lang,
				version: args.version,
				sourceIds: args.sourceIds,
				sources: args.sources,
				status: 'installed',
				updatedAt: args.now
			});
		} else {
			await ctx.db.insert('installedExtensions', {
				pkg: args.pkg,
				name: args.name,
				lang: args.lang,
				version: args.version,
				sourceIds: args.sourceIds,
				sources: args.sources,
				status: 'installed',
				installedAt: args.now,
				updatedAt: args.now
			});
		}

		return { ok: true };
	}
});

export const removeInstalled = mutation({
	args: {
		pkg: v.string()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const existing = await ctx.db
			.query('installedExtensions')
			.withIndex('by_pkg', (q) => q.eq('pkg', args.pkg))
			.unique();

		if (existing) {
			await ctx.db.delete(existing._id);
		}

		return { ok: true };
	}
});
