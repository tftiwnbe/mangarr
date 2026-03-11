import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { proxyWorkerRequest } from '$lib/server/worker-proxy';

export const GET: RequestHandler = async (event) => {
	const rawUrl = event.url.searchParams.get('url')?.trim() ?? '';
	if (!rawUrl) {
		throw error(400, 'Query parameter "url" is required');
	}

	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw error(400, 'Invalid URL');
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw error(400, 'Only http and https URLs are allowed');
	}

	return proxyWorkerRequest(event, `covers/proxy?url=${encodeURIComponent(parsed.toString())}`);
};
