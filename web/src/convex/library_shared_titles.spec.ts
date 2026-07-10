import { describe, expect, it } from 'vitest';

import {
	applyVariantMetadataToTitle,
	hasPersistentLibraryListingSignal,
	pickStablePreferredTitle,
	updateTitleChapterStatsIncremental
} from './library_shared_titles';

describe('preferred title stability', () => {
	it('keeps the existing canonical title when switching preferred variants', () => {
		expect(
			pickStablePreferredTitle('Питомец злодейки', 'The Pet of the Villainess', 'Питомец злодейки')
		).toBe('The Pet of the Villainess');
	});

	it('falls back to the preferred variant title when the current title is missing', () => {
		expect(pickStablePreferredTitle('', '', 'Питомец злодейки')).toBe('Питомец злодейки');
	});

	it('does not rewrite stable title identity when applying preferred variant metadata', async () => {
		let patch: Record<string, unknown> | null = null;
		const ctx = {
			db: {
				patch: async (_id: string, value: Record<string, unknown>) => {
					patch = value;
				}
			}
		};

		await applyVariantMetadataToTitle(ctx as never, 'title-id' as never, {
			author: 'Author',
			preferredVariantId: 'variant-id' as never,
			now: 123
		});

		expect(patch).toEqual({
			author: 'Author',
			preferredVariantId: 'variant-id',
			updatedAt: 123
		});
		expect(patch).not.toHaveProperty('title');
		expect(patch).not.toHaveProperty('routeBase');
		expect(patch).not.toHaveProperty('sourceId');
		expect(patch).not.toHaveProperty('titleUrl');
	});
});

describe('library listing signals', () => {
	it('treats empty imported titles as unanchored', () => {
		expect(hasPersistentLibraryListingSignal({})).toBe(false);
	});

	it('keeps titles listed when user engagement still exists', () => {
		expect(hasPersistentLibraryListingSignal({ userStatusId: 'status-id' as never })).toBe(true);
		expect(hasPersistentLibraryListingSignal({ userRating: 4 })).toBe(true);
		expect(hasPersistentLibraryListingSignal({ downloadedChapterCount: 1 })).toBe(true);
	});

	it('does not treat read history alone as library membership', () => {
		expect(hasPersistentLibraryListingSignal({ lastReadAt: 123 } as never)).toBe(false);
	});
});

describe('incremental title download stats', () => {
	it('keeps denormalized status counts and downloaded bytes aligned through transitions', async () => {
		const title = {
			queuedChapterCount: 0,
			downloadingChapterCount: 0,
			downloadedChapterCount: 0,
			failedChapterCount: 0,
			downloadedChapterBytes: 0
		};
		const ctx = {
			db: {
				get: async () => title,
				patch: async (_id: string, patch: Record<string, number>) => Object.assign(title, patch)
			}
		};

		const update = (
			oldStatus: string | undefined,
			newStatus: string,
			oldBytes?: number,
			newBytes?: number
		) =>
			updateTitleChapterStatsIncremental(
				ctx as never,
				'title-id' as never,
				oldStatus,
				newStatus,
				oldBytes,
				newBytes,
				123
			);

		await update('missing', 'queued');
		expect(title).toMatchObject({ queuedChapterCount: 1, downloadedChapterBytes: 0 });

		await update('queued', 'downloading');
		expect(title).toMatchObject({ queuedChapterCount: 0, downloadingChapterCount: 1 });

		await update('downloading', 'downloaded', undefined, 128);
		expect(title).toMatchObject({
			downloadingChapterCount: 0,
			downloadedChapterCount: 1,
			downloadedChapterBytes: 128
		});

		await update('downloaded', 'downloaded', 128, 256);
		expect(title).toMatchObject({ downloadedChapterCount: 1, downloadedChapterBytes: 256 });

		await update('downloaded', 'failed', 256, 256);
		expect(title).toMatchObject({
			downloadedChapterCount: 0,
			failedChapterCount: 1,
			downloadedChapterBytes: 0
		});

		await update('failed', 'missing');
		expect(title).toMatchObject({
			queuedChapterCount: 0,
			downloadingChapterCount: 0,
			downloadedChapterCount: 0,
			failedChapterCount: 0,
			downloadedChapterBytes: 0
		});
	});
});
