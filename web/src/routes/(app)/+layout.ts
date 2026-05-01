import { browser } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import type { LayoutLoad } from './$types';

export const ssr = false;

const LAST_PATH_KEY = 'mangarr:last-path';
const SESSION_RESUMED_KEY = 'mangarr:resumed';
// PWA resume window. Beyond this, fall through to manifest start_url so a
// stale stored route never silently teleports the user weeks later.
const RESUME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// On a fresh PWA cold start (e.g. after iOS unloads the app from memory) the
// home-screen icon launches us at the manifest start_url. If the user had a
// different route open, restore it here. Guarded by sessionStorage so this
// only fires on the very first load of a session — subsequent in-app
// navigations to /library behave normally.
export const load: LayoutLoad = ({ url }) => {
	if (!browser) return;
	if (sessionStorage.getItem(SESSION_RESUMED_KEY)) return;
	sessionStorage.setItem(SESSION_RESUMED_KEY, '1');

	if (url.pathname !== '/library' || url.search) return;

	let saved: { path?: unknown; ts?: unknown } | null = null;
	try {
		const raw = localStorage.getItem(LAST_PATH_KEY);
		if (!raw) return;
		saved = JSON.parse(raw);
	} catch {
		return;
	}
	if (!saved || typeof saved.path !== 'string') return;
	const ts = typeof saved.ts === 'number' ? saved.ts : 0;
	if (Date.now() - ts > RESUME_MAX_AGE_MS) return;

	const path = saved.path;
	if (!path.startsWith('/') || path.startsWith('//')) return;
	if (path === '/library' || path.startsWith('/library?') || path.startsWith('/library#')) return;

	redirect(307, path);
};
