import { describe, expect, it } from 'vitest';

import { selectScheduledChapterSyncProfiles } from './library_downloads';

describe('selectScheduledChapterSyncProfiles', () => {
	const now = 1_000;

	it('selects the oldest due profile per title and skips paused or future profiles', () => {
		const selected = selectScheduledChapterSyncProfiles(
			[
				{ libraryTitleId: 'title-a', paused: false, nextChapterSyncAt: 900 },
				{ libraryTitleId: 'title-a', paused: false, nextChapterSyncAt: 800 },
				{ libraryTitleId: 'title-b', paused: true, nextChapterSyncAt: 100 },
				{ libraryTitleId: 'title-c', paused: false, nextChapterSyncAt: 1_001 },
				{ libraryTitleId: 'title-d', paused: false, nextChapterSyncAt: undefined }
			],
			now,
			10
		);

		expect(selected.map((profile) => profile.libraryTitleId)).toEqual(['title-d', 'title-a']);
	});

	it('bounds the number of claimed titles', () => {
		const selected = selectScheduledChapterSyncProfiles(
			[
				{ libraryTitleId: 'first', paused: false, nextChapterSyncAt: 1 },
				{ libraryTitleId: 'second', paused: false, nextChapterSyncAt: 2 }
			],
			now,
			1
		);

		expect(selected.map((profile) => profile.libraryTitleId)).toEqual(['first']);
	});
});
