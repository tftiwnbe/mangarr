import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { proxyBridgeRequest } from '$lib/server/bridge-proxy';

export const GET: RequestHandler = async (event) => {
	const path = event.url.searchParams.get('path')?.trim();

	if (!path) {
		throw error(400, 'path is required');
	}

	const upstream = new URL('assets/library/chapter-file', 'http://bridge.internal/');
	upstream.searchParams.set('path', path);

	return proxyBridgeRequest(
		event,
		`${upstream.pathname.slice(1)}?${upstream.searchParams.toString()}`,
		{
			requireAdmin: false,
			timeoutMs: 30000
		}
	);
};
