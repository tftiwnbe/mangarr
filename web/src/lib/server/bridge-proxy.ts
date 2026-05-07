import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

import { requireUser } from './auth';
import { buildBridgeInternalHeaders, getBridgeBaseUrl } from './bridge';
import { recordBridgeRequest } from '$lib/utils/server-metrics.js';

// content-length is intentionally omitted: Node's fetch transparently decodes
// gzip/br response bodies, so upstream's content-length (the encoded size) no
// longer matches the bytes we forward. Letting the response stream chunk-encode
// avoids truncation. content-encoding is dropped for the same reason.
const FORWARDED_HEADERS = [
	'content-type',
	'cache-control',
	'content-disposition',
	'etag',
	'last-modified',
	'accept-ranges',
	'vary',
	'age',
	'expires'
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
	const bridgePath = new URL(upstreamUrl).pathname;
	const timeoutSignal = AbortSignal.timeout(init.timeoutMs ?? 15_000);
	const signal =
		typeof AbortSignal.any === 'function'
			? AbortSignal.any([event.request.signal, timeoutSignal])
			: timeoutSignal;
	let upstream: Response;
	const startedAt = Date.now();
	try {
		upstream = await fetch(upstreamUrl, {
			method: init.method ?? 'GET',
			headers: buildBridgeInternalHeaders(init.headers, event.locals.requestId),
			body: init.body,
			signal
		});
	} catch (cause) {
		recordBridgeRequest({
			path: bridgePath,
			method: init.method ?? 'GET',
			outcome:
				cause instanceof DOMException && cause.name === 'TimeoutError' ? 'timeout' : 'network_error',
			status:
				cause instanceof DOMException && cause.name === 'TimeoutError' ? 'timeout' : 'network_error',
			durationMs: Date.now() - startedAt
		});
		if (cause instanceof DOMException && cause.name === 'TimeoutError') {
			throw error(504, 'Bridge request timed out');
		}
		throw error(502, 'Bridge internal API is unavailable');
	}
	recordBridgeRequest({
		path: bridgePath,
		method: init.method ?? 'GET',
		outcome: 'response',
		status: upstream.status,
		durationMs: Date.now() - startedAt
	});

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
