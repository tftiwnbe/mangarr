import { browser } from '$app/environment';
import { writable } from 'svelte/store';

import { getContentLanguages as fetchContentLanguages, updateContentLanguages } from '$lib/api/settings';

const STORAGE_KEY = 'mangarr-content-languages';
const KNOWN_LANGS_KEY = 'mangarr-known-content-languages';

/**
 * Read preferred content languages from localStorage (used as a cache/fallback).
 * Returns empty array if nothing stored (meaning "show all").
 */
function getLocalContentLanguages(): string[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) return parsed;
		}
	} catch {
		// ignore
	}
	return [];
}

function setLocalContentLanguages(langs: string[]): void {
	if (browser) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(langs));
	}
}

/** Reactive store for preferred content languages (initialised from localStorage cache) */
export const contentLanguages = writable<string[]>(getLocalContentLanguages());

/**
 * Load content language preferences from the server and sync to store + localStorage.
 * Falls back to localStorage value if server is unavailable.
 */
export async function loadContentLanguages(): Promise<void> {
	try {
		const result = await fetchContentLanguages();
		const langs = result.preferred ?? [];
		setLocalContentLanguages(langs);
		contentLanguages.set(langs);
	} catch {
		// Fall back to localStorage value (already set as initial store value)
	}
}

/**
 * Save preferred content languages to server + localStorage and update the reactive store.
 */
export async function setContentLanguages(langs: string[]): Promise<void> {
	setLocalContentLanguages(langs);
	contentLanguages.set(langs);
	try {
		await updateContentLanguages({ preferred: langs });
	} catch {
		// Best-effort server sync — localStorage already updated
	}
}

/**
 * Read the last-known set of available content languages.
 * Used in settings page to show all possible language options.
 */
export function getKnownContentLanguages(): string[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(KNOWN_LANGS_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) return parsed;
		}
	} catch {
		// ignore
	}
	return [];
}

/**
 * Persist the full set of available content languages (extracted from extensions).
 * Called after fetching available extensions so settings page can render the picker.
 */
export function setKnownContentLanguages(langs: string[]): void {
	if (browser) {
		const sorted = [...new Set(langs.map((l) => l.toLowerCase()))].sort((a, b) => {
			if (a === 'multi') return -1;
			if (b === 'multi') return 1;
			return a.localeCompare(b);
		});
		localStorage.setItem(KNOWN_LANGS_KEY, JSON.stringify(sorted));
	}
}
