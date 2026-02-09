import * as libraryApi from '$lib/api/library';
import { ApiError } from '$lib/api/errors';
import type { TitleCardItem, TitleDetailItem } from '$lib/models/title';
import { mapLibrarySummaryToTitleCard, mapLibraryTitleToDetail } from '$lib/utils/title-mappers';

import { createAsyncResourceStore } from './async-resource';

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

export const libraryTitleDetailStore = createAsyncResourceStore<TitleDetailItem | null, [titleId: number]>(
	async (titleId) => {
		try {
			const [title, chapters] = await Promise.all([
				libraryApi.getLibraryTitle(titleId),
				libraryApi.listLibraryTitleChapters(titleId)
			]);
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
