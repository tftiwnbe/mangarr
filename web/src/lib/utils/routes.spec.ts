import { describe, expect, it } from 'vitest';

import {
	buildReaderPath,
	buildTitlePath,
	parseReaderChapterParam,
	parseTitleRouteParam,
	slugifySegment
} from './routes';

describe('routes', () => {
	it('slugifies readable title segments', () => {
		expect(slugifySegment('Sophisticated Senpai')).toBe('sophisticated-senpai');
		expect(slugifySegment('Человек-бензопила')).toBe('chelovek-benzopila');
	});

	it('builds and parses title routes with slugs', () => {
		const path = buildTitlePath('k171kyync164t0ajv300caekj583nm1y', 'Chainsaw Man');
		expect(path).toBe('/title/chainsaw-man~k171kyync164t0ajv300caekj583nm1y');
		expect(parseTitleRouteParam('chainsaw-man~k171kyync164t0ajv300caekj583nm1y')).toBe(
			'k171kyync164t0ajv300caekj583nm1y'
		);
	});

	it('keeps parsing legacy title routes', () => {
		expect(parseTitleRouteParam('k171kyync164t0ajv300caekj583nm1y--chainsaw-man')).toBe(
			'k171kyync164t0ajv300caekj583nm1y'
		);
	});

	it('builds reader routes with chapter number and name context', () => {
		const path = buildReaderPath({
			titleId: 'title123',
			titleName: 'Sophisticated Senpai',
			chapterId: 'chapter456',
			chapterName: 'Chapter 1 - Meet Cute',
			chapterNumber: 1
		});

		expect(path).toBe('/reader/sophisticated-senpai~title123/ch-1~chapter456');
		expect(parseReaderChapterParam('ch-1~chapter456')).toBe('chapter456');
	});

	it('keeps parsing legacy reader chapter routes', () => {
		expect(parseReaderChapterParam('chapter456--chapter-1-chapter-1-meet-cute')).toBe('chapter456');
	});
});
