import { browser } from '$app/environment';

import type { components } from './v2';

export type ApiKeyPersistence = 'session' | 'local';
export type UserProfile = components['schemas']['UserProfileResource'];

const API_KEY_STORAGE_KEY = 'mangarr.auth.api_key';
const USER_PROFILE_STORAGE_KEY = 'mangarr.auth.user_profile';

function getStorage(mode: ApiKeyPersistence): Storage | null {
	if (!browser) {
		return null;
	}
	return mode === 'local' ? localStorage : sessionStorage;
}

function safeGet(storage: Storage | null, key: string): string | null {
	if (!storage) {
		return null;
	}
	try {
		return storage.getItem(key);
	} catch {
		return null;
	}
}

function safeSet(storage: Storage | null, key: string, value: string): void {
	if (!storage) {
		return;
	}
	try {
		storage.setItem(key, value);
	} catch {
		// ignore browser storage exceptions (private mode/quota)
	}
}

function safeRemove(storage: Storage | null, key: string): void {
	if (!storage) {
		return;
	}
	try {
		storage.removeItem(key);
	} catch {
		// ignore browser storage exceptions (private mode/quota)
	}
}

function normalizedApiKey(apiKey: string): string {
	const value = apiKey.trim();
	if (!value) {
		throw new Error('API key cannot be empty');
	}
	if (value.toLowerCase().startsWith('bearer ')) {
		return value.slice(7).trim();
	}
	return value;
}

export function getApiKeyPersistence(): ApiKeyPersistence | null {
	if (safeGet(getStorage('local'), API_KEY_STORAGE_KEY)) {
		return 'local';
	}
	if (safeGet(getStorage('session'), API_KEY_STORAGE_KEY)) {
		return 'session';
	}
	return null;
}

export function getStoredApiKey(): string | null {
	return (
		safeGet(getStorage('local'), API_KEY_STORAGE_KEY) ??
		safeGet(getStorage('session'), API_KEY_STORAGE_KEY)
	);
}

export function getAuthorizationHeader(): string | null {
	const apiKey = getStoredApiKey();
	if (!apiKey) {
		return null;
	}
	return `Bearer ${apiKey}`;
}

export function setStoredApiKey(apiKey: string, persistence: ApiKeyPersistence = 'session'): void {
	const normalized = normalizedApiKey(apiKey);
	safeRemove(getStorage('local'), API_KEY_STORAGE_KEY);
	safeRemove(getStorage('session'), API_KEY_STORAGE_KEY);
	safeSet(getStorage(persistence), API_KEY_STORAGE_KEY, normalized);
}

export function clearStoredApiKey(): void {
	safeRemove(getStorage('local'), API_KEY_STORAGE_KEY);
	safeRemove(getStorage('session'), API_KEY_STORAGE_KEY);
}

export function getCachedUserProfile(): UserProfile | null {
	const payload =
		safeGet(getStorage('local'), USER_PROFILE_STORAGE_KEY) ??
		safeGet(getStorage('session'), USER_PROFILE_STORAGE_KEY);
	if (!payload) {
		return null;
	}
	try {
		return JSON.parse(payload) as UserProfile;
	} catch {
		return null;
	}
}

export function setCachedUserProfile(
	profile: UserProfile,
	persistence: ApiKeyPersistence = 'session'
): void {
	safeRemove(getStorage('local'), USER_PROFILE_STORAGE_KEY);
	safeRemove(getStorage('session'), USER_PROFILE_STORAGE_KEY);
	safeSet(getStorage(persistence), USER_PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

export function clearCachedUserProfile(): void {
	safeRemove(getStorage('local'), USER_PROFILE_STORAGE_KEY);
	safeRemove(getStorage('session'), USER_PROFILE_STORAGE_KEY);
}

export function clearAuthSession(): void {
	clearStoredApiKey();
	clearCachedUserProfile();
}
