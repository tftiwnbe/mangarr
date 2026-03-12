import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireBridgeIdentity } from './bridge_auth';

const DOWNLOAD_STATUS = {
	MISSING: 'missing',
	QUEUED: 'queued',
	DOWNLOADING: 'downloading',
	DOWNLOADED: 'downloaded',
	FAILED: 'failed'
} as const;

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

		const enriched = await Promise.all(
			titles.map(async (title) => {
				const chapters = await ctx.db
					.query('libraryChapters')
					.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
					.collect();

				let queued = 0;
				let downloading = 0;
				let downloaded = 0;
				let failed = 0;
				for (const chapter of chapters) {
					switch (chapter.downloadStatus) {
						case DOWNLOAD_STATUS.QUEUED:
							queued += 1;
							break;
						case DOWNLOAD_STATUS.DOWNLOADING:
							downloading += 1;
							break;
						case DOWNLOAD_STATUS.DOWNLOADED:
							downloaded += 1;
							break;
						case DOWNLOAD_STATUS.FAILED:
							failed += 1;
							break;
					}
				}

				return {
					...title,
					chapterStats: {
						total: chapters.length,
						queued,
						downloading,
						downloaded,
						failed
					}
				};
			})
		);

		return enriched.sort((left, right) => right.updatedAt - left.updatedAt);
	}
});

export const listTitleChapters = query({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const chapters = await ctx.db
			.query('libraryChapters')
			.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
			.collect();

		return chapters.sort((left, right) => left.sequence - right.sequence);
	}
});

export const getMineById = query({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const chapters = await ctx.db
			.query('libraryChapters')
			.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
			.collect();

		let queued = 0;
		let downloading = 0;
		let downloaded = 0;
		let failed = 0;
		for (const chapter of chapters) {
			switch (chapter.downloadStatus) {
				case DOWNLOAD_STATUS.QUEUED:
					queued += 1;
					break;
				case DOWNLOAD_STATUS.DOWNLOADING:
					downloading += 1;
					break;
				case DOWNLOAD_STATUS.DOWNLOADED:
					downloaded += 1;
					break;
				case DOWNLOAD_STATUS.FAILED:
					failed += 1;
					break;
			}
		}

		const progressRows = await ctx.db
			.query('chapterProgress')
			.withIndex('by_owner_user_id_library_title_id_updated_at', (q) =>
				q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
			)
			.collect();

		const titleComments = await ctx.db
			.query('chapterComments')
			.withIndex('by_owner_user_id_library_title_id_updated_at', (q) =>
				q.eq('ownerUserId', title.ownerUserId).eq('libraryTitleId', title._id)
			)
			.collect();

		const chapterById = new Map(chapters.map((chapter) => [chapter._id, chapter]));
		const latestProgress = [...progressRows].sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;

		return {
			...title,
			chapterStats: {
				total: chapters.length,
				queued,
				downloading,
				downloaded,
				failed
			},
			readingProgress: {
				startedChapters: progressRows.length,
				latest:
					latestProgress && chapterById.has(latestProgress.chapterId)
						? {
								chapterId: latestProgress.chapterId,
								pageIndex: latestProgress.pageIndex,
								updatedAt: latestProgress.updatedAt
							}
						: null
			},
			titleComments: titleComments
				.sort((left, right) => right.updatedAt - left.updatedAt)
				.map((comment) => {
					const chapter = chapterById.get(comment.chapterId);
					return {
						_id: comment._id,
						chapterId: comment.chapterId,
						chapterName: chapter?.chapterName ?? '',
						chapterNumber: chapter?.chapterNumber ?? null,
						pageIndex: comment.pageIndex,
						message: comment.message,
						createdAt: comment.createdAt,
						updatedAt: comment.updatedAt
					};
				}),
			chapters: chapters.sort((left, right) => right.sequence - left.sequence)
		};
	}
});

export const findMineBySource = query({
	args: {
		canonicalKey: v.optional(v.string()),
		sourceId: v.optional(v.string()),
		titleUrl: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return null;
		}

		const ownerUserId = identity.subject as GenericId<'users'>;
		if (args.canonicalKey?.trim()) {
			const byCanonical = await ctx.db
				.query('libraryTitles')
				.withIndex('by_owner_user_id_canonical_key', (q) =>
					q.eq('ownerUserId', ownerUserId).eq('canonicalKey', args.canonicalKey!.trim())
				)
				.unique();
			if (byCanonical) {
				return {
					_id: byCanonical._id,
					title: byCanonical.title,
					sourceId: byCanonical.sourceId,
					titleUrl: byCanonical.titleUrl
				};
			}
		}

		const sourceId = args.sourceId?.trim() ?? '';
		const titleUrl = args.titleUrl?.trim() ?? '';
		if (!sourceId || !titleUrl) {
			return null;
		}

		const rows = await ctx.db
			.query('libraryTitles')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
			.collect();

		const match =
			rows.find((row) => row.sourceId === sourceId && row.titleUrl === titleUrl) ??
			rows.find((row) => row.canonicalKey === args.canonicalKey);

		if (!match) {
			return null;
		}

		return {
			_id: match._id,
			title: match.title,
			sourceId: match.sourceId,
			titleUrl: match.titleUrl
		};
	}
});

