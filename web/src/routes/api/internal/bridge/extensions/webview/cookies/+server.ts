import type { RequestHandler } from './$types';

import { proxyBridgeRequest } from '$lib/server/bridge-proxy';

export const DELETE: RequestHandler = async (event) =>
	proxyBridgeRequest(event, 'extensions/webview/cookies', {
		method: 'DELETE',
		headers: { 'content-type': 'application/json' },
		body: await event.request.text(),
		timeoutMs: 30_000
	});
