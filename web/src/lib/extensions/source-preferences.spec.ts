import { describe, expect, it } from 'vitest';

import {
	buildPreferenceEntries,
	deletePreferenceValue,
	normalizeImportedStoragePayload,
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

	it('normalizes nested imported storage into string payloads', () => {
		expect(
			normalizeImportedStoragePayload({
				token: { token_type: 'Bearer', access_token: 'abc', expires_in: 2592000, timestamp: 123 },
				auth: { id: 7 }
			})
		).toEqual({
			token: JSON.stringify({
				token_type: 'Bearer',
				access_token: 'abc',
				expires_in: 2592000,
				timestamp: 123
			}),
			auth: JSON.stringify({ id: 7 }),
			bearer_token: 'abc',
			user_id: '7',
			expires_in: '2592000000',
			TokenStore: JSON.stringify({
				auth: { id: 7 },
				token: { token_type: 'Bearer', access_token: 'abc', expires_in: 2592000, timestamp: 123 }
			})
		});
	});

	it('strips bearer prefix when normalizing bearer token preference values', () => {
		expect(normalizePreferenceValue('bearer_token', 'Bearer abc')).toBe('abc');
		expect(normalizePreferenceValue('bearer_token', 'bearer abc')).toBe('abc');
		expect(normalizePreferenceValue('user_id', 'Bearer abc')).toBe('Bearer abc');
	});
});
