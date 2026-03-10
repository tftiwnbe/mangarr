import { browser } from '$app/environment';

export type ApiKeyPersistence = 'session' | 'local';
export type UserProfile = {
	id: string;
	username: string;
	is_admin: boolean;
	created_at: string;
	last_login_at?: string | null;
};

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
	} catch (err) {
		if (import.meta.env.DEV) {
			console.warn('[session] storage.getItem failed for key:', key, err);
		}
		return null;
	}
}

function safeSet(storage: Storage | null, key: string, value: string): void {
	if (!storage) {
		return;
	}
	try {
		storage.setItem(key, value);
	} catch (err) {
		// Silently tolerate storage errors (private mode, quota exceeded, etc.)
		// but surface them in development so they're not invisible.
		if (import.meta.env.DEV) {
			console.warn('[session] storage.setItem failed for key:', key, err);
		}
	}
}

function safeRemove(storage: Storage | null, key: string): void {
	if (!storage) {
		return;
	}
	try {
		storage.removeItem(key);
	} catch (err) {
		if (import.meta.env.DEV) {
			console.warn('[session] storage.removeItem failed for key:', key, err);
		}
	}
}

export function getApiKeyPersistence(): ApiKeyPersistence | null {
	if (safeGet(getStorage('local'), USER_PROFILE_STORAGE_KEY)) {
		return 'local';
	}
	if (safeGet(getStorage('session'), USER_PROFILE_STORAGE_KEY)) {
		return 'session';
	}
	return null;
}

export function getStoredApiKey(): string | null {
	return null;
}

export function getAuthorizationHeader(): string | null {
	return null;
}

export function setStoredApiKey(
	_apiKey: string,
	_persistence: ApiKeyPersistence = 'session'
): void {
	// Browser auth is cookie-backed in the v2 web app.
}

export function clearStoredApiKey(): void {
	// Browser auth is cookie-backed in the v2 web app.
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
	clearCachedUserProfile();
}