export const getReaderByChapterId = query({
	args: {
		chapterId: v.id('libraryChapters')
	},
	handler: async (ctx, args) => {
		const chapter = await requireOwnedChapter(ctx, args.chapterId);
		const title = await ctx.db.get(chapter.libraryTitleId);
		if (!title || title.ownerUserId !== chapter.ownerUserId) {
			throw new Error('Library title not found');
		}

		const chapters = await ctx.db
			.query('libraryChapters')
			.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
			.collect();

		const progress = await getOwnedChapterProgressRow(ctx, chapter._id);

		return {
			title,
			chapter,
			chapters: chapters.sort((left, right) => left.sequence - right.sequence),
			progress: progress
				? {
						id: progress._id,
						pageIndex: progress.pageIndex,
						updatedAt: progress.updatedAt
					}
				: null
		};
	}
});

export const listChapterComments = query({
	args: {
		chapterId: v.id('libraryChapters')
	},
	handler: async (ctx, args) => {
		const chapter = await requireOwnedChapter(ctx, args.chapterId);
		const comments = await ctx.db
			.query('chapterComments')
			.withIndex('by_owner_user_id_chapter_id_updated_at', (q) =>
				q.eq('ownerUserId', chapter.ownerUserId).eq('chapterId', chapter._id)
			)
			.collect();

		return comments
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.map((item) => ({
				_id: item._id,
				chapterId: item.chapterId,
				pageIndex: item.pageIndex,
				message: item.message,
				createdAt: item.createdAt,
				updatedAt: item.updatedAt
			}));
	}
});

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
		const existing = await getOwnedChapterProgressRow(ctx, chapter._id);
		if (existing) {
			await ctx.db.delete(existing._id);
		}
		return { ok: true };
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

export const listAllMineChapters = query({
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

		const rows = [];
		for (const title of titles) {
			const chapters = await ctx.db
				.query('libraryChapters')
				.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
				.collect();
			for (const chapter of chapters) {
				rows.push({
					...chapter,
					title: title.title,
					titleCoverUrl: title.coverUrl ?? null,
					localCoverPath: title.localCoverPath ?? null
				});
			}
		}

		return rows.sort((left, right) => right.updatedAt - left.updatedAt);
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
		author: v.optional(v.string()),
		artist: v.optional(v.string()),
		title: v.string(),
		description: v.optional(v.string()),
		coverUrl: v.optional(v.string()),
		genre: v.optional(v.string()),
		status: v.optional(v.float64()),
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
			author: args.author,
			artist: args.artist,
			title: args.title,
			description: args.description,
			coverUrl: args.coverUrl,
			genre: args.genre,
			status: args.status,
			now: args.now
		});
	}
});

export const requestChapterSync = mutation({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error('Not authenticated');
		}
		const now = Date.now();
		const commandId = await ctx.db.insert('commands', {
			commandType: 'library.chapters.sync',
			targetCapability: 'library.chapters.sync',
			requestedByUserId: identity.subject as GenericId<'users'>,
			payload: {
				titleId: title._id,
				sourceId: title.sourceId,
				titleUrl: title.titleUrl
			},
			idempotencyKey: `library.chapters.sync:${String(title._id)}:${now}`,
			status: 'queued',
			priority: 100,
			runAfter: now,
			attemptCount: 0,
			maxAttempts: 3,
			createdAt: now,
			updatedAt: now
		});

		return { commandId };
	}
});

