import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

import { requireUser } from './auth';
import { buildBridgeInternalHeaders, getBridgeBaseUrl } from './bridge';

const FORWARDED_HEADERS = [
	'content-type',
	'cache-control',
	'content-disposition',
	'etag',
	'last-modified',
	'content-length'
] as const;

export async function proxyBridgeRequest(
	event: RequestEvent,
	path: string,
	init: {
		method?: string;
		headers?: HeadersInit;
		timeoutMs?: number;
		body?: BodyInit | null;
		requireAdmin?: boolean;
	} = {}
) {
	const user = requireUser(event);
	if (init.requireAdmin !== false && !user.isAdmin) {
		throw error(403, 'Admin privileges are required');
	}

	const upstreamUrl = new URL(path, `${getBridgeBaseUrl()}/`).toString();
	const timeoutSignal = AbortSignal.timeout(init.timeoutMs ?? 15_000);
	const signal =
		typeof AbortSignal.any === 'function'
			? AbortSignal.any([event.request.signal, timeoutSignal])
			: timeoutSignal;
	let upstream: Response;
	try {
		upstream = await fetch(upstreamUrl, {
			method: init.method ?? 'GET',
			headers: buildBridgeInternalHeaders(init.headers),
			body: init.body,
			signal
		});
	} catch (cause) {
		if (cause instanceof DOMException && cause.name === 'TimeoutError') {
			throw error(504, 'Bridge request timed out');
		}
		throw error(502, 'Bridge internal API is unavailable');
	}

	const headers = new Headers();
	for (const name of FORWARDED_HEADERS) {
		const value = upstream.headers.get(name);
		if (value) {
			headers.set(name, value);
		}
	}

	return new Response(upstream.body, {
		status: upstream.status,
		headers
	});
}
