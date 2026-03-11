import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

import { requireUser } from './auth';
import { buildWorkerInternalHeaders, getWorkerBaseUrl } from './worker';

const FORWARDED_HEADERS = [
	'content-type',
	'cache-control',
	'etag',
	'last-modified',
	'content-length'
] as const;

export async function proxyWorkerRequest(
	event: RequestEvent,
	path: string,
	init: {
		method?: string;
		headers?: HeadersInit;
		timeoutMs?: number;
		body?: BodyInit | null;
	} = {}
) {
	const user = requireUser(event);
	if (!user.isAdmin) {
		throw error(403, 'Admin privileges are required');
	}

	const upstreamUrl = new URL(path, `${getWorkerBaseUrl()}/`).toString();
	let upstream: Response;
	try {
		upstream = await fetch(upstreamUrl, {
			method: init.method ?? 'GET',
			headers: buildWorkerInternalHeaders(init.headers),
			body: init.body,
			signal: AbortSignal.timeout(init.timeoutMs ?? 15_000)
		});
	} catch {
		throw error(502, 'Worker internal API is unavailable');
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
