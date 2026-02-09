import * as discoverApi from '$lib/api/discover';
import type { SourceSummary } from '$lib/api/discover';
import type { TitleCardItem } from '$lib/models/title';
import { mapDiscoverItemToTitleCard } from '$lib/utils/title-mappers';

import { createAsyncResourceStore } from './async-resource';

const FEED_LIMIT = 24;

export const popularTitlesStore = createAsyncResourceStore<TitleCardItem[], []>(
	async () => {
		const feed = await discoverApi.getPopularFeed({ limit: FEED_LIMIT });
		return feed.items.map(mapDiscoverItemToTitleCard);
	},
	{ initialData: [], cacheMs: 60_000 }
);

export const latestTitlesStore = createAsyncResourceStore<TitleCardItem[], []>(
	async () => {
		const feed = await discoverApi.getLatestFeed({ limit: FEED_LIMIT });
		return feed.items.map(mapDiscoverItemToTitleCard);
	},
	{ initialData: [], cacheMs: 60_000 }
);

export const updatesTitlesStore = createAsyncResourceStore<TitleCardItem[], []>(
	async () => {
		const pageTwo = await discoverApi.getLatestFeed({ page: 2, limit: FEED_LIMIT });
		if (pageTwo.items.length > 0) {
			return pageTwo.items.map(mapDiscoverItemToTitleCard);
		}
		const fallback = await discoverApi.getLatestFeed({ limit: FEED_LIMIT });
		return fallback.items.map(mapDiscoverItemToTitleCard);
	},
	{ initialData: [], cacheMs: 60_000 }
);

export const discoverSourcesStore = createAsyncResourceStore<SourceSummary[], []>(
	async () => discoverApi.listSources({ enabled: true }),
	{ initialData: [], cacheMs: 120_000 }
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
		const feed = await discoverApi.searchFeed({
			query: trimmedQuery,
			limit: 42,
			source_id: sourceId
		});
		return feed.items.map(mapDiscoverItemToTitleCard);
	},
	{ initialData: [], cacheMs: 15_000 }
);