export const requestChapterDownload = mutation({
	args: {
		chapterId: v.id('libraryChapters')
	},
	handler: async (ctx, args) => {
		const chapter = await requireOwnedChapter(ctx, args.chapterId);
		const title = await ctx.db.get(chapter.libraryTitleId);
		if (!title || title.ownerUserId !== chapter.ownerUserId) {
			throw new Error('Library title not found');
		}
		if (
			chapter.downloadStatus === DOWNLOAD_STATUS.QUEUED ||
			chapter.downloadStatus === DOWNLOAD_STATUS.DOWNLOADING
		) {
			return { commandId: null, alreadyQueued: true };
		}

		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error('Not authenticated');
		}
		const now = Date.now();

		await ctx.db.patch(chapter._id, {
			downloadStatus: DOWNLOAD_STATUS.QUEUED,
			downloadedPages: 0,
			totalPages: undefined,
			lastErrorMessage: undefined,
			updatedAt: now
		});

		const commandId = await ctx.db.insert('commands', {
			commandType: 'downloads.chapter',
			targetCapability: 'downloads.chapter',
			requestedByUserId: identity.subject as GenericId<'users'>,
			payload: {
				chapterId: chapter._id,
				titleId: title._id,
				sourceId: chapter.sourceId,
				titleUrl: chapter.titleUrl,
				chapterUrl: chapter.chapterUrl,
				title: title.title,
				chapterName: chapter.chapterName
			},
			idempotencyKey: `downloads.chapter:${String(chapter._id)}:${now}`,
			status: 'queued',
			priority: 100,
			runAfter: now,
			attemptCount: 0,
			maxAttempts: 3,
			createdAt: now,
			updatedAt: now
		});

		return { commandId, alreadyQueued: false };
	}
});

export const requestMissingDownloads = mutation({
	args: {
		titleId: v.id('libraryTitles')
	},
	handler: async (ctx, args) => {
		const title = await requireOwnedTitle(ctx, args.titleId);
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error('Not authenticated');
		}

		const chapters = await ctx.db
			.query('libraryChapters')
			.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', title._id))
			.collect();

		const eligible = chapters.filter(
			(chapter) =>
				chapter.downloadStatus === DOWNLOAD_STATUS.MISSING ||
				chapter.downloadStatus === DOWNLOAD_STATUS.FAILED
		);

		const now = Date.now();
		const commandIds: GenericId<'commands'>[] = [];
		for (const [index, chapter] of eligible.entries()) {
			await ctx.db.patch(chapter._id, {
				downloadStatus: DOWNLOAD_STATUS.QUEUED,
				downloadedPages: 0,
				totalPages: undefined,
				lastErrorMessage: undefined,
				updatedAt: now
			});

			commandIds.push(
				await ctx.db.insert('commands', {
					commandType: 'downloads.chapter',
					targetCapability: 'downloads.chapter',
					requestedByUserId: identity.subject as GenericId<'users'>,
					payload: {
						chapterId: chapter._id,
						titleId: title._id,
						sourceId: chapter.sourceId,
						titleUrl: chapter.titleUrl,
						chapterUrl: chapter.chapterUrl,
						title: title.title,
						chapterName: chapter.chapterName
					},
					idempotencyKey: `downloads.chapter:${String(chapter._id)}:${now}:${index}`,
					status: 'queued',
					priority: 100 + index,
					runAfter: now,
					attemptCount: 0,
					maxAttempts: 3,
					createdAt: now,
					updatedAt: now
				})
			);
		}

		return {
			enqueued: commandIds.length,
			commandIds
		};
	}
});

export const upsertChaptersForTitle = mutation({
	args: {
		titleId: v.id('libraryTitles'),
		chapters: v.array(
			v.object({
				url: v.string(),
				name: v.string(),
				dateUpload: v.optional(v.float64()),
				chapterNumber: v.optional(v.float64()),
				scanlator: v.optional(v.string())
			})
		),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const title = await ctx.db.get(args.titleId);
		if (!title) {
			throw new Error('Library title not found');
		}

		const existing = await ctx.db
			.query('libraryChapters')
			.withIndex('by_library_title_id', (q) => q.eq('libraryTitleId', args.titleId))
			.collect();
		const byUrl = new Map(existing.map((chapter) => [chapter.chapterUrl, chapter]));

		for (const [index, chapter] of args.chapters.entries()) {
			const current = byUrl.get(chapter.url);
			if (current) {
				await ctx.db.patch(current._id, {
					sourceId: title.sourceId,
					sourcePkg: title.sourcePkg,
					sourceLang: title.sourceLang,
					titleUrl: title.titleUrl,
					chapterName: chapter.name,
					chapterNumber: chapter.chapterNumber,
					scanlator: chapter.scanlator,
					dateUpload: chapter.dateUpload,
					sequence: index,
					updatedAt: args.now
				});
				continue;
			}

			await ctx.db.insert('libraryChapters', {
				ownerUserId: title.ownerUserId,
				libraryTitleId: title._id,
				sourceId: title.sourceId,
				sourcePkg: title.sourcePkg,
				sourceLang: title.sourceLang,
				titleUrl: title.titleUrl,
				chapterUrl: chapter.url,
				chapterName: chapter.name,
				chapterNumber: chapter.chapterNumber,
				scanlator: chapter.scanlator,
				dateUpload: chapter.dateUpload,
				sequence: index,
				downloadStatus: DOWNLOAD_STATUS.MISSING,
				downloadedPages: 0,
				createdAt: args.now,
				updatedAt: args.now
			});
		}

		await ctx.db.patch(title._id, {
			updatedAt: args.now
		});

		return { ok: true, chapterCount: args.chapters.length };
	}
});

