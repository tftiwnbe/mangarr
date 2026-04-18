import { describe, expect, it } from 'vitest';

import {
	computeDiscoveryFailureState,
	computeDiscoverySuccessState,
	discoveryMaxPage,
	discoveryPairKey,
	isDiscoveryMetadataRecommendationStrong,
	isDiscoveryRecommendationStrong,
	nextDiscoveryPage,
	rankForYouCandidate,
	rankSimilarCandidate,
	scoreSeedWeight
} from './discovery_shared';

describe('discovery shared helpers', () => {
	it('rotates discovery pages with deep popular crawl and shallow latest crawl', () => {
		expect(discoveryMaxPage('popular')).toBe(100);
		expect(discoveryMaxPage('latest')).toBe(6);
		expect(nextDiscoveryPage('popular', 1, true)).toBe(2);
		expect(nextDiscoveryPage('popular', 100, true)).toBe(1);
		expect(nextDiscoveryPage('latest', 1, true)).toBe(2);
		expect(nextDiscoveryPage('latest', 5, true)).toBe(6);
		expect(nextDiscoveryPage('latest', 6, true)).toBe(1);
		expect(nextDiscoveryPage('latest', 1, false)).toBe(1);
	});

	it('computes feed-specific success cooldowns', () => {
		const popular = computeDiscoverySuccessState({
			feedType: 'popular',
			page: 2,
			hasNextPage: true,
			now: 1_000
		});
		const latest = computeDiscoverySuccessState({
			feedType: 'latest',
			page: 6,
			hasNextPage: true,
			now: 1_000
		});

		expect(popular.nextPage).toBe(3);
		expect(latest.nextPage).toBe(1);
		expect(popular.dueAt - 1_000).toBe(24 * 60 * 60 * 1000);
		expect(latest.dueAt - 1_000).toBe(8 * 60 * 60 * 1000);
	});

	it('backs discovery failures off conservatively and respects retry-after', () => {
		const state = computeDiscoveryFailureState({
			now: 10_000,
			consecutiveFailures: 1,
			retryAfterMs: 5 * 60 * 60 * 1000
		});

		expect(state.consecutiveFailures).toBe(2);
		expect(state.dueAt).toBe(10_000 + 5 * 60 * 60 * 1000);
		expect(state.cooldownUntil).toBe(state.dueAt);
	});

	it('builds stable pair keys independent of order', () => {
		expect(discoveryPairKey('b::/two', 'a::/one')).toBe('a::/one::b::/two');
		expect(discoveryPairKey('a::/one', 'b::/two')).toBe('a::/one::b::/two');
	});

	it('weights active and recently read seeds higher', () => {
		const reading = scoreSeedWeight({
			statusKey: 'reading',
			userRating: 4,
			lastReadAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
			now: Date.now()
		});
		const dropped = scoreSeedWeight({
			statusKey: 'dropped',
			userRating: 0,
			lastReadAt: null,
			now: Date.now()
		});

		expect(reading).toBeGreaterThan(dropped);
		expect(reading).toBeGreaterThan(5);
	});

	it('ranks closer and fresher candidates higher', () => {
		const now = Date.now();
		const strong = rankSimilarCandidate({
			anchor: {
				title: 'Chainsaw Man',
				author: 'Fujimoto Tatsuki',
				sourcePkg: 'source.a',
				sourceLang: 'en',
				titleUrl: '/title/chainsaw-man'
			},
			candidate: {
				title: 'Fire Punch',
				author: 'Fujimoto Tatsuki',
				sourcePkg: 'source.b',
				sourceLang: 'en',
				titleUrl: '/title/fire-punch',
				lastSeenAt: now - 2 * 24 * 60 * 60 * 1000
			},
			edge: {
				popularCount: 5,
				latestCount: 1,
				lastObservedAt: now - 2 * 24 * 60 * 60 * 1000
			},
			preferredLanguages: ['en'],
			now
		});
		const weak = rankSimilarCandidate({
			anchor: {
				title: 'Chainsaw Man',
				author: 'Fujimoto Tatsuki',
				sourcePkg: 'source.a',
				sourceLang: 'en',
				titleUrl: '/title/chainsaw-man'
			},
			candidate: {
				title: 'Random Anthology',
				author: 'Another Creator',
				sourcePkg: 'source.c',
				sourceLang: 'ja',
				titleUrl: '/title/random-anthology',
				lastSeenAt: now - 60 * 24 * 60 * 60 * 1000
			},
			edge: {
				popularCount: 1,
				latestCount: 0,
				lastObservedAt: now - 60 * 24 * 60 * 60 * 1000
			},
			preferredLanguages: ['en'],
			now
		});

		expect(strong).toBeGreaterThan(weak);
	});

	it('rejects weak co-occurrence matches as recommendations', () => {
		const now = Date.now();
		expect(
			isDiscoveryRecommendationStrong({
				anchor: {
					title: 'Chainsaw Man',
					author: 'Fujimoto Tatsuki',
					sourcePkg: 'source.a',
					sourceLang: 'en',
					titleUrl: '/title/chainsaw-man'
				},
				candidate: {
					title: 'Random Anthology',
					author: 'Another Creator',
					sourcePkg: 'source.c',
					sourceLang: 'ja',
					titleUrl: '/title/random-anthology',
					lastSeenAt: now - 60 * 24 * 60 * 60 * 1000
				},
				edge: {
					popularCount: 1,
					latestCount: 0,
					lastObservedAt: now - 60 * 24 * 60 * 60 * 1000
				},
				preferredLanguages: ['en'],
				now
			})
		).toBe(false);
	});

	it('keeps stronger recommendation candidates', () => {
		const now = Date.now();
		expect(
			isDiscoveryRecommendationStrong({
				anchor: {
					title: 'Chainsaw Man',
					author: 'Fujimoto Tatsuki',
					sourcePkg: 'source.a',
					sourceLang: 'en',
					titleUrl: '/title/chainsaw-man'
				},
				candidate: {
					title: 'Fire Punch',
					author: 'Fujimoto Tatsuki',
					sourcePkg: 'source.b',
					sourceLang: 'en',
					titleUrl: '/title/fire-punch',
					lastSeenAt: now - 2 * 24 * 60 * 60 * 1000
				},
				edge: {
					popularCount: 5,
					latestCount: 1,
					lastObservedAt: now - 2 * 24 * 60 * 60 * 1000
				},
				preferredLanguages: ['en'],
				now
			})
		).toBe(true);
	});

	it('allows strong metadata-only recommendation matches', () => {
		const now = Date.now();
		expect(
			isDiscoveryMetadataRecommendationStrong({
				anchor: {
					title: 'Chainsaw Man',
					author: 'Fujimoto Tatsuki',
					description: 'A violent action manga about devils, hunters, and survival.',
					genre: 'Action, Supernatural, Shounen',
					sourcePkg: 'source.a',
					sourceLang: 'en',
					titleUrl: '/title/chainsaw-man'
				},
				candidate: {
					title: 'Dandadan',
					author: 'Fujimoto Tatsuki',
					description: 'A chaotic supernatural action story with monsters, devils, and survival.',
					genre: 'Action, Supernatural, Shounen',
					sourcePkg: 'source.b',
					sourceLang: 'en',
					titleUrl: '/title/dandadan',
					lastSeenAt: now - 2 * 24 * 60 * 60 * 1000
				},
				preferredLanguages: ['en'],
				now
			})
		).toBe(true);
	});

	it('keeps metadata-only weak matches out of recommendations', () => {
		const now = Date.now();
		expect(
			isDiscoveryMetadataRecommendationStrong({
				anchor: {
					title: 'Chainsaw Man',
					author: 'Fujimoto Tatsuki',
					description: 'A violent action manga about devils, hunters, and survival.',
					genre: 'Action, Supernatural, Shounen',
					sourcePkg: 'source.a',
					sourceLang: 'en',
					titleUrl: '/title/chainsaw-man'
				},
				candidate: {
					title: 'Cooking Master',
					author: 'Another Creator',
					description: 'A heartwarming story about recipes and family meals.',
					genre: 'Slice of Life, Cooking',
					sourcePkg: 'source.b',
					sourceLang: 'en',
					titleUrl: '/title/cooking-master',
					lastSeenAt: now - 2 * 24 * 60 * 60 * 1000
				},
				preferredLanguages: ['en'],
				now
			})
		).toBe(false);
	});

	it('applies seed weight when ranking for-you candidates', () => {
		const baseArgs = {
			anchor: {
				title: 'Chainsaw Man',
				author: 'Fujimoto Tatsuki',
				sourcePkg: 'source.a',
				sourceLang: 'en',
				titleUrl: '/title/chainsaw-man'
			},
			candidate: {
				title: 'Fire Punch',
				author: 'Fujimoto Tatsuki',
				sourcePkg: 'source.b',
				sourceLang: 'en',
				titleUrl: '/title/fire-punch',
				lastSeenAt: Date.now()
			},
			edge: {
				popularCount: 3,
				latestCount: 1,
				lastObservedAt: Date.now()
			},
			preferredLanguages: ['en'],
			now: Date.now()
		};

		expect(rankForYouCandidate({ ...baseArgs, seedWeight: 5 })).toBeGreaterThan(
			rankForYouCandidate({ ...baseArgs, seedWeight: 1 })
		);
	});
});
