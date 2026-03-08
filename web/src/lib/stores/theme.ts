import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'mangarr-theme';

function getStoredPreference(): ThemePreference {
	if (!browser) return 'dark';
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
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

	// Persist preference changes
	themePreference.subscribe((pref) => {
		localStorage.setItem(STORAGE_KEY, pref);
	});

	// Apply resolved theme to DOM
	resolvedTheme.subscribe(applyTheme);
}

export function setTheme(pref: ThemePreference): void {
	themePreference.set(pref);
}
