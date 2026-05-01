import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

import { patchUserPreferences, userPreferences } from './user-preferences';

export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

// Pre-paint mirror key. The inline script in app.html reads this BEFORE the
// Svelte app boots so the document gets `data-theme` set without a flash.
// Source of truth lives on the server in userPreferences; this is just a
// cache kept in sync on every set.
const STORAGE_KEY = 'mangarr-theme';

function isThemePreference(value: unknown): value is ThemePreference {
	return value === 'dark' || value === 'light' || value === 'system';
}

function getStoredPreference(): ThemePreference {
	if (!browser) return 'dark';
	const stored = localStorage.getItem(STORAGE_KEY);
	if (isThemePreference(stored)) return stored;
	return 'dark';
}

function getSystemTheme(): ResolvedTheme {
	if (!browser) return 'dark';
	return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** User preference: dark | light | system */
export const themePreference = writable<ThemePreference>(getStoredPreference());

/** Live system theme (updated via matchMedia listener) */
export const systemTheme = writable<ResolvedTheme>(getSystemTheme());

/** The actual theme applied to the document */
export const resolvedTheme = derived(
	[themePreference, systemTheme],
	([$pref, $sys]) => ($pref === 'system' ? $sys : $pref) as ResolvedTheme
);

function applyTheme(theme: ResolvedTheme): void {
	if (!browser) return;
	document.documentElement.setAttribute('data-theme', theme);
}

/** Call once from root layout to wire up reactivity */
export function initTheme(): void {
	if (!browser) return;

	// Listen for system theme changes
	const mq = window.matchMedia('(prefers-color-scheme: light)');
	const onSystemChange = (e: MediaQueryListEvent) => {
		systemTheme.set(e.matches ? 'light' : 'dark');
	};
	mq.addEventListener('change', onSystemChange);

	// Mirror preference into the pre-paint cache. Server sync happens via
	// setTheme() so this listener is just a local-cache safety net.
	themePreference.subscribe((pref) => {
		try {
			localStorage.setItem(STORAGE_KEY, pref);
		} catch {
			/* non-fatal */
		}
	});

	// Reflect server-side preference into our local store when it loads.
	userPreferences.subscribe(($prefs) => {
		const next = $prefs.theme;
		if (isThemePreference(next)) {
			themePreference.update((current) => (current === next ? current : next));
		}
	});

	// Apply resolved theme to DOM
	resolvedTheme.subscribe(applyTheme);
}

export function setTheme(pref: ThemePreference): void {
	themePreference.set(pref);
	void patchUserPreferences({ theme: pref });
}
