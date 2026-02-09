import createClient from 'openapi-fetch';

import { API_BASE_URL } from './config';
import { getAuthorizationHeader } from './session';
import type { paths } from './v2';

const apiFetch: typeof fetch = async (input, init) => {
	const headers = new Headers(init?.headers);
	if (!headers.has('Accept')) {
		headers.set('Accept', 'application/json');
	}
	if (!headers.has('Authorization') && !headers.has('X-API-Key')) {
		const authorizationHeader = getAuthorizationHeader();
		if (authorizationHeader) {
			headers.set('Authorization', authorizationHeader);
		}
	}
	return fetch(input, {
		...init,
		headers
	});
};

export const httpClient = createClient<paths>({
	baseUrl: API_BASE_URL || undefined,
	fetch: apiFetch
});
