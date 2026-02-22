import { writable } from 'svelte/store';
import * as exploreApi from '$lib/api/explore';
import type { ExploreFeed, SourceSummary } from '$lib/api/explore';
import type { TitleCardItem } from '$lib/utils/title-mappers';
import { mapExploreItemToTitleCard } from '$lib/utils/title-mappers';

import { createAsyncResourceStore } from './async-resource';

// Store for preview item - holds the currently selected explore item for preview
export type ExploreItem = ExploreFeed['items'][number];
export const previewItemStore = writable<ExploreItem | null>(null);

const FEED_LIMIT = 24;

export const popularTitlesStore = createAsyncResourceStore<TitleCardItem[], []>(
	async () => {
		const feed = await exploreApi.getPopularFeed({ limit: FEED_LIMIT });
		return feed.items.map(mapExploreItemToTitleCard);
	},
	{ initialData: [], cacheMs: 60_000 }
);

export const latestTitlesStore = createAsyncResourceStore<TitleCardItem[], []>(
	async () => {
		const feed = await exploreApi.getLatestFeed({ limit: FEED_LIMIT });
		return feed.items.map(mapExploreItemToTitleCard);
	},
	{ initialData: [], cacheMs: 60_000 }
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
	{ initialData: [], cacheMs: 60_000 }
);

export const exploreSourcesStore = createAsyncResourceStore<SourceSummary[], []>(
	async () => exploreApi.listSources({ enabled: true }),
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
		const feed = await exploreApi.searchFeed({
			query: trimmedQuery,
			limit: 42,
			source_id: sourceId
		});
		return feed.items.map(mapExploreItemToTitleCard);
	},
	{ initialData: [], cacheMs: 15_000 }
);
