import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireOwnedTitle, requireViewerUserId } from './library_shared';

const MAX_NOTES_LENGTH = 2000;

function normalizeRating(value: number | undefined): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Number.isFinite(value)) return undefined;
	const rounded = Math.round(value);
	if (rounded < 1) return undefined;
	if (rounded > 5) return 5;
	return rounded;
}

function normalizeNotes(value: string | undefined): string | undefined {
	if (value === undefined || value === null) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	return trimmed.slice(0, MAX_NOTES_LENGTH);
}

export const listForTitle = query({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		const title = await ctx.db.get(args.titleId);
		if (!title || String(title.ownerUserId) !== identity.subject) return [];

		const rows = await ctx.db
			.query('titleReadSessions')
			.withIndex('by_owner_user_id_library_title_id_started_at', (q) =>
				q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
			)
			.collect();

		return rows
			.sort((left, right) => {
				const leftActive = left.finishedAt === undefined ? 1 : 0;
				const rightActive = right.finishedAt === undefined ? 1 : 0;
				if (leftActive !== rightActive) return rightActive - leftActive;
				return right.startedAt - left.startedAt;
			})
			.map((row) => ({
				id: row._id,
				startedAt: row.startedAt,
				finishedAt: row.finishedAt ?? null,
				rating: row.rating ?? null,
				notes: row.notes ?? null,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt
			}));
	}
});

export const getActiveForTitle = query({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const title = await ctx.db.get(args.titleId);
		if (!title || String(title.ownerUserId) !== identity.subject) return null;

		const rows = await ctx.db
			.query('titleReadSessions')
			.withIndex('by_owner_user_id_library_title_id', (q) =>
				q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
			)
			.collect();

		const active = rows.find((row) => row.finishedAt === undefined);
		if (!active) return null;
		return {
			id: active._id,
			startedAt: active.startedAt,
			rating: active.rating ?? null,
			notes: active.notes ?? null
		};
	}
});

export async function ensureActiveReadSession(
	ctx: import('./_generated/server').MutationCtx,
	titleId: import('convex/values').GenericId<'libraryTitles'>,
	ownerUserId: import('convex/values').GenericId<'users'>,
	now: number
): Promise<void> {
	const existing = await ctx.db
		.query('titleReadSessions')
		.withIndex('by_owner_user_id_library_title_id', (q) =>
			q.eq('ownerUserId', ownerUserId).eq('libraryTitleId', titleId)
		)
		.collect();
	if (existing.some((row) => row.finishedAt === undefined)) return;
	await ctx.db.insert('titleReadSessions', {
		ownerUserId,
		libraryTitleId: titleId,
		startedAt: now,
		createdAt: now,
		updatedAt: now
	});
}

export const startReadSession = mutation({
	args: {
		titleId: v.id('libraryTitles'),
		startedAt: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const userId = await requireViewerUserId(ctx);
		const existingActive = await ctx.db
			.query('titleReadSessions')
			.withIndex('by_owner_user_id_library_title_id', (q) =>
				q.eq('ownerUserId', userId).eq('libraryTitleId', title._id)
			)
			.collect();
		const active = existingActive.find((row) => row.finishedAt === undefined);
		if (active) {
			return { ok: true, sessionId: active._id, alreadyActive: true };
		}

		const now = Date.now();
		const startedAt = args.startedAt && Number.isFinite(args.startedAt) ? args.startedAt : now;

		const sessionId = await ctx.db.insert('titleReadSessions', {
			ownerUserId: userId,
			libraryTitleId: title._id,
			startedAt,
			createdAt: now,
			updatedAt: now
		});
		return { ok: true, sessionId, alreadyActive: false };
	}
});

async function syncTitleRatingFromSession(
	ctx: import('./_generated/server').MutationCtx,
	titleId: import('convex/values').GenericId<'libraryTitles'>,
	rating: number | undefined
): Promise<void> {
	if (rating === undefined) return;
	const title = await ctx.db.get(titleId);
	if (!title) return;
	if (title.userRating === rating) return;
	await ctx.db.patch(titleId, { userRating: rating, updatedAt: Date.now() });
}

export const finishReadSession = mutation({
	args: {
		sessionId: v.id('titleReadSessions'),
		finishedAt: v.optional(v.float64()),
		rating: v.optional(v.float64()),
		notes: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const userId = await requireViewerUserId(ctx);
		const session = await ctx.db.get(args.sessionId);
		if (!session || session.ownerUserId !== userId) {
			throw new Error('Read session not found');
		}
		const now = Date.now();
		const finishedAt = args.finishedAt && Number.isFinite(args.finishedAt) ? args.finishedAt : now;
		const safeFinishedAt = finishedAt < session.startedAt ? session.startedAt : finishedAt;
		const nextRating = normalizeRating(args.rating ?? session.rating ?? undefined);
		await ctx.db.patch(session._id, {
			finishedAt: safeFinishedAt,
			rating: nextRating,
			notes: normalizeNotes(args.notes ?? session.notes ?? undefined),
			updatedAt: now
		});
		await syncTitleRatingFromSession(ctx, session.libraryTitleId, nextRating);
		return { ok: true };
	}
});

export const updateReadSession = mutation({
	args: {
		sessionId: v.id('titleReadSessions'),
		startedAt: v.optional(v.float64()),
		finishedAt: v.optional(v.union(v.float64(), v.null())),
		rating: v.optional(v.union(v.float64(), v.null())),
		notes: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		const userId = await requireViewerUserId(ctx);
		const session = await ctx.db.get(args.sessionId);
		if (!session || session.ownerUserId !== userId) {
			throw new Error('Read session not found');
		}
		const startedAt =
			args.startedAt !== undefined && Number.isFinite(args.startedAt)
				? args.startedAt
				: session.startedAt;
		let finishedAt: number | undefined;
		if (args.finishedAt === null) {
			finishedAt = undefined;
		} else if (args.finishedAt !== undefined && Number.isFinite(args.finishedAt)) {
			finishedAt = args.finishedAt < startedAt ? startedAt : args.finishedAt;
		} else {
			finishedAt =
				session.finishedAt !== undefined && session.finishedAt < startedAt
					? startedAt
					: session.finishedAt;
		}
		const rating =
			args.rating === null
				? undefined
				: args.rating !== undefined
					? normalizeRating(args.rating)
					: session.rating;
		const notes =
			args.notes === null
				? undefined
				: args.notes !== undefined
					? normalizeNotes(args.notes)
					: session.notes;
		await ctx.db.patch(session._id, {
			startedAt,
			finishedAt,
			rating,
			notes,
			updatedAt: Date.now()
		});
		await syncTitleRatingFromSession(ctx, session.libraryTitleId, rating);
		return { ok: true };
	}
});

export const deleteReadSession = mutation({
	args: {
		sessionId: v.id('titleReadSessions')
	},
	handler: async (ctx, args) => {
		const userId = await requireViewerUserId(ctx);
		const session = await ctx.db.get(args.sessionId);
		if (!session || session.ownerUserId !== userId) {
			throw new Error('Read session not found');
		}
		await ctx.db.delete(session._id);
		return { ok: true };
	}
});
