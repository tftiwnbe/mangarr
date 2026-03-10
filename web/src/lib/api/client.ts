import createClient from 'openapi-fetch';

import { API_BASE_URL } from './config';
import type { paths } from './v2';

const apiFetch: typeof fetch = async (input, init) => {
	const headers = new Headers(init?.headers);
	if (!headers.has('Accept')) {
		headers.set('Accept', 'application/json');
	}
	return fetch(input, {
		...init,
		headers,
		credentials: init?.credentials ?? 'include'
	});
};

export const httpClient = createClient<paths>({
	baseUrl: API_BASE_URL || undefined,
	fetch: apiFetch
});
