/**
 * Shared TTL values for async resource stores.
 * All values are in milliseconds.
 */
export const CACHE_MS = {
	/** Short-lived data that changes frequently (downloads, active tasks). */
	SHORT: 5_000,
	/** Library titles — updated by user actions or WS invalidation. */
	LIBRARY: 30_000,
	/** Individual title detail + chapters. */
	TITLE_DETAIL: 10_000,
	/** Explore feeds (popular, latest). */
	EXPLORE_FEED: 60_000,
	/** Explore sources list — rarely changes. */
	EXPLORE_SOURCES: 120_000,
	/** Explore search results. */
	EXPLORE_SEARCH: 15_000
} as const;

/** Timeout for individual API calls that may be slow (title detail, chapters). */
export const REQUEST_TIMEOUT_MS = 12_000;