export const setLocalCoverPath = mutation({
	args: {
		titleId: v.id('libraryTitles'),
		localCoverPath: v.optional(v.string()),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const title = await ctx.db.get(args.titleId);
		if (!title) {
			throw new Error('Library title not found');
		}

		await ctx.db.patch(title._id, {
			localCoverPath: args.localCoverPath,
			updatedAt: args.now
		});

		return { ok: true };
	}
});

export const setChapterDownloadState = mutation({
	args: {
		chapterId: v.id('libraryChapters'),
		status: v.union(
			v.literal('missing'),
			v.literal('queued'),
			v.literal('downloading'),
			v.literal('downloaded'),
			v.literal('failed')
		),
		downloadedPages: v.optional(v.float64()),
		totalPages: v.optional(v.float64()),
		localRelativePath: v.optional(v.union(v.string(), v.null())),
		storageKind: v.optional(v.union(v.literal('directory'), v.literal('archive'), v.null())),
		fileSizeBytes: v.optional(v.float64()),
		lastErrorMessage: v.optional(v.union(v.string(), v.null())),
		now: v.float64()
	},
	handler: async (ctx, args) => {
		await requireBridgeIdentity(ctx);
		const chapter = await ctx.db.get(args.chapterId);
		if (!chapter) {
			throw new Error('Library chapter not found');
		}

		await ctx.db.patch(chapter._id, {
			downloadStatus: args.status,
			downloadedPages: args.downloadedPages ?? chapter.downloadedPages,
			totalPages: args.totalPages ?? chapter.totalPages,
			localRelativePath:
				args.localRelativePath === undefined
					? chapter.localRelativePath
					: (args.localRelativePath ?? undefined),
			storageKind:
				args.storageKind === undefined ? chapter.storageKind : (args.storageKind ?? undefined),
			fileSizeBytes: args.fileSizeBytes === undefined ? chapter.fileSizeBytes : args.fileSizeBytes,
			lastErrorMessage:
				args.lastErrorMessage === undefined
					? chapter.lastErrorMessage
					: (args.lastErrorMessage ?? undefined),
			downloadedAt: args.status === DOWNLOAD_STATUS.DOWNLOADED ? args.now : chapter.downloadedAt,
			updatedAt: args.now
		});

		return { ok: true };
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
		author?: string;
		artist?: string;
		title: string;
		description?: string;
		coverUrl?: string;
		genre?: string;
		status?: number;
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
			author: args.author,
			artist: args.artist,
			description: args.description,
			coverUrl: args.coverUrl,
			genre: args.genre,
			status: args.status,
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
		author: args.author,
		artist: args.artist,
		description: args.description,
		coverUrl: args.coverUrl,
		genre: args.genre,
		status: args.status,
		createdAt: args.now,
		updatedAt: args.now
	});

	return { created: true, titleId };
}

async function requireOwnedTitle(ctx: QueryCtx | MutationCtx, titleId: GenericId<'libraryTitles'>) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new Error('Not authenticated');
	}

	const title = await ctx.db.get(titleId);
	if (!title || title.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Library title not found');
	}

	return title;
}

async function requireOwnedChapter(
	ctx: QueryCtx | MutationCtx,
	chapterId: GenericId<'libraryChapters'>
) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new Error('Not authenticated');
	}

	const chapter = await ctx.db.get(chapterId);
	if (!chapter || chapter.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Library chapter not found');
	}

	return chapter;
}

async function getOwnedChapterProgressRow(
	ctx: QueryCtx | MutationCtx,
	chapterId: GenericId<'libraryChapters'>
) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new Error('Not authenticated');
	}

	return ctx.db
		.query('chapterProgress')
		.withIndex('by_owner_user_id_chapter_id', (q) =>
			q.eq('ownerUserId', identity.subject as GenericId<'users'>).eq('chapterId', chapterId)
		)
		.unique();
}

async function requireOwnedChapterComment(
	ctx: QueryCtx | MutationCtx,
	commentId: GenericId<'chapterComments'>
) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new Error('Not authenticated');
	}

	const comment = await ctx.db.get(commentId);
	if (!comment || comment.ownerUserId !== (identity.subject as GenericId<'users'>)) {
		throw new Error('Chapter comment not found');
	}

	return comment;
}
