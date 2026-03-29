import { describe, expect, it } from 'vitest';

import {
	buildPreferenceEntries,
	deletePreferenceValue,
	normalizeImportedStoragePayload
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
				TokenStore: { auth: { id: 7 }, token: { access_token: 'abc' } }
			})
		).toEqual({
			TokenStore: JSON.stringify({ auth: { id: 7 }, token: { access_token: 'abc' } })
		});
	});
});
