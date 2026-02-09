import { httpClient } from './client';
import { expectData } from './errors';
import type { components } from './v2';

export type DiscoverFeed = components['schemas']['DiscoverFeed'];
export type DiscoverCategory = components['schemas']['DiscoverCategory'];
export type SourceSummary = components['schemas']['SourceSummary'];

export type DiscoverFeedQuery = {
	page?: number;
	limit?: number;
	source_id?: string | null;
};

export async function listSources(query?: {
	enabled?: boolean;
	supports_latest?: boolean | null;
}): Promise<SourceSummary[]> {
	return expectData(
		await httpClient.GET('/api/v2/discover/sources', { params: { query } }),
		'Unable to load discover sources'
	);
}

export async function listCategories(limit = 30): Promise<DiscoverCategory[]> {
	return expectData(
		await httpClient.GET('/api/v2/discover/categories', { params: { query: { limit } } }),
		'Unable to load discover categories'
	);
}

export async function refreshDiscoverCache(pages = 2): Promise<unknown> {
	return expectData(
		await httpClient.POST('/api/v2/discover/refresh', { params: { query: { pages } } }),
		'Unable to refresh discover cache'
	);
}

export async function getPopularFeed(query?: DiscoverFeedQuery): Promise<DiscoverFeed> {
	return expectData(
		await httpClient.GET('/api/v2/discover/popular', { params: { query } }),
		'Unable to load popular feed'
	);
}

export async function getLatestFeed(query?: DiscoverFeedQuery): Promise<DiscoverFeed> {
	return expectData(
		await httpClient.GET('/api/v2/discover/latest', { params: { query } }),
		'Unable to load latest feed'
	);
}

export async function searchFeed(params: {
	query: string;
	page?: number;
	limit?: number;
	source_id?: string | null;
}): Promise<DiscoverFeed> {
	return expectData(
		await httpClient.GET('/api/v2/discover/search', { params: { query: params } }),
		'Unable to search discover feed'
	);
}

export async function getCategoryFeed(params: {
	name: string;
	page?: number;
	limit?: number;
	source_id?: string | null;
}): Promise<DiscoverFeed> {
	return expectData(
		await httpClient.GET('/api/v2/discover/category', { params: { query: params } }),
		'Unable to load category feed'
	);
}
