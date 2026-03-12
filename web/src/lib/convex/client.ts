import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { ConvexClient, type AuthTokenFetcher } from 'convex/browser';
import { setConvexClientContext } from 'convex-svelte';

let client: ConvexClient | null = null;

export function setupConvexClient() {
	if (!browser) {
		return null;
	}

	const url = getConvexUrl();
	if (!url) {
		return null;
	}

	if (!client) {
		client = new ConvexClient(url);
		client.setAuth(fetchConvexToken);
	}

	setConvexClientContext(client);
	return client;
}

export function getConvexUrl() {
	return env.PUBLIC_CONVEX_URL || import.meta.env.PUBLIC_CONVEX_URL || '';
}

const fetchConvexToken: AuthTokenFetcher = async ({ forceRefreshToken }) => {
	const response = await fetch('/api/auth/convex-token', {
		method: 'POST',
		headers: forceRefreshToken
			? {
					'cache-control': 'no-cache'
				}
			: undefined
	});

	if (response.status === 401) {
		return null;
	}

	if (!response.ok) {
		throw new Error(`Failed to refresh Convex auth token (${response.status})`);
	}

	const payload = (await response.json()) as { token?: string };
	if (!payload.token) {
		throw new Error('Convex auth token response was missing a token');
	}

	return payload.token;
};
