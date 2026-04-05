/**
 * Typed payload definitions for every command type in the system.
 *
 * Provides:
 *  - `CommandPayloadMap`      – TypeScript interface keyed by commandType
 *  - `CommandType`            – union of every known commandType string
 *  - `commandPayloadValidator` – Convex v.union(...) schema validator
 *  - `insertCommand`          – typed helper replacing repetitive ctx.db.insert boilerplate
 */
import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import type { MutationCtx } from './_generated/server';

// ---------------------------------------------------------------------------
// TypeScript type map
// ---------------------------------------------------------------------------

export interface CommandPayloadMap {
	'extensions.repo.sync': { url: string };
	'extensions.repo.search': { query: string; limit: number };
	'extensions.install': { pkg: string };
	'extensions.uninstall': { pkg: string };
	'sources.preferences.fetch': { sourceId: string };
	'sources.preferences.save': {
		sourceId: string;
		entries: Array<{ key: string; value: unknown }>;
	};
	'explore.popular': { sourceId: string; page: number; limit: number };
	'explore.latest': { sourceId: string; page: number; limit: number };
	'explore.search': {
		sourceId: string;
		query: string;
		limit: number;
		searchFilters?: unknown;
	};
	'explore.title.fetch': { sourceId: string; titleUrl: string };
	'explore.chapters.fetch': { sourceId: string; titleUrl: string };
	'reader.pages.fetch': { sourceId: string; chapterUrl: string; chapterName?: string };
	'library.import': {
		canonicalKey: string;
		sourceId: string;
		sourcePkg: string;
		sourceLang: string;
		titleUrl: string;
	};
	'library.chapters.sync': {
		titleId: GenericId<'libraryTitles'>;
		sourceId: string;
		titleUrl: string;
	};
	'library.cover.cache': {
		titleId: GenericId<'libraryTitles'>;
		sourceId: string;
		coverUrl: string;
	};
	'downloads.chapter': {
		chapterId: GenericId<'libraryChapters'>;
		downloadTaskId: GenericId<'downloadTasks'>;
		titleId: GenericId<'libraryTitles'>;
		sourceId: string;
		sourcePkg: string;
		sourceLang: string;
		titleUrl: string;
		chapterUrl: string;
		title: string;
		chapterName: string;
		chapterNumber?: number;
	};
}

export type CommandType = keyof CommandPayloadMap;

// ---------------------------------------------------------------------------
// Convex schema validator  (more-specific shapes first so v.union short-circuits correctly)
// ---------------------------------------------------------------------------

export const commandPayloadValidator = v.union(
	// downloads.chapter — most fields, most specific
	v.object({
		chapterId: v.id('libraryChapters'),
		downloadTaskId: v.id('downloadTasks'),
		titleId: v.id('libraryTitles'),
		sourceId: v.string(),
		sourcePkg: v.string(),
		sourceLang: v.string(),
		titleUrl: v.string(),
		chapterUrl: v.string(),
		title: v.string(),
		chapterName: v.string(),
		chapterNumber: v.optional(v.float64())
	}),
	// library.import — unique canonicalKey discriminant
	v.object({
		canonicalKey: v.string(),
		sourceId: v.string(),
		sourcePkg: v.string(),
		sourceLang: v.string(),
		titleUrl: v.string()
	}),
	// library.chapters.sync — titleId + sourceId + titleUrl
	v.object({
		titleId: v.id('libraryTitles'),
		sourceId: v.string(),
		titleUrl: v.string()
	}),
	// library.cover.cache — titleId + sourceId + coverUrl
	v.object({
		titleId: v.id('libraryTitles'),
		sourceId: v.string(),
		coverUrl: v.string()
	}),
	// sources.preferences.save — entries array discriminant
	v.object({
		sourceId: v.string(),
		entries: v.array(v.object({ key: v.string(), value: v.any() }))
	}),
	// reader.pages.fetch — chapterUrl discriminant
	v.object({
		sourceId: v.string(),
		chapterUrl: v.string(),
		chapterName: v.optional(v.string())
	}),
	// explore.search — query + limit + sourceId (optional searchFilters)
	v.object({
		sourceId: v.string(),
		query: v.string(),
		limit: v.float64(),
		searchFilters: v.optional(v.any())
	}),
	// explore.popular / explore.latest — sourceId + page + limit
	v.object({
		sourceId: v.string(),
		page: v.float64(),
		limit: v.float64()
	}),
	// explore.title.fetch / explore.chapters.fetch — sourceId + titleUrl
	v.object({
		sourceId: v.string(),
		titleUrl: v.string()
	}),
	// extensions.repo.search — query + limit (no sourceId)
	v.object({ query: v.string(), limit: v.float64() }),
	// sources.preferences.fetch — sourceId only
	v.object({ sourceId: v.string() }),
	// extensions.install / extensions.uninstall — pkg only
	v.object({ pkg: v.string() }),
	// extensions.repo.sync — url only
	v.object({ url: v.string() })
);

// ---------------------------------------------------------------------------
// Typed insert helper
// ---------------------------------------------------------------------------

/**
 * Insert a command document with a fully-typed payload.
 * `targetCapability` defaults to `commandType` (true for all known commands).
 */
export async function insertCommand<T extends CommandType>(
	ctx: MutationCtx,
	args: {
		commandType: T;
		requestedByUserId: GenericId<'users'>;
		payload: CommandPayloadMap[T];
		idempotencyKey: string;
		priority: number;
		maxAttempts: number;
		runAfter: number;
		now: number;
		targetCapability?: string;
	}
) {
	return ctx.db.insert('commands', {
		commandType: args.commandType,
		targetCapability: args.targetCapability ?? args.commandType,
		requestedByUserId: args.requestedByUserId,
		payload: args.payload,
		idempotencyKey: args.idempotencyKey,
		status: 'queued',
		priority: args.priority,
		runAfter: args.runAfter,
		attemptCount: 0,
		maxAttempts: args.maxAttempts,
		createdAt: args.now,
		updatedAt: args.now
	});
}
