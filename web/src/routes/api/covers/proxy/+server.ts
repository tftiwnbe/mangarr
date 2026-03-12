import { error } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';

export const GET: RequestHandler = async ({ fetch, url }) => {
	const target = url.searchParams.get('url')?.trim() ?? '';
	if (!target) {
		throw error(400, 'Missing url');
	}

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		throw error(400, 'Invalid url');
	}

	if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
		throw error(400, 'Unsupported protocol');
	}

	const refererOrigin =
		parsed.hostname === 'uploads.mangadex.org' || parsed.hostname.endsWith('.mangadex.org')
			? 'https://mangadex.org'
			: `${parsed.protocol}//${parsed.host}`;

	const upstream = await fetch(parsed, {
		headers: {
			accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
			origin: refererOrigin,
			referer: `${refererOrigin}/`,
			'user-agent': 'Mozilla/5.0 (compatible; MangarrCoverProxy/1.0)'
		}
	});

	if (!upstream.ok || !upstream.body) {
		throw error(upstream.status || 502, 'Unable to load cover');
	}

	const headers = new Headers();
	headers.set('cache-control', upstream.headers.get('cache-control') ?? CACHE_CONTROL);
	headers.set('content-type', upstream.headers.get('content-type') ?? 'image/jpeg');
	const contentLength = upstream.headers.get('content-length');
	if (contentLength) {
		headers.set('content-length', contentLength);
	}

	return new Response(upstream.body, {
		status: upstream.status,
		headers
	});
};
