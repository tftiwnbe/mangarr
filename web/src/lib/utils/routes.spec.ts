import { describe, expect, it } from 'vitest';

import {
	buildReaderPath,
	buildTitlePath,
	parseReaderChapterParam,
	parseTitleRouteParam
} from './routes';
import { buildTitleRouteBaseFromUrl, slugifySegment } from './route-segments';

describe('routes', () => {
	it('slugifies readable title segments', () => {
		expect(slugifySegment('Sophisticated Senpai')).toBe('sophisticated-senpai');
		expect(slugifySegment('Человек-бензопила')).toBe('chelovek-benzopila');
	});

	it('builds title route bases from bridge title urls', () => {
		expect(buildTitleRouteBaseFromUrl('/manga/77bee52c-d2d6-44ad-a33a-1734c1fe696a')).toBe(
			'77bee52c-d2d6-44ad-a33a-1734c1fe696a'
		);
		expect(buildTitleRouteBaseFromUrl('https://site.test/title/chainsaw-man')).toBe('chainsaw-man');
	});

	it('builds and parses title routes with route segments', () => {
		const path = buildTitlePath('ignored', 'Chainsaw Man');
		expect(path).toBe('/title/ignored');
		expect(parseTitleRouteParam('ignored')).toBe('ignored');
	});

	it('builds reader routes with chapter number and name context', () => {
		const path = buildReaderPath({
			titleId: 'title-id',
			titleName: 'Sophisticated Senpai',
			chapterId: 'chapter-id',
			chapterName: 'Chapter 1 - Meet Cute',
			chapterNumber: 1
		});

		expect(path).toBe('/reader/title-id/ch-1');
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
