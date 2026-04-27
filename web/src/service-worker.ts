/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `mangarr-cache-${version}`;

// Build artifacts (immutable, hashed) + static files. We deliberately do NOT
// cache app HTML or API responses — the app is convex-driven and needs live
// data; this SW exists primarily to make the PWA installable and to give the
// shell a fast cold start.
const ASSETS = [...build, ...files];

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
				if (key !== CACHE) await caches.delete(key);
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

	// Only intercept known build/static assets — let everything else (pages,
	// API routes, convex traffic) hit the network unmodified.
	const isAsset = ASSETS.includes(url.pathname);
	if (!isAsset) return;

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
});
