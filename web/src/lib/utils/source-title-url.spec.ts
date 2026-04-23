import { describe, expect, it } from 'vitest';

import {
	directSourceTitleUrlCandidates,
	looksLikeDirectSourceTitleInput
} from './source-title-url';

describe('source title URL input normalization', () => {
	it('strips the origin from pasted source URLs', () => {
		expect(
			directSourceTitleUrlCandidates('https://inkstory.net/content/the-pet-of-the-villainess')
		).toEqual(['/content/the-pet-of-the-villainess']);
	});

	it('accepts source-relative title paths without a leading slash', () => {
		expect(directSourceTitleUrlCandidates('content/the-pet-of-the-villainess')).toEqual([
			'/content/the-pet-of-the-villainess'
		]);
	});

	it('accepts source-relative title paths with a leading slash', () => {
		expect(directSourceTitleUrlCandidates('/content/the-pet-of-the-villainess')).toEqual([
			'/content/the-pet-of-the-villainess'
		]);
	});

	it('does not treat normal free-text search as a direct source title URL', () => {
		expect(looksLikeDirectSourceTitleInput('the pet of the villainess')).toBe(false);
		expect(looksLikeDirectSourceTitleInput('the-pet-of-the-villainess')).toBe(false);
	});
});
