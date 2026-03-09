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
export type IntegrationApiKeyResource = components['schemas']['IntegrationApiKeyResource'];
export type CreateIntegrationApiKeyRequest =
	components['schemas']['CreateIntegrationApiKeyRequest'];
export type CreateIntegrationApiKeyResponse =
	components['schemas']['CreateIntegrationApiKeyResponse'];
export type UserProfile = components['schemas']['UserProfileResource'];
export type LoginRequest = components['schemas']['LoginRequest'];
export type LoginResponse = components['schemas']['LoginResponse'];
export type SetupStatusResponse = components['schemas']['SetupStatusResponse'];
export type WsTokenResponse = components['schemas']['WsTokenResponse'];

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

export async function getSetupStatus(): Promise<SetupStatusResponse> {
	return expectData(
		await httpClient.GET('/api/v2/auth/setup-status'),
		'Unable to load setup status'
	);
}

export async function getMe(): Promise<UserProfile> {
	const profile = expectData(
		await httpClient.GET('/api/v2/auth/me'),
		'Unable to load current user'
	);
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

export async function listIntegrationApiKeys(): Promise<IntegrationApiKeyResource[]> {
	return expectData(
		await httpClient.GET('/api/v2/auth/me/api-keys'),
		'Unable to load integration API keys'
	);
}

export async function createIntegrationApiKey(
	payload: CreateIntegrationApiKeyRequest
): Promise<CreateIntegrationApiKeyResponse> {
	return expectData(
		await httpClient.POST('/api/v2/auth/me/api-keys', { body: payload }),
		'Unable to create integration API key'
	);
}

export async function revokeIntegrationApiKey(keyId: number): Promise<void> {
	expectNoContent(
		await httpClient.DELETE('/api/v2/auth/me/api-keys/{key_id}', {
			params: { path: { key_id: keyId } }
		}),
		'Unable to revoke integration API key'
	);
}

export type ChangePasswordResponse = components['schemas']['ChangePasswordResponse'];

export async function changePassword(payload: ChangePasswordRequest): Promise<void> {
	const data = expectData(
		await httpClient.POST('/api/v2/auth/me/password', { body: payload }),
		'Unable to update password'
	);
	const persistence = getApiKeyPersistence() ?? 'session';
	setStoredApiKey(data.api_key, persistence);
}

export async function signOut(): Promise<void> {
	try {
		await httpClient.POST('/api/v2/auth/logout');
	} catch {
		// Best-effort server-side revocation; always clear local state
	}
	clearAuthSession();
}

/**
 * Request a short-lived one-time token for WebSocket authentication.
 * Using this token in the WS URL avoids exposing the main API key in server logs.
 */
export async function getWsToken(): Promise<string> {
	const data = expectData(
		await httpClient.POST('/api/v2/auth/ws-token'),
		'Failed to obtain WS token'
	);
	return data.token;
}
