import { describe, expect, it } from 'vitest';

import { cacheTtlMs, isCacheableSourceRead } from './bridge_workpool';

describe('bridge Workpool source cache decisions', () => {
	it('uses sensible TTLs for source reads', () => {
		expect(cacheTtlMs('explore.title.fetch')).toBe(6 * 60 * 60 * 1000);
		expect(cacheTtlMs('explore.popular')).toBe(10 * 60 * 1000);
		expect(cacheTtlMs('explore.latest')).toBe(10 * 60 * 1000);
		expect(cacheTtlMs('explore.search')).toBe(5 * 60 * 1000);
		expect(cacheTtlMs('explore.chapters.fetch')).toBe(15 * 60 * 1000);
		expect(cacheTtlMs('reader.pages.fetch')).toBe(30 * 60 * 1000);
	});

	it('caches only idempotent source reads', () => {
		expect(isCacheableSourceRead('explore.search')).toBe(true);
		expect(isCacheableSourceRead('reader.pages.fetch')).toBe(true);
		expect(isCacheableSourceRead('library.import')).toBe(false);
		expect(isCacheableSourceRead('downloads.chapter')).toBe(false);
		expect(isCacheableSourceRead('library.title.stats.refresh')).toBe(false);
	});
});
