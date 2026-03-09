/**
 * Numeric status codes used by the API for title publication status.
 * These map to the `status` field on library and explore title resources.
 */
export const TITLE_STATUS = {
	ONGOING: 1,
	COMPLETED: 2,
	COMPLETED_ALT: 4,
	HIATUS: 6
} as const;
