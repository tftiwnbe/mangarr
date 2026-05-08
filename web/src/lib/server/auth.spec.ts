import { describe, expect, it } from 'vitest';

import { isSecureRequest } from './auth';

function eventFor(url: string, headers?: HeadersInit) {
	return {
		url: new URL(url),
		request: new Request(url, { headers })
	};
}

describe('isSecureRequest', () => {
	it('treats direct https requests as secure', () => {
		expect(isSecureRequest(eventFor('https://mangarr.test/login'))).toBe(true);
	});

	it('trusts forwarded proto from a reverse proxy', () => {
		expect(
			isSecureRequest(
				eventFor('http://127.0.0.1:3737/login', {
					'x-forwarded-proto': 'https'
				})
			)
		).toBe(true);
		expect(
			isSecureRequest(
				eventFor('http://127.0.0.1:3737/login', {
					forwarded: 'for=192.0.2.1;proto=https;host=mangarr.example.com'
				})
			)
		).toBe(true);
	});

	it('keeps plain http requests non-secure without proxy hints', () => {
		expect(isSecureRequest(eventFor('http://127.0.0.1:3737/login'))).toBe(false);
	});
});
