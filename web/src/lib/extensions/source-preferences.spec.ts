import { describe, expect, it } from 'vitest';

import {
	buildResetPreferenceEntries,
	buildPreferenceEntries,
	deletePreferenceValue,
	normalizePreferenceValue
} from './source-preferences';

describe('source preferences', () => {
	it('preserves unicode keys when building preference entries', () => {
		expect(buildPreferenceEntries([['Домен', 'hentailib.me']] as const)).toEqual([
			{ key: 'Домен', value: 'hentailib.me' }
		]);
	});

	it('uses the delete marker for null values', () => {
		expect(buildPreferenceEntries([['token', null]] as const)).toEqual([
			{ key: 'token', value: deletePreferenceValue() }
		]);
	});

	it('builds delete entries for resetting source preferences', () => {
		expect(
			buildResetPreferenceEntries({
				preferences: [
					{
						key: 'domain',
						title: 'Domain',
						type: 'list',
						enabled: true,
						visible: true
					},
					{
						key: 'token',
						title: 'Token',
						type: 'text',
						enabled: true,
						visible: false
					}
				]
			})
		).toEqual([
			{ key: 'domain', value: deletePreferenceValue() },
			{ key: 'token', value: deletePreferenceValue() }
		]);
	});

	it('strips bearer prefix when normalizing bearer token preference values', () => {
		expect(normalizePreferenceValue('bearer_token', 'Bearer abc')).toBe('abc');
		expect(normalizePreferenceValue('bearer_token', 'bearer abc')).toBe('abc');
		expect(normalizePreferenceValue('user_id', 'Bearer abc')).toBe('Bearer abc');
	});
});
