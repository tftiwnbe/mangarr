import { describe, expect, it } from 'vitest';

import { pickStorageTitleBase } from './storage_names';

describe('pickStorageTitleBase', () => {
	it('prefers a latin variant title over transliteration', () => {
		expect(
			pickStorageTitleBase({
				canonicalTitle: 'Перезапуск Леди',
				canonicalTitleUrl: '/manga/restart-ledi',
				variants: [{ title: 'Restart Lady', titleUrl: '/manga/restart-lady' }]
			})
		).toBe('Restart Lady');
	});

	it('prefers transliterated title text over a readable url slug when all titles are non-latin', () => {
		expect(
			pickStorageTitleBase({
				canonicalTitle: 'Перезапуск Леди',
				canonicalTitleUrl: '/manga/restart-ledi',
				variants: [{ title: 'Перезапуск Леди', titleUrl: '/manga/restart-ledi' }]
			})
		).toBe('Perezapusk Ledi');
	});

	it('ignores opaque ids in urls', () => {
		expect(
			pickStorageTitleBase({
				canonicalTitle: 'Способ защитить тебя, дорогой',
				canonicalTitleUrl: '/manga/77bee52c-d2d6-44ad-a33a-1734c1fe696a',
				variants: []
			})
		).toBe("Sposob zashchitit' tebya, dorogoy");
	});
});
