import { error } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

import { proxyBridgeRequest } from '$lib/server/bridge-proxy';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';
const FALLBACK_COVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 240" role="img" aria-label="Cover unavailable"><rect width="160" height="240" fill="#e5e7eb"/><rect x="20" y="24" width="120" height="192" rx="12" fill="#cbd5e1"/><path d="M50 82h60v12H50zm0 28h60v12H50zm0 28h42v12H50z" fill="#64748b"/></svg>`;

export const GET: RequestHandler = async (event) => {
	const { url } = event;
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

	try {
		const upstream = new URL('assets/remote/cover', 'http://bridge.internal/');
		upstream.searchParams.set('url', parsed.toString());
		return proxyBridgeRequest(
			event,
			`${upstream.pathname.slice(1)}?${upstream.searchParams.toString()}`,
			{
				requireAdmin: false,
				timeoutMs: 30000
			}
		);
	} catch {
		return new Response(FALLBACK_COVER_SVG, {
			status: 200,
			headers: {
				'cache-control': CACHE_CONTROL,
				'content-type': 'image/svg+xml; charset=utf-8'
			}
		});
	}
};
