import { browser } from '$app/environment';

import * as libraryApi from '$lib/api/library';
import { ApiError } from '$lib/api/errors';
import type { TitleCardItem, TitleDetailItem } from '$lib/utils/title-mappers';
import { mapLibrarySummaryToTitleCard, mapLibraryTitleToDetail } from '$lib/utils/title-mappers';
import { CACHE_MS, REQUEST_TIMEOUT_MS } from '$lib/utils/cache-durations';

import { createAsyncResourceStore } from './async-resource';
import { wsManager } from './ws';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return new Promise<T>((resolve, reject) => {
		timer = setTimeout(() => reject(new Error('Request timed out')), ms);
		promise.then(
			(value) => {
				if (timer) clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				if (timer) clearTimeout(timer);
				reject(error);
			}
		);
	});
}

export const libraryTitlesStore = createAsyncResourceStore<
	TitleCardItem[],
	[query?: { offset?: number; limit?: number }]
>(
	async (query = { offset: 0, limit: 100 }) => {
		const titles = await libraryApi.listLibraryTitles(query);
		return titles.map(mapLibrarySummaryToTitleCard);
	},
	{ initialData: [], cacheMs: CACHE_MS.LIBRARY }
);

export const libraryTitleDetailStore = createAsyncResourceStore<
	TitleDetailItem | null,
	[titleId: number]
>(
	async (titleId) => {
		try {
			const title = await withTimeout(
				libraryApi.getLibraryTitle(titleId),
				REQUEST_TIMEOUT_MS
			);
			let chapters: libraryApi.LibraryChapterResource[] = [];
			let chaptersError: string | undefined;
			try {
				chapters = await withTimeout(
					libraryApi.listLibraryTitleChapters(titleId, {
						variant_id: title.preferred_variant_id ?? undefined
					}),
					REQUEST_TIMEOUT_MS
				);
			} catch (err) {
				chapters = [];
				chaptersError =
					err instanceof Error ? err.message : 'Failed to load chapters';
			}
			return mapLibraryTitleToDetail(title, chapters, chaptersError);
		} catch (error: unknown) {
			if (error instanceof ApiError && error.status === 404) {
				return null;
			}
			throw error;
		}
	},
	{ initialData: null, cacheMs: CACHE_MS.TITLE_DETAIL }
);

// Invalidate the library list whenever the server signals a change.
// job.run covers chapter updates; title.imported / titles.cleanup cover list mutations.
if (browser) {
	wsManager.on('job.run', () => libraryTitlesStore.invalidate());
	wsManager.on('title.imported', () => libraryTitlesStore.invalidate());
	wsManager.on('titles.cleanup', () => libraryTitlesStore.invalidate());
}
