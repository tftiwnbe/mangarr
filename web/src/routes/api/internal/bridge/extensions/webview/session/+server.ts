import type { RequestHandler } from './$types';

import { proxyBridgeRequest } from '$lib/server/bridge-proxy';

export const POST: RequestHandler = async (event) =>
	proxyBridgeRequest(event, 'extensions/webview/session', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: await event.request.text(),
		timeoutMs: 30_000
	});
