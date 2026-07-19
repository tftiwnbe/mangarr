/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `mangarr-cache-${version}`;
// Image cache is versioned independently: cover/page bytes are immutable per
// URL, so we don't want to nuke them on every app deploy. Bumping IMAGE_CACHE
// forces a refresh.
const IMAGE_CACHE = 'mangarr-images-v1';
const IMAGE_CACHE_MAX_ENTRIES = 600;

// Build artifacts (immutable, hashed) + static files. We deliberately do NOT
// cache app HTML or API responses — the app is convex-driven and needs live
// data; this SW exists primarily to make the PWA installable and to give the
// shell a fast cold start.
const ASSETS = [...build, ...files];

const IMAGE_PATH_PREFIXES = [
	'/api/covers/proxy',
	'/api/internal/bridge/library/cover',
	'/api/internal/bridge/library/page',
	'/api/internal/bridge/reader/page'
];

type NotificationClickData = {
	kind?: 'new_chapters' | 'test' | 'title-update';
	titleId?: string;
	eventId?: string;
	deliveryId?: string;
	receiptToken?: string;
	path?: string;
};

type PushPayload = {
	web_push?: number;
	app_badge?: string;
	notification?: {
		title?: string;
		body?: string;
		navigate?: string;
		tag?: string;
		icon?: string;
		badge?: string;
		app_badge?: string;
		renotify?: boolean;
		data?: NotificationClickData;
	};
};

async function recordDeliveryReceipt(token: string | undefined, phase: 'received' | 'displayed') {
	if (!token) return;
	try {
		await fetch('/api/notifications/receipt', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token, phase })
		});
	} catch {
		// Receipts are diagnostic only; notification display must never depend on them.
	}
}

async function setWorkerBadge(value: string | undefined) {
	const count = Number(value ?? NaN);
	const navigatorWithBadge = sw.navigator as Navigator & {
		setAppBadge?: (count?: number) => Promise<void>;
	};
	if (
		!Number.isFinite(count) ||
		count < 0 ||
		typeof navigatorWithBadge.setAppBadge !== 'function'
	) {
		return;
	}
	try {
		await navigatorWithBadge.setAppBadge(count);
	} catch {
		// Best effort only.
	}
}

function isImagePath(pathname: string): boolean {
	for (const prefix of IMAGE_PATH_PREFIXES) {
		if (
			pathname === prefix ||
			pathname.startsWith(`${prefix}/`) ||
			pathname.startsWith(`${prefix}?`)
		) {
			return true;
		}
	}
	return false;
}

function buildNotificationTargetUrl(path: string | undefined, eventId: string | undefined): string {
	const basePath = path && path.startsWith('/') ? path : '/library';
	const url = new URL(basePath, sw.location.origin);
	if (eventId) {
		url.searchParams.set('notificationEventId', eventId);
	}
	return url.toString();
}

async function trimCache(name: string, max: number): Promise<void> {
	const cache = await caches.open(name);
	const keys = await cache.keys();
	if (keys.length <= max) return;
	// FIFO eviction: cache.keys() preserves insertion order.
	const overflow = keys.length - max;
	for (let i = 0; i < overflow; i++) {
		await cache.delete(keys[i]);
	}
}

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			// A transient asset failure must not prevent this worker from activating:
			// notification delivery is more important than the optional shell cache.
			await cache.addAll(ASSETS).catch(() => undefined);
			await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE && key !== IMAGE_CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;

	const url = new URL(req.url);
	if (url.origin !== sw.location.origin) return;

	const isAsset = ASSETS.includes(url.pathname);
	if (isAsset) {
		event.respondWith(
			(async () => {
				const cache = await caches.open(CACHE);
				const cached = await cache.match(req);
				if (cached) return cached;
				const res = await fetch(req);
				if (res.ok) cache.put(req, res.clone());
				return res;
			})()
		);
		return;
	}

	if (isImagePath(url.pathname)) {
		event.respondWith(
			(async () => {
				const cache = await caches.open(IMAGE_CACHE);
				const cached = await cache.match(req);
				if (cached) return cached;
				try {
					const res = await fetch(req);
					// Only cache successful, cacheable responses. Skip opaque/partial/error
					// responses so we don't lock in a broken image.
					if (res.ok && res.type === 'basic' && res.status === 200) {
						const cacheControl = res.headers.get('cache-control') ?? '';
						if (!/no-store|private/i.test(cacheControl)) {
							cache
								.put(req, res.clone())
								.then(() => trimCache(IMAGE_CACHE, IMAGE_CACHE_MAX_ENTRIES));
						}
					}
					return res;
				} catch (err) {
					if (cached) return cached;
					throw err;
				}
			})()
		);
		return;
	}

	// Everything else (pages, API, convex traffic) hits the network unmodified.
});

sw.addEventListener('push', (event) => {
	event.waitUntil(
		(async () => {
			let payload: PushPayload | null = null;
			try {
				payload = event.data?.json() as PushPayload | null;
			} catch {
				payload = null;
			}
			const notification = payload?.notification;
			const title = notification?.title?.trim() || 'Mangarr';
			await recordDeliveryReceipt(notification?.data?.receiptToken, 'received');
			await sw.registration.showNotification(title, {
				body: notification?.body?.trim() || '',
				tag: notification?.tag?.trim() || undefined,
				icon: notification?.icon?.trim() || '/icon-192.png',
				badge: notification?.badge?.trim() || '/icon-192.png',
				renotify: notification?.renotify === true,
				data: {
					kind: notification?.data?.kind ?? 'title-update',
					titleId: notification?.data?.titleId,
					eventId: notification?.data?.eventId,
					deliveryId: notification?.data?.deliveryId,
					receiptToken: notification?.data?.receiptToken,
					path: notification?.data?.path ?? notification?.navigate ?? '/library'
				} satisfies NotificationClickData
			});
			await Promise.all([
				recordDeliveryReceipt(notification?.data?.receiptToken, 'displayed'),
				setWorkerBadge(payload?.app_badge ?? notification?.app_badge)
			]);
		})()
	);
});

sw.addEventListener('notificationclick', (event) => {
	const data = (event.notification.data ?? {}) as NotificationClickData;
	event.notification.close();
	event.waitUntil(
		(async () => {
			const targetUrl = buildNotificationTargetUrl(data.path, data.eventId);
			const windowClients = await sw.clients.matchAll({
				type: 'window',
				includeUncontrolled: true
			});
			for (const client of windowClients) {
				if (!('focus' in client)) continue;
				try {
					if ('navigate' in client && typeof client.navigate === 'function') {
						await client.navigate(targetUrl);
					}
				} catch {
					// Fall through to focus the existing window even if navigation failed.
				}
				await client.focus();
				return;
			}
			await sw.clients.openWindow(targetUrl);
		})()
	);
});
