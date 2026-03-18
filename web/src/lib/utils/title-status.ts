/**
 * Numeric status codes used by the legacy web-ref UI for title publication state.
 * The active backend may not populate these yet, but the library UI still uses
 * the same mapping when the data is present.
 */
export const TITLE_STATUS = {
	ONGOING: 1,
	COMPLETED: 2,
	COMPLETED_ALT: 4,
	HIATUS: 6
} as const;
