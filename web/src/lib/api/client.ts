import createClient from 'openapi-fetch';

import { API_BASE_URL } from './config';
import type { paths } from './v2';

const apiFetch: typeof fetch = async (input, init) => {
	const headers = new Headers(init?.headers);
	if (!headers.has('Accept')) {
		headers.set('Accept', 'application/json');
	}

	let body = init?.body;
	if (
		body &&
		typeof body === 'object' &&
		!(body instanceof FormData) &&
		!(body instanceof URLSearchParams) &&
		!(body instanceof Blob) &&
		!(body instanceof ArrayBuffer) &&
		!ArrayBuffer.isView(body)
	) {
		body = JSON.stringify(body);
		if (!headers.has('content-type')) {
			headers.set('content-type', 'application/json');
		}
	}

	return fetch(input, {
		...init,
		headers,
		body,
		credentials: init?.credentials ?? 'include'
	});
};

export const httpClient = createClient<paths>({
	baseUrl: API_BASE_URL || undefined,
	fetch: apiFetch
});
