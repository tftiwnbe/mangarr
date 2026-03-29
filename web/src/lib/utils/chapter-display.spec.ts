import { describe, expect, it } from 'vitest';

import {
	formatChapterNumberValue,
	hasDisplayableChapterNumber,
	parseStructuredChapterName
} from './chapter-display';

describe('chapter display', () => {
	it('rejects negative chapter numbers', () => {
		expect(hasDisplayableChapterNumber(-1)).toBe(false);
		expect(hasDisplayableChapterNumber(0)).toBe(true);
	});

	it('normalizes integer-like chapter numbers', () => {
		expect(formatChapterNumberValue(97)).toBe('97');
		expect(formatChapterNumberValue('97.0')).toBe('97');
		expect(formatChapterNumberValue(97.5)).toBe('97.5');
	});

	it('extracts volume, chapter, and detail from structured names', () => {
		expect(parseStructuredChapterName('Vol.11 Ch.97 - Love, Love, Chainsaw.')).toEqual({
			volumeNumber: '11',
			chapterNumber: '97',
			detail: 'Love, Love, Chainsaw.'
		});
	});

	it('ignores chapter names that do not have a valid structured prefix', () => {
		expect(parseStructuredChapterName('Special bonus story')).toBeNull();
	});
});
