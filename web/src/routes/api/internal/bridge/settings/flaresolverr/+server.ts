import { proxyBridgeRequest } from '$lib/server/bridge-proxy';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) =>
	proxyBridgeRequest(event, 'settings/flaresolverr');

export const PUT: RequestHandler = async (event) =>
	proxyBridgeRequest(event, 'settings/flaresolverr', {
		method: 'PUT',
		body: await event.request.text(),
		headers: {
			'content-type': 'application/json'
		},
		timeoutMs: 30_000
	});
