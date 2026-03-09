import * as exploreApi from '$lib/api/explore';
import type { SourceSummary } from '$lib/api/explore';
import type { TitleCardItem } from '$lib/utils/title-mappers';
import { mapExploreItemToTitleCard } from '$lib/utils/title-mappers';
import { CACHE_MS } from '$lib/utils/cache-durations';

import { createAsyncResourceStore } from './async-resource';

const FEED_LIMIT = 24;

export const popularTitlesStore = createAsyncResourceStore<TitleCardItem[], []>(
	async () => {
		const feed = await exploreApi.getPopularFeed({ limit: FEED_LIMIT });
		return feed.items.map(mapExploreItemToTitleCard);
	},
	{ initialData: [], cacheMs: CACHE_MS.EXPLORE_FEED }
);

export const latestTitlesStore = createAsyncResourceStore<TitleCardItem[], []>(
	async () => {
		const feed = await exploreApi.getLatestFeed({ limit: FEED_LIMIT });
		return feed.items.map(mapExploreItemToTitleCard);
	},
	{ initialData: [], cacheMs: CACHE_MS.EXPLORE_FEED }
);

export const updatesTitlesStore = createAsyncResourceStore<TitleCardItem[], []>(
	async () => {
		const pageTwo = await exploreApi.getLatestFeed({ page: 2, limit: FEED_LIMIT });
		if (pageTwo.items.length > 0) {
			return pageTwo.items.map(mapExploreItemToTitleCard);
		}
		const fallback = await exploreApi.getLatestFeed({ limit: FEED_LIMIT });
		return fallback.items.map(mapExploreItemToTitleCard);
	},
	{ initialData: [], cacheMs: CACHE_MS.EXPLORE_FEED }
);

export const exploreSourcesStore = createAsyncResourceStore<SourceSummary[], []>(
	async () => exploreApi.listSources({ enabled: true }),
	{ initialData: [], cacheMs: CACHE_MS.EXPLORE_SOURCES }
);

export const searchTitlesStore = createAsyncResourceStore<
	TitleCardItem[],
	[query: string, sourceId?: string | null]
>(
	async (query, sourceId = null) => {
		const trimmedQuery = query.trim();
		if (trimmedQuery.length === 0) {
			return [];
		}
		const feed = await exploreApi.searchFeed({
			query: trimmedQuery,
			limit: 42,
			source_id: sourceId
		});
		return feed.items.map(mapExploreItemToTitleCard);
	},
	{ initialData: [], cacheMs: CACHE_MS.EXPLORE_SEARCH }
);
