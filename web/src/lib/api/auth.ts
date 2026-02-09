import { httpClient } from './client';
import { expectData, expectNoContent } from './errors';
import {
	clearAuthSession,
	getApiKeyPersistence,
	setCachedUserProfile,
	setStoredApiKey,
	type ApiKeyPersistence
} from './session';
import type { components } from './v2';

export type RegisterFirstUserRequest = components['schemas']['RegisterFirstUserRequest'];
export type RegisterFirstUserResponse = components['schemas']['RegisterFirstUserResponse'];
export type ChangePasswordRequest = components['schemas']['ChangePasswordRequest'];
export type RotateApiKeyResponse = components['schemas']['RotateApiKeyResponse'];
export type UserProfile = components['schemas']['UserProfileResource'];
export type LoginRequest = components['schemas']['LoginRequest'];
export type LoginResponse = components['schemas']['LoginResponse'];

export async function registerFirstUser(
	payload: RegisterFirstUserRequest,
	options?: { persistence?: ApiKeyPersistence }
): Promise<RegisterFirstUserResponse> {
	const data = expectData(
		await httpClient.POST('/api/v2/auth/register-first-user', { body: payload }),
		'Unable to register first user'
	);

	const persistence = options?.persistence ?? 'session';
	setStoredApiKey(data.api_key, persistence);
	setCachedUserProfile(data.user, persistence);
	return data;
}

export async function login(
	payload: LoginRequest,
	options?: { persistence?: ApiKeyPersistence }
): Promise<LoginResponse> {
	const data = expectData(
		await httpClient.POST('/api/v2/auth/login', { body: payload }),
		'Unable to sign in'
	);
	const persistence = options?.persistence ?? 'session';
	setStoredApiKey(data.api_key, persistence);
	setCachedUserProfile(data.user, persistence);
	return data;
}

export async function getMe(): Promise<UserProfile> {
	const profile = expectData(await httpClient.GET('/api/v2/auth/me'), 'Unable to load current user');
	const persistence = getApiKeyPersistence() ?? 'session';
	setCachedUserProfile(profile, persistence);
	return profile;
}

export async function rotateApiKey(options?: {
	persistence?: ApiKeyPersistence;
}): Promise<RotateApiKeyResponse> {
	const data = expectData(
		await httpClient.POST('/api/v2/auth/me/api-key/roll'),
		'Unable to rotate API key'
	);
	const persistence = options?.persistence ?? getApiKeyPersistence() ?? 'session';
	setStoredApiKey(data.api_key, persistence);
	return data;
}

export async function changePassword(payload: ChangePasswordRequest): Promise<void> {
	expectNoContent(
		await httpClient.POST('/api/v2/auth/me/password', { body: payload }),
		'Unable to update password'
	);
}

export function signOut(): void {
	clearAuthSession();
}
