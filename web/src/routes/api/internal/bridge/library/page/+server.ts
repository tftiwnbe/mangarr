import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { proxyBridgeRequest } from '$lib/server/bridge-proxy';

export const GET: RequestHandler = async (event) => {
	const path = event.url.searchParams.get('path')?.trim();
	const index = event.url.searchParams.get('index')?.trim();

	if (!path || !index) {
		throw error(400, 'path and index are required');
	}

	const upstream = new URL('assets/library/page', 'http://bridge.internal/');
	upstream.searchParams.set('path', path);
	upstream.searchParams.set('index', index);

	return proxyBridgeRequest(event, `${upstream.pathname.slice(1)}?${upstream.searchParams.toString()}`, {
		requireAdmin: false,
		timeoutMs: 30000
	});
};
