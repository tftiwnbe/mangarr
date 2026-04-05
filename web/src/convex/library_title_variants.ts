import { v } from 'convex/values';

import { mutation } from './_generated/server';
import {
	applyVariantSnapshotToTitle,
	loadInstalledSourceCatalog,
	pickVariantNormalizationAssignments,
	refreshTitleChapterStats,
	refreshTitleVariantCount,
	requireOwnedTitle,
	requireOwnedVariant,
	setTitlePreferredVariant,
	variantInstalledSourceRecord
} from './library_shared';

export const linkVariant = mutation({
	args: {
		titleId: v.id('libraryTitles'),
		sourceId: v.string(),
		sourcePkg: v.string(),
		sourceLang: v.string(),
		titleUrl: v.string(),
		title: v.string(),
		author: v.optional(v.union(v.string(), v.null())),
		artist: v.optional(v.union(v.string(), v.null())),
		description: v.optional(v.union(v.string(), v.null())),
		coverUrl: v.optional(v.union(v.string(), v.null())),
		genre: v.optional(v.union(v.string(), v.null())),
		status: v.optional(v.union(v.float64(), v.null()))
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const now = Date.now();
		const existing = await ctx.db
			.query('titleVariants')
			.withIndex('by_owner_user_id_source_id_title_url', (q) =>
				q
					.eq('ownerUserId', title.ownerUserId)
					.eq('sourceId', args.sourceId)
					.eq('titleUrl', args.titleUrl)
			)
			.unique();

		if (existing) {
			if (existing.libraryTitleId !== title._id) {
				throw new Error('Linked to another title');
			}

			await ctx.db.patch(existing._id, {
				sourcePkg: args.sourcePkg,
				sourceLang: args.sourceLang,
				title: args.title,
				author: args.author ?? undefined,
				artist: args.artist ?? undefined,
				description: args.description ?? undefined,
				coverUrl: args.coverUrl ?? undefined,
				genre: args.genre ?? undefined,
				status: args.status ?? undefined,
				updatedAt: now,
				lastSyncedAt: now
			});
			if (title.preferredVariantId === existing._id) {
				await applyVariantSnapshotToTitle(ctx, title._id, {
					sourceId: args.sourceId,
					sourcePkg: args.sourcePkg,
					sourceLang: args.sourceLang,
					titleUrl: args.titleUrl,
					title: args.title,
					author: args.author ?? undefined,
					artist: args.artist ?? undefined,
					description: args.description ?? undefined,
					coverUrl: args.coverUrl ?? undefined,
					genre: args.genre ?? undefined,
					status: args.status ?? undefined,
					preferredVariantId: existing._id,
					now
				});
			} else {
				await ctx.db.patch(title._id, { updatedAt: now });
			}
			return { ok: true, variantId: existing._id, alreadyLinked: true };
		}

		const variantId = await ctx.db.insert('titleVariants', {
			ownerUserId: title.ownerUserId,
			libraryTitleId: title._id,
			sourceId: args.sourceId,
			sourcePkg: args.sourcePkg,
			sourceLang: args.sourceLang,
			titleUrl: args.titleUrl,
			title: args.title,
			author: args.author ?? undefined,
			artist: args.artist ?? undefined,
			description: args.description ?? undefined,
			coverUrl: args.coverUrl ?? undefined,
			genre: args.genre ?? undefined,
			status: args.status ?? undefined,
			isPreferred: false,
			createdAt: now,
			updatedAt: now,
			lastSyncedAt: now
		});

		if (!title.preferredVariantId) {
			await setTitlePreferredVariant(ctx, title._id, variantId, now);
		} else {
			await ctx.db.patch(title._id, { updatedAt: now });
		}

		await refreshTitleVariantCount(ctx, title, now);
		return { ok: true, variantId, alreadyLinked: false };
	}
});

