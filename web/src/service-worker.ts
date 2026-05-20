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
			await cache.addAll(ASSETS);
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
