import { httpClient } from './client';
import { expectData, expectNoContent } from './errors';
import type { components } from './v2';

export type ExploreFeed = components['schemas']['ExploreFeed'];
export type ExploreCategory = components['schemas']['ExploreCategory'];
export type SourceSummary = components['schemas']['SourceSummary'];
export type ExploreTitleDetails = components['schemas']['ExploreTitleDetailsResource'];
export type ExploreSearchFilters = components['schemas']['SourcePreferencesResource'];

export type ExploreFeedQuery = {
	page?: number;
	limit?: number;
	source_id?: string | null;
	extension_pkg?: string[] | null;
};

export async function listSources(query?: {
	enabled?: boolean;
	supports_latest?: boolean | null;
}): Promise<SourceSummary[]> {
	return expectData(
		await httpClient.GET('/api/v2/explore/sources', { params: { query } }),
		'Unable to load explore sources'
	);
}

export async function listCategories(limit = 30): Promise<ExploreCategory[]> {
	return expectData(
		await httpClient.GET('/api/v2/explore/categories', { params: { query: { limit } } }),
		'Unable to load explore categories'
	);
}

export async function refreshExploreCache(pages = 2): Promise<void> {
	expectNoContent(
		await httpClient.POST('/api/v2/explore/refresh', { params: { query: { pages } } }),
		'Unable to refresh explore cache'
	);
}

export async function getPopularFeed(query?: ExploreFeedQuery): Promise<ExploreFeed> {
	return expectData(
		await httpClient.GET('/api/v2/explore/popular', { params: { query } }),
		'Unable to load popular feed'
	);
}

export async function getLatestFeed(query?: ExploreFeedQuery): Promise<ExploreFeed> {
	return expectData(
		await httpClient.GET('/api/v2/explore/latest', { params: { query } }),
		'Unable to load latest feed'
	);
}

export async function searchFeed(params: {
	query: string;
	page?: number;
	limit?: number;
	source_id?: string | null;
	extension_pkg?: string[] | null;
	category?: string | null;
	search_filters_json?: string | null;
}): Promise<ExploreFeed> {
	return expectData(
		await httpClient.GET('/api/v2/explore/search', { params: { query: params } }),
		'Unable to search explore feed'
	);
}

export async function getSearchFilters(params: {
	source_id: string;
}): Promise<ExploreSearchFilters> {
	return expectData(
		await httpClient.GET('/api/v2/explore/search-filters', { params: { query: params } }),
		'Unable to load search filters'
	);
}

export async function getCategoryFeed(params: {
	name: string;
	page?: number;
	limit?: number;
	source_id?: string | null;
	extension_pkg?: string[] | null;
}): Promise<ExploreFeed> {
	return expectData(
		await httpClient.GET('/api/v2/explore/category', { params: { query: params } }),
		'Unable to load category feed'
	);
}

export async function getTitleDetails(params: {
	source_id: string;
	title_url: string;
	refresh?: boolean;
}): Promise<ExploreTitleDetails> {
	return expectData(
		await httpClient.GET('/api/v2/explore/title-details', { params: { query: params } }),
		'Unable to load title details'
	);
}
