import { v } from 'convex/values';

import { mutation } from './_generated/server';
import {
	getOwnedChapterProgressRow,
	requireOwnedTitle,
	requireOwnedChapter,
	requireOwnedChapterComment
} from './library_shared';

export const upsertChapterProgress = mutation({
	args: {
		chapterId: v.id('libraryChapters'),
		pageIndex: v.float64()
	},
	handler: async (ctx, args) => {
		const chapter = await requireOwnedChapter(ctx, args.chapterId);
		const now = Date.now();
		const existing = await getOwnedChapterProgressRow(ctx, chapter._id);
		if (existing) {
			await ctx.db.patch(existing._id, {
				pageIndex: args.pageIndex,
				updatedAt: now
			});
			await ctx.db.patch(chapter.libraryTitleId, {
				lastReadAt: now,
				updatedAt: now
			});
			return { ok: true, progressId: existing._id };
		}

		const progressId = await ctx.db.insert('chapterProgress', {
			ownerUserId: chapter.ownerUserId,
			libraryTitleId: chapter.libraryTitleId,
			chapterId: chapter._id,
			pageIndex: args.pageIndex,
			createdAt: now,
			updatedAt: now
		});

		await ctx.db.patch(chapter.libraryTitleId, {
			lastReadAt: now,
			updatedAt: now
		});

		return { ok: true, progressId };
	}
});

export const resetChapterProgress = mutation({
	args: {
		chapterId: v.id('libraryChapters')
	},
	handler: async (ctx, args) => {
		const chapter = await requireOwnedChapter(ctx, args.chapterId);
		const title = await requireOwnedTitle(ctx, chapter.libraryTitleId);
		const [chapters, progressRows] = await Promise.all([
			ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
				.collect(),
			ctx.db
				.query('chapterProgress')
				.withIndex('by_owner_user_id_library_title_id_updated_at', (q) =>
					q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
				)
				.collect()
		]);

		const chapterIdsToClear = new Set(
			chapters
				.filter((row) => row.sequence >= chapter.sequence)
				.map((row) => String(row._id))
		);
		const progressRowsToDelete = progressRows.filter((row) =>
			chapterIdsToClear.has(String(row.chapterId))
		);

		for (const row of progressRowsToDelete) {
			await ctx.db.delete(row._id);
		}

		const remainingProgressRows = progressRows.filter(
			(row) => !chapterIdsToClear.has(String(row.chapterId))
		);

		await ctx.db.patch(title._id, {
			lastReadAt:
				remainingProgressRows.length > 0
					? Math.max(...remainingProgressRows.map((row) => row.updatedAt))
					: undefined,
			updatedAt: Date.now()
		});

		return { ok: true };
	}
});

export const markChaptersReadThrough = mutation({
	args: {
		titleId: v.id('libraryTitles'),
		chapterId: v.id('libraryChapters')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const targetChapter = await requireOwnedChapter(ctx, args.chapterId);
		if (targetChapter.libraryTitleId !== title._id) {
			throw new Error('Chapter does not belong to this title');
		}

		const [chapters, progressRows] = await Promise.all([
			ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
				.collect(),
			ctx.db
				.query('chapterProgress')
				.withIndex('by_owner_user_id_library_title_id_updated_at', (q) =>
					q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
				)
				.collect()
		]);

		const now = Date.now();
		const progressByChapterId = new Map(progressRows.map((row) => [String(row.chapterId), row] as const));
		const chaptersToMark = chapters
			.filter((chapter) => chapter.sequence <= targetChapter.sequence)
			.sort((left, right) => left.sequence - right.sequence);

		for (const chapter of chaptersToMark) {
			const existing = progressByChapterId.get(String(chapter._id));
			if (existing) {
				await ctx.db.patch(existing._id, {
					pageIndex: Math.max(existing.pageIndex, 0),
					updatedAt: now
				});
				continue;
			}

			await ctx.db.insert('chapterProgress', {
				ownerUserId: title.ownerUserId,
				libraryTitleId: title._id,
				chapterId: chapter._id,
				pageIndex: 0,
				createdAt: now,
				updatedAt: now
			});
		}

		await ctx.db.patch(title._id, {
			lastReadAt: now,
			updatedAt: now
		});

		return { ok: true, markedChapters: chaptersToMark.length };
	}
});

export const resetTitleProgress = mutation({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const progressRows = await ctx.db
			.query('chapterProgress')
			.withIndex('by_owner_user_id_library_title_id_updated_at', (q) =>
				q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
			)
			.collect();

		for (const row of progressRows) {
			await ctx.db.delete(row._id);
		}

		await ctx.db.patch(title._id, {
			lastReadAt: undefined,
			updatedAt: Date.now()
		});

		return { ok: true, clearedChapters: progressRows.length };
	}
});

export const createChapterComment = mutation({
	args: {
		chapterId: v.id('libraryChapters'),
		pageIndex: v.float64(),
		message: v.string()
	},
	handler: async (ctx, args) => {
		const chapter = await requireOwnedChapter(ctx, args.chapterId);
		const now = Date.now();
		const commentId = await ctx.db.insert('chapterComments', {
			ownerUserId: chapter.ownerUserId,
			libraryTitleId: chapter.libraryTitleId,
			chapterId: chapter._id,
			pageIndex: args.pageIndex,
			message: args.message.trim(),
			createdAt: now,
			updatedAt: now
		});
		return { ok: true, commentId };
	}
});

export const updateChapterComment = mutation({
	args: {
		commentId: v.id('chapterComments'),
		message: v.string()
	},
	handler: async (ctx, args) => {
		const comment = await requireOwnedChapterComment(ctx, args.commentId);
		await ctx.db.patch(comment._id, {
			message: args.message.trim(),
			updatedAt: Date.now()
		});
		return { ok: true };
	}
});

export const deleteChapterComment = mutation({
	args: {
		commentId: v.id('chapterComments')
	},
	handler: async (ctx, args) => {
		const comment = await requireOwnedChapterComment(ctx, args.commentId);
		await ctx.db.delete(comment._id);
		return { ok: true };
	}
});
