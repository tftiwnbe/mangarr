export const LIBRARY_PAGE_SIZE_MAX = 128;

function boundedInteger(value: number | undefined, fallback: number, minimum: number) {
	const candidate = value === undefined || !Number.isFinite(value) ? fallback : Math.floor(value);
	return Math.min(Math.max(minimum, candidate), LIBRARY_PAGE_SIZE_MAX);
}

export function normalizeLibraryPageSize(value: number) {
	return boundedInteger(value, LIBRARY_PAGE_SIZE_MAX, 1);
}

export function normalizeLegacyLibraryWindow(
	limit: number | undefined,
	offset: number | undefined
) {
	return {
		limit: boundedInteger(limit, LIBRARY_PAGE_SIZE_MAX, 1),
		offset: boundedInteger(offset, 0, 0)
	};
}
