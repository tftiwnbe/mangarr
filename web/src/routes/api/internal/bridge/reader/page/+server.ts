import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

import { proxyBridgeRequest } from '$lib/server/bridge-proxy';

export const GET: RequestHandler = async (event) => {
	const sourceId = event.url.searchParams.get('sourceId')?.trim();
	const chapterUrl = event.url.searchParams.get('chapterUrl')?.trim();
	const index = event.url.searchParams.get('index')?.trim();

	if (!sourceId || !chapterUrl || !index) {
		throw error(400, 'sourceId, chapterUrl, and index are required');
	}

	const upstream = new URL('assets/page', 'http://bridge.internal/');
	upstream.searchParams.set('sourceId', sourceId);
	upstream.searchParams.set('chapterUrl', chapterUrl);
	upstream.searchParams.set('index', index);

	return proxyBridgeRequest(
		event,
		`${upstream.pathname.slice(1)}?${upstream.searchParams.toString()}`,
		{
			requireAdmin: false,
			timeoutMs: 30_000
		}
	);
};
