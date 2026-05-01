import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireViewerUserId } from './library_shared';

const ALLOWED_THEMES = new Set(['dark', 'light', 'system']);

function normalizeTheme(value: string | null | undefined): string | undefined {
	if (typeof value !== 'string') return undefined;
	return ALLOWED_THEMES.has(value) ? value : undefined;
}

function normalizeLocale(value: string | null | undefined): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	// Conservative: 2–10 chars, letters/digits/dash. Bigger validation lives
	// on the client side where supported locales are known.
	if (!/^[a-zA-Z0-9-]{2,10}$/.test(trimmed)) return undefined;
	return trimmed;
}

export const getMine = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return { theme: null, locale: null, pwaResumeEnabled: null };
		}
		const userId = identity.subject;
		const row = await ctx.db
			.query('userPreferences')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId as never))
			.unique();
		return {
			theme: row?.theme ?? null,
			locale: row?.locale ?? null,
			pwaResumeEnabled: row?.pwaResumeEnabled ?? null
		};
	}
});

export const updateMine = mutation({
	args: {
		theme: v.optional(v.union(v.string(), v.null())),
		locale: v.optional(v.union(v.string(), v.null())),
		pwaResumeEnabled: v.optional(v.union(v.boolean(), v.null()))
	},
	handler: async (ctx, args) => {
		const userId = await requireViewerUserId(ctx);
		const existing = await ctx.db
			.query('userPreferences')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
			.unique();

		const now = Date.now();
		const patch: {
			theme?: string | undefined;
			locale?: string | undefined;
			pwaResumeEnabled?: boolean | undefined;
			updatedAt: number;
		} = { updatedAt: now };

		if (args.theme !== undefined) {
			patch.theme = args.theme === null ? undefined : normalizeTheme(args.theme);
		}
		if (args.locale !== undefined) {
			patch.locale = args.locale === null ? undefined : normalizeLocale(args.locale);
		}
		if (args.pwaResumeEnabled !== undefined) {
			patch.pwaResumeEnabled = args.pwaResumeEnabled === null ? undefined : args.pwaResumeEnabled;
		}

		if (existing) {
			await ctx.db.patch(existing._id, patch);
		} else {
			await ctx.db.insert('userPreferences', {
				ownerUserId: userId,
				theme: patch.theme,
				locale: patch.locale,
				pwaResumeEnabled: patch.pwaResumeEnabled,
				createdAt: now,
				updatedAt: now
			});
		}

		const after = await ctx.db
			.query('userPreferences')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', userId))
			.unique();
		return {
			theme: after?.theme ?? null,
			locale: after?.locale ?? null,
			pwaResumeEnabled: after?.pwaResumeEnabled ?? null
		};
	}
});
