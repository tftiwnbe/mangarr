import type { GenericId } from 'convex/values';

import type { MutationCtx, QueryCtx } from './_generated/server';

export const DOWNLOAD_STATUS = {
	MISSING: 'missing',
	QUEUED: 'queued',
	DOWNLOADING: 'downloading',
	DOWNLOADED: 'downloaded',
	FAILED: 'failed'
} as const;

export const DEFAULT_USER_STATUSES = [
	{ key: 'reading', label: 'Reading' },
	{ key: 'completed', label: 'Completed' },
	{ key: 'on_hold', label: 'On Hold' },
	{ key: 'dropped', label: 'Dropped' },
	{ key: 'plan_to_read', label: 'Plan to Read' }
] as const;

export const DEFAULT_COLLECTIONS = [
	{ name: 'Favorites' },
	{ name: 'Queue' },
	{ name: 'Archive' }
] as const;

export async function requireViewerIdentity(ctx: QueryCtx | MutationCtx) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new Error('Not authenticated');
	}
	return identity;
}

export async function requireViewerUserId(ctx: QueryCtx | MutationCtx) {
	const identity = await requireViewerIdentity(ctx);
	return identity.subject as GenericId<'users'>;
}

export async function requireOwnedTitle(
	ctx: QueryCtx | MutationCtx,
	titleId: GenericId<'libraryTitles'>
) {
	const identity = await requireViewerIdentity(ctx);
	const title = await ctx.db.get(titleId);
	if (!title || title.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Library title not found');
	}

	return title;
}

export async function requireOwnedChapter(
	ctx: QueryCtx | MutationCtx,
	chapterId: GenericId<'libraryChapters'>
) {
	const identity = await requireViewerIdentity(ctx);
	const chapter = await ctx.db.get(chapterId);
	if (!chapter || chapter.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Library chapter not found');
	}

	return chapter;
}

export async function getOwnedChapterProgressRow(
	ctx: QueryCtx | MutationCtx,
	chapterId: GenericId<'libraryChapters'>
) {
	const identity = await requireViewerIdentity(ctx);

	return ctx.db
		.query('chapterProgress')
		.withIndex('by_owner_user_id_chapter_id', (q) =>
			q.eq('ownerUserId', identity.subject as GenericId<'users'>).eq('chapterId', chapterId)
		)
		.unique();
}

export async function requireOwnedChapterComment(
	ctx: QueryCtx | MutationCtx,
	commentId: GenericId<'chapterComments'>
) {
	const identity = await requireViewerIdentity(ctx);
	const comment = await ctx.db.get(commentId);
	if (!comment || comment.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Chapter comment not found');
	}

	return comment;
}

export async function requireOwnedUserStatus(
	ctx: QueryCtx | MutationCtx,
	statusId: GenericId<'libraryUserStatuses'>
) {
	const identity = await requireViewerIdentity(ctx);
	const status = await ctx.db.get(statusId);
	if (!status || status.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Library status not found');
	}
	return status;
}

export async function requireOwnedCollection(
	ctx: QueryCtx | MutationCtx,
	collectionId: GenericId<'libraryCollections'>
) {
	const identity = await requireViewerIdentity(ctx);
	const collection = await ctx.db.get(collectionId);
	if (!collection || collection.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Library collection not found');
	}
	return collection;
}

export async function requireOwnedVariant(
	ctx: QueryCtx | MutationCtx,
	variantId: GenericId<'titleVariants'>
) {
	const identity = await requireViewerIdentity(ctx);
	const variant = await ctx.db.get(variantId);
	if (!variant || variant.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Library variant not found');
	}
	return variant;
}
