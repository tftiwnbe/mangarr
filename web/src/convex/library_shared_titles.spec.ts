import { describe, expect, it } from 'vitest';

import { pickStablePreferredTitle } from './library_shared_titles';

describe('preferred title stability', () => {
	it('keeps the existing canonical title when switching preferred variants', () => {
		expect(
			pickStablePreferredTitle(
				'Питомец злодейки',
				'The Pet of the Villainess',
				'Питомец злодейки'
			)
		).toBe('The Pet of the Villainess');
	});

	it('falls back to the preferred variant title when the current title is missing', () => {
		expect(pickStablePreferredTitle('', '', 'Питомец злодейки')).toBe('Питомец злодейки');
	});
});
