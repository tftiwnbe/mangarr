import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type UserPreferences = {
	theme: string | null;
	locale: string | null;
	pwaResumeEnabled: boolean | null;
};

const EMPTY: UserPreferences = { theme: null, locale: null, pwaResumeEnabled: null };
const CACHE_KEY = 'mangarr:user-preferences';

function readCache(): UserPreferences {
	if (!browser) return EMPTY;
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (!raw) return EMPTY;
		const parsed = JSON.parse(raw);
		return {
			theme: typeof parsed?.theme === 'string' ? parsed.theme : null,
			locale: typeof parsed?.locale === 'string' ? parsed.locale : null,
			pwaResumeEnabled:
				typeof parsed?.pwaResumeEnabled === 'boolean' ? parsed.pwaResumeEnabled : null
		};
	} catch {
		return EMPTY;
	}
}

function writeCache(value: UserPreferences): void {
	if (!browser) return;
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(value));
	} catch {
		/* storage full or disabled — non-fatal */
	}
}

export const userPreferences = writable<UserPreferences>(readCache());

let loaded = false;

export async function loadUserPreferences(): Promise<UserPreferences> {
	if (!browser) return EMPTY;
	try {
		const res = await fetch('/api/settings/preferences');
		if (!res.ok) return readCache();
		const data = (await res.json()) as Partial<UserPreferences>;
		const next: UserPreferences = {
			theme: data.theme ?? null,
			locale: data.locale ?? null,
			pwaResumeEnabled: data.pwaResumeEnabled ?? null
		};
		userPreferences.set(next);
		writeCache(next);
		loaded = true;
		return next;
	} catch {
		return readCache();
	}
}

export async function patchUserPreferences(
	partial: Partial<UserPreferences>
): Promise<UserPreferences | null> {
	if (!browser) return null;

	// Optimistic local update so UI feels instant; cache mirrors so the
	// pre-paint scripts in app.html see the new value on next load.
	let optimistic: UserPreferences | null = null;
	userPreferences.update((prev) => {
		optimistic = { ...prev, ...partial };
		return optimistic;
	});
	if (optimistic) writeCache(optimistic);

	try {
		const res = await fetch('/api/settings/preferences', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(partial)
		});
		if (!res.ok) return null;
		const data = (await res.json()) as Partial<UserPreferences>;
		const next: UserPreferences = {
			theme: data.theme ?? null,
			locale: data.locale ?? null,
			pwaResumeEnabled: data.pwaResumeEnabled ?? null
		};
		userPreferences.set(next);
		writeCache(next);
		return next;
	} catch {
		return null;
	}
}

export function getCachedUserPreferences(): UserPreferences {
	return readCache();
}

export function isUserPreferencesLoaded(): boolean {
	return loaded;
}
