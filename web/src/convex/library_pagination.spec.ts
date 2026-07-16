import { describe, expect, it } from 'vitest';

import {
	LIBRARY_PAGE_SIZE_MAX,
	normalizeLegacyLibraryWindow,
	normalizeLibraryPageSize
} from './library_pagination';

describe('library pagination bounds', () => {
	it('caps paginated reads regardless of the requested page size', () => {
		expect(normalizeLibraryPageSize(0)).toBe(1);
		expect(normalizeLibraryPageSize(96.8)).toBe(96);
		expect(normalizeLibraryPageSize(10_000)).toBe(LIBRARY_PAGE_SIZE_MAX);
	});

	it('keeps the compatibility query within a bounded read window', () => {
		expect(normalizeLegacyLibraryWindow(undefined, undefined)).toEqual({
			limit: LIBRARY_PAGE_SIZE_MAX,
			offset: 0
		});
		expect(normalizeLegacyLibraryWindow(5_000, 10_000)).toEqual({
			limit: LIBRARY_PAGE_SIZE_MAX,
			offset: LIBRARY_PAGE_SIZE_MAX
		});
		expect(normalizeLegacyLibraryWindow(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
			limit: LIBRARY_PAGE_SIZE_MAX,
			offset: 0
		});
	});
});
