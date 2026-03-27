import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { ConvexClient, type AuthTokenFetcher } from 'convex/browser';
import { setConvexClientContext } from 'convex-svelte';

let client: ConvexClient | null = null;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

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
	const configured = env.PUBLIC_CONVEX_URL || import.meta.env.PUBLIC_CONVEX_URL || '';
	if (!browser || !configured) {
		return configured;
	}
	return resolveBrowserConvexUrl(configured, window.location);
}

export function resolveBrowserConvexUrl(
	configuredUrl: string,
	locationLike: Pick<Location, 'hostname'> | { hostname: string }
) {
	try {
		const url = new URL(configuredUrl);
		if (!LOOPBACK_HOSTS.has(url.hostname)) {
			return url.toString();
		}

		const browserHost = locationLike.hostname.trim();
		if (!browserHost || LOOPBACK_HOSTS.has(browserHost)) {
			return url.toString();
		}

		url.hostname = browserHost;
		return url.toString();
	} catch {
		return configuredUrl;
	}
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
