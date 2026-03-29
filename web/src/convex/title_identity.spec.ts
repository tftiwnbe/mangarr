import { describe, expect, it } from 'vitest';

import { pickBestMergeCandidate, scoreMergeSnapshot, titleUrlIdentity } from './title_identity';

describe('title identity matching', () => {
	it('extracts stable title identities from source urls', () => {
		expect(titleUrlIdentity('/manga/77bee52c-d2d6-44ad-a33a-1734c1fe696a')).toBe(
			'manga/77bee52c-d2d6-44ad-a33a-1734c1fe696a'
		);
		expect(titleUrlIdentity('https://site.test/title/123456')).toBe('title/123456');
	});

	it('strongly matches same-package url identities across source variants', () => {
		expect(
			scoreMergeSnapshot(
				{
					title: 'The Eminence in Shadow',
					sourcePkg: 'eu.kanade.tachiyomi.extension.all.mangadex',
					sourceLang: 'en',
					titleUrl: '/manga/77bee52c-d2d6-44ad-a33a-1734c1fe696a'
				},
				{
					title: 'Kage no Jitsuryokusha ni Naritakute!',
					sourcePkg: 'eu.kanade.tachiyomi.extension.all.mangadex',
					sourceLang: 'ru',
					titleUrl: '/manga/77bee52c-d2d6-44ad-a33a-1734c1fe696a'
				}
			)
		).toBeGreaterThanOrEqual(260);
	});

	it('merges exact title-author matches across sources', () => {
		const best = pickBestMergeCandidate(
			{
				title: 'Chainsaw Man',
				author: 'Fujimoto Tatsuki',
				sourcePkg: 'source.b',
				sourceLang: 'en',
				titleUrl: '/work/chainsaw-man'
			},
			[
				{
					item: 'match',
					snapshots: [
						{
							title: 'Chainsaw Man',
							author: 'Fujimoto Tatsuki',
							sourcePkg: 'source.a',
							sourceLang: 'en',
							titleUrl: '/title/other'
						}
					]
				},
				{
					item: 'different',
					snapshots: [
						{
							title: 'Fire Punch',
							author: 'Fujimoto Tatsuki',
							sourcePkg: 'source.a',
							sourceLang: 'en',
							titleUrl: '/title/fire-punch'
						}
					]
				}
			]
		);

		expect(best?.item).toBe('match');
		expect(best?.score ?? 0).toBeGreaterThanOrEqual(190);
	});

	it('stays conservative on weak title-only collisions', () => {
		const best = pickBestMergeCandidate(
			{
				title: 'Hero',
				sourcePkg: 'source.b',
				sourceLang: 'en',
				titleUrl: '/titles/hero'
			},
			[
				{
					item: 'collision',
					snapshots: [
						{
							title: 'Hero',
							sourcePkg: 'source.a',
							sourceLang: 'en',
							titleUrl: '/titles/hero-other'
						}
					]
				}
			]
		);

		expect(best).toBeNull();
	});

	it('merges same-title edition variants when contributors also match', () => {
		const best = pickBestMergeCandidate(
			{
				title: 'One Piece',
				author: 'Eiichiro Oda',
				sourcePkg: 'source.b',
				sourceLang: 'en',
				titleUrl: '/titles/one-piece'
			},
			[
				{
					item: 'match',
					snapshots: [
						{
							title: 'One Piece (Official Colored Edition)',
							author: 'Eiichiro Oda',
							sourcePkg: 'source.a',
							sourceLang: 'en',
							titleUrl: '/titles/one-piece-colored'
						}
					]
				}
			]
		);

		expect(best?.item).toBe('match');
		expect(best?.score ?? 0).toBeGreaterThanOrEqual(190);
	});

	it('stays conservative on edition-noise title matches without other signals', () => {
		const best = pickBestMergeCandidate(
			{
				title: 'One Piece',
				sourcePkg: 'source.b',
				sourceLang: 'en',
				titleUrl: '/titles/one-piece'
			},
			[
				{
					item: 'too-weak',
					snapshots: [
						{
							title: 'One Piece (Official Colored Edition)',
							sourcePkg: 'source.a',
							sourceLang: 'en',
							titleUrl: '/titles/one-piece-colored'
						}
					]
				}
			]
		);

		expect(best).toBeNull();
	});
});
