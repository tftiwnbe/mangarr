import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { getWorkerBaseUrl } from '$lib/server/worker';

const FORWARDED_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified', 'content-length'];

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.auth.user) {
		throw error(401, 'Not signed in');
	}

	const rawUrl = url.searchParams.get('url')?.trim() ?? '';
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

	const workerUrl = `${getWorkerBaseUrl()}/covers/proxy?url=${encodeURIComponent(parsed.toString())}`;

	let upstream: Response;
	try {
		upstream = await fetch(workerUrl, {
			headers: {
				accept: 'image/*,*/*;q=0.8'
			}
		});
	} catch {
		throw error(502, 'Worker cover proxy is unavailable');
	}

	if (!upstream.ok) {
		const message = await readErrorMessage(upstream);
		throw error(upstream.status, message || 'Worker cover proxy request failed');
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
};

async function readErrorMessage(response: Response) {
	const type = response.headers.get('content-type') ?? '';
	if (type.includes('application/json')) {
		try {
			const payload = (await response.json()) as { message?: string };
			return payload.message ?? null;
		} catch {
			return null;
		}
	}

	const text = await response.text();
	return text.trim() || null;
}
