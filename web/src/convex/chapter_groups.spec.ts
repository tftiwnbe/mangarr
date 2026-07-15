import { describe, expect, it } from 'vitest';

import type { Id } from './_generated/dataModel';
import {
	buildChapterGroupKey,
	collapseChapterReleases,
	summarizeGroupedChapterStatuses
} from './chapter_groups';

describe('chapter group identity', () => {
	it('keeps url variants of the same numbered chapter in one group', () => {
		const groupKeyA = buildChapterGroupKey({
			chapterName: '',
			chapterNumber: 94
		});
		const groupKeyB = buildChapterGroupKey({
			chapterName: 'Том 2 Глава 94',
			chapterNumber: 94
		});

		expect(groupKeyA).toBe('chapter:94');
		expect(groupKeyB).toBe('chapter:94');
	});

	it('collapses alternate scanlator releases into one visible chapter', () => {
		const chapters = collapseChapterReleases([
			{
				_id: 'chapter_1' as Id<'libraryChapters'>,
				chapterGroupKey: 'chapter:94',
				chapterName: 'Том 2 Глава 94',
				chapterNumber: 94,
				scanlator: 'Sleeping Fairies',
				dateUpload: 1,
				sequence: 94,
				isAvailableFromSource: true,
				downloadStatus: 'missing' as const,
				downloadedPages: 0
			},
			{
				_id: 'chapter_2' as Id<'libraryChapters'>,
				chapterGroupKey: 'chapter:94',
				chapterName: 'Том 2 Глава 94',
				chapterNumber: 94,
				scanlator: 'WIF Clan',
				dateUpload: 2,
				sequence: 94,
				isAvailableFromSource: true,
				downloadStatus: 'downloaded' as const,
				downloadedPages: 52,
				localRelativePath: 'title/source/ch-94'
			}
		]);

		expect(chapters).toHaveLength(1);
		expect(chapters[0]?._id).toBe('chapter_2');
		expect(chapters[0]?.releaseCount).toBe(2);
		expect(chapters[0]?.scanlators).toEqual(['Sleeping Fairies', 'WIF Clan']);
		expect(chapters[0]?.downloadStatus).toBe('downloaded');
	});

	it('prefers a downloaded local release over a merely available remote release', () => {
		const chapters = collapseChapterReleases([
			{
				_id: 'chapter_remote' as Id<'libraryChapters'>,
				chapterGroupKey: 'chapter:94',
				chapterName: 'Том 2 Глава 94',
				chapterNumber: 94,
				scanlator: 'Remote Release',
				dateUpload: 2,
				sequence: 94,
				isAvailableFromSource: true,
				downloadStatus: 'missing' as const,
				downloadedPages: 0
			},
			{
				_id: 'chapter_local' as Id<'libraryChapters'>,
				chapterGroupKey: 'chapter:94',
				chapterName: 'Том 2 Глава 94',
				chapterNumber: 94,
				scanlator: 'Local Release',
				dateUpload: 1,
				sequence: 94,
				isAvailableFromSource: false,
				downloadStatus: 'downloaded' as const,
				downloadedPages: 52,
				localRelativePath: 'title/source/ch-94'
			}
		]);

		expect(chapters).toHaveLength(1);
		expect(chapters[0]?._id).toBe('chapter_local');
		expect(chapters[0]?.downloadStatus).toBe('downloaded');
		expect(chapters[0]?.localRelativePath).toBe('title/source/ch-94');
	});

	it('counts grouped download stats once per logical chapter', () => {
		const stats = summarizeGroupedChapterStatuses([
			{
				_id: 'chapter_1' as Id<'libraryChapters'>,
				chapterGroupKey: 'chapter:21',
				chapterName: 'Vol. 1 Ch. 21',
				chapterNumber: 21,
				scanlator: 'A',
				dateUpload: 1,
				sequence: 21,
				isAvailableFromSource: true,
				downloadStatus: 'missing' as const,
				downloadedPages: 0
			},
			{
				_id: 'chapter_2' as Id<'libraryChapters'>,
				chapterGroupKey: 'chapter:21',
				chapterName: 'Vol. 1 Ch. 21',
				chapterNumber: 21,
				scanlator: 'B',
				dateUpload: 2,
				sequence: 21,
				isAvailableFromSource: true,
				downloadStatus: 'downloaded' as const,
				downloadedPages: 12,
				fileSizeBytes: 1200
			},
			{
				_id: 'chapter_3' as Id<'libraryChapters'>,
				chapterGroupKey: 'chapter:22',
				chapterName: 'Vol. 1 Ch. 22',
				chapterNumber: 22,
				scanlator: 'A',
				dateUpload: 3,
				sequence: 22,
				isAvailableFromSource: true,
				downloadStatus: 'failed' as const,
				downloadedPages: 0
			}
		]);

		expect(stats.total).toBe(2);
		expect(stats.downloaded).toBe(1);
		expect(stats.failed).toBe(1);
		expect(stats.downloadedBytes).toBe(1200);
	});
});
