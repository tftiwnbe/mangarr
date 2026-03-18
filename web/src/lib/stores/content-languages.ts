import { browser } from '$app/environment';
import { writable } from 'svelte/store';

import { toMainContentLanguages } from '$lib/utils/content-languages';

const STORAGE_KEY = 'mangarr-content-languages';
const KNOWN_LANGS_KEY = 'mangarr-known-content-languages';

function getLocalContentLanguages(): string[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) return toMainContentLanguages(parsed);
		}
	} catch {
		// Ignore storage failures and fall back to defaults.
	}
	return [];
}

function setLocalContentLanguages(langs: string[]): void {
	if (browser) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(toMainContentLanguages(langs)));
	}
}

export const contentLanguages = writable<string[]>(getLocalContentLanguages());

export async function loadContentLanguages(): Promise<void> {
	try {
		const response = await fetch('/api/settings/content-languages');
		if (!response.ok) {
			throw new Error('Unable to load content language settings');
		}
		const result = (await response.json().catch(() => null)) as { preferred?: string[] } | null;
		const langs = toMainContentLanguages(result?.preferred ?? []);
		setLocalContentLanguages(langs);
		contentLanguages.set(langs);
	} catch {
		// Fall back to local cache.
	}
}

export async function setContentLanguages(langs: string[]): Promise<void> {
	const normalized = toMainContentLanguages(langs);
	setLocalContentLanguages(normalized);
	contentLanguages.set(normalized);
	try {
		const response = await fetch('/api/settings/content-languages', {
			method: 'PUT',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify({ preferred: normalized })
		});
		if (!response.ok) {
			throw new Error('Unable to update content language settings');
		}
	} catch {
		// Best-effort server sync — local cache already updated.
	}
}

export function getKnownContentLanguages(): string[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(KNOWN_LANGS_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) return toMainContentLanguages(parsed);
		}
	} catch {
		// Ignore storage failures and fall back to defaults.
	}
	return [];
}

export function setKnownContentLanguages(langs: string[]): void {
	if (browser) {
		const sorted = toMainContentLanguages(langs);
		localStorage.setItem(KNOWN_LANGS_KEY, JSON.stringify(sorted));
	}
}
