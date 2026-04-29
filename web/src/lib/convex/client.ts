import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { ConvexClient, type AuthTokenFetcher } from 'convex/browser';
import { setConvexClientContext } from 'convex-svelte';

let client: ConvexClient | null = null;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
type BrowserLocationLike =
	| Pick<Location, 'hostname' | 'protocol' | 'port' | 'origin'>
	| { hostname: string; protocol?: string; port?: string; origin?: string };

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
		return normalizeConvexUrl(configured);
	}
	return resolveBrowserConvexUrl(configured, window.location);
}

export function resolveBrowserConvexUrl(configuredUrl: string, locationLike: BrowserLocationLike) {
	try {
		const url = new URL(configuredUrl);
		const browserHost = locationLike.hostname.trim();
		if (!browserHost || LOOPBACK_HOSTS.has(browserHost)) {
			return normalizeConvexUrl(url.toString());
		}

		if (LOOPBACK_HOSTS.has(url.hostname) || shouldUseBrowserOrigin(url, locationLike)) {
			return resolveAgainstBrowserOrigin(url, locationLike);
		}

		return normalizeConvexUrl(url.toString());
	} catch {
		return normalizeConvexUrl(configuredUrl);
	}
}

function normalizeConvexUrl(url: string) {
	return url.replace(/\/+$/, '');
}

function shouldUseBrowserOrigin(url: URL, locationLike: BrowserLocationLike) {
	return (
		locationLike.protocol === 'https:' &&
		url.protocol === 'http:' &&
		(url.pathname === '/convex' || url.pathname.startsWith('/convex/'))
	);
}

function resolveAgainstBrowserOrigin(url: URL, locationLike: BrowserLocationLike) {
	const browserOrigin = resolveBrowserOrigin(locationLike);
	if (!browserOrigin) {
		return normalizeConvexUrl(url.toString());
	}

	return normalizeConvexUrl(
		new URL(`${url.pathname}${url.search}${url.hash}`, browserOrigin).toString()
	);
}

function resolveBrowserOrigin(locationLike: BrowserLocationLike) {
	if (locationLike.origin) {
		return locationLike.origin;
	}

	if (!locationLike.protocol) {
		return null;
	}

	const browserHost = locationLike.hostname.trim();
	if (!browserHost) {
		return null;
	}

	const browserPort = locationLike.port?.trim();
	return `${locationLike.protocol}//${browserHost}${browserPort ? `:${browserPort}` : ''}`;
}

function getBrowserFetch(): typeof window.fetch {
	if (!browser) {
		throw new Error('Browser fetch is unavailable during server-side rendering');
	}

	return window.fetch.bind(window);
}

const fetchConvexToken: AuthTokenFetcher = async ({ forceRefreshToken }) => {
	const response = await getBrowserFetch()('/api/auth/convex-token', {
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
