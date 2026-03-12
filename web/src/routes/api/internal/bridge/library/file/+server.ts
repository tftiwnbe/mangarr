import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { proxyBridgeRequest } from '$lib/server/bridge-proxy';

export const GET: RequestHandler = async (event) => {
	const path = event.url.searchParams.get('path')?.trim();
	const storage = event.url.searchParams.get('storage')?.trim();

	if (!path || !storage) {
		throw error(400, 'path and storage are required');
	}

	const upstream = new URL('assets/library/chapter-file', 'http://bridge.internal/');
	upstream.searchParams.set('path', path);
	upstream.searchParams.set('storage', storage);

	return proxyBridgeRequest(event, `${upstream.pathname.slice(1)}?${upstream.searchParams.toString()}`, {
		requireAdmin: false,
		timeoutMs: 30000
	});
};