export const removeVariant = mutation({
	args: {
		titleId: v.id('libraryTitles'),
		variantId: v.id('titleVariants')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const variant = await requireOwnedVariant(ctx, args.variantId);
		if (variant.libraryTitleId !== title._id) {
			throw new Error('Library variant not found');
		}

		const variants = await ctx.db
			.query('titleVariants')
			.withIndex('by_owner_user_id_library_title_id', (q) =>
				q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
			)
			.collect();
		if (variants.length <= 1) {
			throw new Error('Cannot remove the last source');
		}

		const chapters = await ctx.db
			.query('libraryChapters')
			.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
			.collect();
		const variantChapters = chapters.filter((chapter) => chapter.titleVariantId === variant._id);

		if (variantChapters.length > 0) {
			const variantChapterIds = new Set(variantChapters.map((c) => String(c._id)));
			// Batch-load all progress and comment rows for the title, then filter to
			// only the variant's chapters — 2 queries instead of 2 × chapters.length.
			const [allProgressRows, allCommentRows] = await Promise.all([
				ctx.db
					.query('chapterProgress')
					.withIndex('by_owner_user_id_library_title_id_updated_at', (q) =>
						q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
					)
					.collect(),
				ctx.db
					.query('chapterComments')
					.withIndex('by_owner_user_id_library_title_id_updated_at', (q) =>
						q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
					)
					.collect()
			]);
			for (const progress of allProgressRows) {
				if (variantChapterIds.has(String(progress.chapterId))) {
					await ctx.db.delete(progress._id);
				}
			}
			for (const comment of allCommentRows) {
				if (variantChapterIds.has(String(comment.chapterId))) {
					await ctx.db.delete(comment._id);
				}
			}
			for (const chapter of variantChapters) {
				await ctx.db.delete(chapter._id);
			}
		}

		await ctx.db.delete(variant._id);
		const now = Date.now();
		await refreshTitleChapterStats(ctx, title._id, now);
		await refreshTitleVariantCount(ctx, title, now);
		const nextPreferredVariantId =
			title.preferredVariantId === variant._id ? undefined : title.preferredVariantId;
		const preferredVariantId = await setTitlePreferredVariant(
			ctx,
			title._id,
			nextPreferredVariantId,
			now
		);

		return {
			ok: true,
			removedVariantId: variant._id,
			removedChapterCount: variantChapters.length,
			preferredVariantId: preferredVariantId ?? null
		};
	}
});

export const normalizeTitleVariants = mutation({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const now = Date.now();
		const [variants, chapters, installedSourceCatalog] = await Promise.all([
			ctx.db
				.query('titleVariants')
				.withIndex('by_owner_user_id_library_title_id', (q) =>
					q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
				)
				.collect(),
			ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
				.collect(),
			loadInstalledSourceCatalog(ctx)
		]);

		const assignments = pickVariantNormalizationAssignments(variants, installedSourceCatalog);
		let repairedCount = 0;
		const unresolvedVariantIds: string[] = [];

		for (const variant of variants) {
			const installedRecord = variantInstalledSourceRecord(installedSourceCatalog, variant);
			if (installedRecord !== null) {
				continue;
			}

			const assignment = assignments.get(String(variant._id));
			if (!assignment) {
				unresolvedVariantIds.push(String(variant._id));
				continue;
			}

			const conflictingVariant = await ctx.db
				.query('titleVariants')
				.withIndex('by_owner_user_id_source_id_title_url', (q) =>
					q
						.eq('ownerUserId', title.ownerUserId)
						.eq('sourceId', assignment.sourceId)
						.eq('titleUrl', variant.titleUrl)
				)
				.unique();
			if (conflictingVariant && conflictingVariant._id !== variant._id) {
				unresolvedVariantIds.push(String(variant._id));
				continue;
			}

			await ctx.db.patch(variant._id, {
				sourceId: assignment.sourceId,
				sourceLang: assignment.sourceLang,
				updatedAt: now
			});

			for (const chapter of chapters) {
				const belongsToVariant =
					chapter.titleVariantId === variant._id ||
					(!chapter.titleVariantId &&
						chapter.sourceId === variant.sourceId &&
						chapter.sourcePkg === variant.sourcePkg &&
						chapter.titleUrl === variant.titleUrl);
				if (!belongsToVariant) continue;

				await ctx.db.patch(chapter._id, {
					titleVariantId: variant._id,
					sourceId: assignment.sourceId,
					sourceLang: assignment.sourceLang,
					updatedAt: now
				});
			}

			repairedCount += 1;
		}

		await setTitlePreferredVariant(ctx, title._id, title.preferredVariantId, now);

		return {
			ok: true,
			repairedCount,
			unresolvedVariantIds
		};
	}
});
