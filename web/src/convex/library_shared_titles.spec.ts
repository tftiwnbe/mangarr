import { describe, expect, it } from 'vitest';

import { applyVariantMetadataToTitle, pickStablePreferredTitle } from './library_shared_titles';

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
