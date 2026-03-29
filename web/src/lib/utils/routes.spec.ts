import { describe, expect, it } from 'vitest';

import {
	buildReaderPath,
	buildTitlePath,
	parseReaderChapterParam,
	parseTitleRouteParam
} from './routes';
import { slugifySegment } from './route-segments';

describe('routes', () => {
	it('slugifies readable title segments', () => {
		expect(slugifySegment('Sophisticated Senpai')).toBe('sophisticated-senpai');
		expect(slugifySegment('Человек-бензопила')).toBe('chelovek-benzopila');
	});

	it('builds and parses title routes with slugs', () => {
		const path = buildTitlePath('ignored', 'Chainsaw Man');
		expect(path).toBe('/title/chainsaw-man');
		expect(parseTitleRouteParam('chainsaw-man')).toBe('chainsaw-man');
	});

	it('builds reader routes with chapter number and name context', () => {
		const path = buildReaderPath({
			titleName: 'Sophisticated Senpai',
			chapterName: 'Chapter 1 - Meet Cute',
			chapterNumber: 1
		} as never);

		expect(path).toBe('/reader/sophisticated-senpai/ch-1');
		expect(parseReaderChapterParam('ch-1')).toBe('ch-1');
	});

	it('uses explicit disambiguated route segments when supplied', () => {
		const path = buildReaderPath({
			titleId: 'ignored',
			titleName: 'One Piece',
			titleRouteSegment: 'one-piece~krce',
			chapterId: 'ignored',
			chapterName: 'Chapter 1',
			chapterNumber: 1,
			chapterRouteSegment: 'ch-1~abcd12'
		});

		expect(path).toBe('/reader/one-piece~krce/ch-1~abcd12');
	});
});
