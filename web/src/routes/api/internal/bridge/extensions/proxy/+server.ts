import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { proxyBridgeRequest } from '$lib/server/bridge-proxy';

export const PUT: RequestHandler = async (event) => {
	const payload = await event.request.text();
	const response = await proxyBridgeRequest(event, 'extensions/proxy', {
		method: 'PUT',
		body: payload,
		headers: { 'content-type': 'application/json' }
	});

	if (response.headers.get('content-type')?.includes('application/json')) {
		return response;
	}

	return json({ ok: response.ok }, { status: response.status });
};
