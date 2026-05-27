import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { env as privateEnv } from '$env/dynamic/private';

const ALLOWED_KINDS = new Set(['query', 'mutation', 'action']);

function getInternalConvexUrl() {
	const url = (
		privateEnv.CONVEX_URL ||
		privateEnv.CONVEX_SELF_HOSTED_URL ||
		'http://127.0.0.1:3210'
	).trim();
	return url.replace(/\/+$/, '');
}

export const POST: RequestHandler = async (event) => {
	const kind = event.params.kind.trim();
	if (!ALLOWED_KINDS.has(kind)) {
		throw error(404, 'Unknown Convex action endpoint');
	}

	const clientAddress = event.getClientAddress();
	if (clientAddress !== '127.0.0.1' && clientAddress !== '::1') {
		throw error(404, 'Not found');
	}

	const body = await event.request.arrayBuffer();
	const upstream = await fetch(`${getInternalConvexUrl()}/api/actions/${kind}`, {
		method: 'POST',
		headers: forwardHeaders(event.request.headers),
		body
	});

	return new Response(upstream.body, {
		status: upstream.status,
		headers: filterHeaders(upstream.headers)
	});
};

function forwardHeaders(headers: Headers) {
	const forwarded = new Headers();
	for (const [name, value] of headers.entries()) {
		if (isHopByHopHeader(name) || name === 'host') {
			continue;
		}
		forwarded.set(name, value);
	}
	return forwarded;
}

function filterHeaders(headers: Headers) {
	const filtered = new Headers();
	for (const [name, value] of headers.entries()) {
		if (isHopByHopHeader(name)) {
			continue;
		}
		filtered.set(name, value);
	}
	return filtered;
}

function isHopByHopHeader(name: string) {
	const normalized = name.toLowerCase();
	return (
		normalized === 'connection' ||
		normalized === 'keep-alive' ||
		normalized === 'proxy-authenticate' ||
		normalized === 'proxy-authorization' ||
		normalized === 'te' ||
		normalized === 'trailer' ||
		normalized === 'transfer-encoding' ||
		normalized === 'upgrade'
	);
}
