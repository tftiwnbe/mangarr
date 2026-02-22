import * as libraryApi from '$lib/api/library';
import { ApiError } from '$lib/api/errors';
import type { TitleCardItem, TitleDetailItem } from '$lib/utils/title-mappers';
import { mapLibrarySummaryToTitleCard, mapLibraryTitleToDetail } from '$lib/utils/title-mappers';

import { createAsyncResourceStore } from './async-resource';

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
	{ initialData: [], cacheMs: 30_000 }
);

export const libraryTitleDetailStore = createAsyncResourceStore<
	TitleDetailItem | null,
	[titleId: number]
>(
	async (titleId) => {
		try {
			const title = await withTimeout(libraryApi.getLibraryTitle(titleId), 12_000);
			let chapters: libraryApi.LibraryChapterResource[] = [];
			try {
				chapters = await withTimeout(
					libraryApi.listLibraryTitleChapters(titleId, {
						variant_id: title.preferred_variant_id ?? undefined
					}),
					12_000
				);
			} catch {
				chapters = [];
			}
			return mapLibraryTitleToDetail(title, chapters);
		} catch (error: unknown) {
			if (error instanceof ApiError && error.status === 404) {
				return null;
			}
			throw error;
		}
	},
	{ initialData: null, cacheMs: 10_000 }
);
