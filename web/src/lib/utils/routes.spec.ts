import { describe, expect, it } from 'vitest';

import {
	buildReaderPath,
	buildTitlePath,
	parseReaderChapterParam,
	parseTitleRouteParam
} from './routes';
import { buildTitleRouteBaseFromUrl, normalizeSourceUrlPath, slugifySegment } from './route-segments';

describe('routes', () => {
	it('slugifies readable title segments', () => {
		expect(slugifySegment('Sophisticated Senpai')).toBe('sophisticated-senpai');
		expect(slugifySegment('Человек-бензопила')).toBe('chelovek-benzopila');
	});

	it('builds title route bases from bridge title urls', () => {
		expect(
			buildTitleRouteBaseFromUrl(
				'/manga/77bee52c-d2d6-44ad-a33a-1734c1fe696a',
				'Placeholder title'
			)
		).toBe('placeholder-title');
		expect(buildTitleRouteBaseFromUrl('https://site.test/title/chainsaw-man')).toBe('chainsaw-man');
	});

	it('prefers readable fallback title slugs when source urls are opaque', () => {
		expect(
			buildTitleRouteBaseFromUrl(
				'https://cubari.moe/read/gist/cmF3L3RvdHN1bG92ZXJ5dXJpL01vbmFUTHMvcmVmcy9oZWFkcy9tYWluL2NyaW1lLXl1cmkvbWFuZ2EuanNvbg/',
				'Tsumi ni Oboreru Crime Yuri Anthology'
			)
		).toBe('tsumi-ni-oboreru-crime-yuri-anthology');
		expect(
			buildTitleRouteBaseFromUrl(
				'https://reader.example/content/manga.json',
				'Tsumi ni Oboreru Crime Yuri Anthology'
			)
		).toBe('tsumi-ni-oboreru-crime-yuri-anthology');
	});

	it('normalizes malformed source url paths before routing or storage', () => {
		expect(normalizeSourceUrlPath('/read/gist/token//4/0')).toBe('/read/gist/token/4/0');
		expect(normalizeSourceUrlPath('https://cubari.moe/read/gist/token//4/0?quality=high')).toBe(
			'https://cubari.moe/read/gist/token/4/0?quality=high'
		);
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
