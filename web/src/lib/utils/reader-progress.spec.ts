import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getReaderProgress, setReaderProgress } from './reader-progress';

function createStorage() {
	const storage = new Map<string, string>();
	return {
		getItem(key: string) {
			return storage.has(key) ? storage.get(key)! : null;
		},
		setItem(key: string, value: string) {
			storage.set(key, value);
		},
		removeItem(key: string) {
			storage.delete(key);
		},
		clear() {
			storage.clear();
		}
	};
}

describe('reader progress', () => {
	beforeEach(() => {
		Object.defineProperty(globalThis, 'window', {
			value: { localStorage: createStorage() },
			configurable: true
		});
	});

	afterEach(() => {
		Reflect.deleteProperty(globalThis, 'window');
	});

	it('persists the latest page index for a chapter', () => {
		setReaderProgress('chapter-1', 23);
		expect(getReaderProgress('chapter-1')).toBe(23);
	});

	it('returns null for missing or invalid stored progress', () => {
		expect(getReaderProgress('missing')).toBeNull();
		window.localStorage.setItem('mangarr:reader-progress:broken', 'not-a-number');
		expect(getReaderProgress('broken')).toBeNull();
	});
});
