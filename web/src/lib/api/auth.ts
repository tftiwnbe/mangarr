import { httpClient } from './client';
import { buildApiUrl } from './config';
import { expectData, expectNoContent } from './errors';
import { ApiError } from './errors';
import {
	clearAuthSession,
	getApiKeyPersistence,
	getAuthorizationHeader,
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
export type CreateIntegrationApiKeyRequest = components['schemas']['CreateIntegrationApiKeyRequest'];
export type CreateIntegrationApiKeyResponse = components['schemas']['CreateIntegrationApiKeyResponse'];
export type UserProfile = components['schemas']['UserProfileResource'];
export type LoginRequest = components['schemas']['LoginRequest'];
export type LoginResponse = components['schemas']['LoginResponse'];
export type SetupStatusResponse = { needs_setup: boolean };

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
	const response = await fetch(buildApiUrl('/api/v2/auth/setup-status'), {
		headers: { Accept: 'application/json' }
	});
	let payload: unknown = null;
	try {
		payload = await response.json();
	} catch {
		payload = null;
	}
	if (!response.ok) {
		const message =
			payload && typeof payload === 'object' && 'detail' in payload
				? String((payload as { detail?: unknown }).detail ?? 'Unable to load setup status')
				: 'Unable to load setup status';
		throw new ApiError(response.status, payload, message);
	}
	if (
		!payload ||
		typeof payload !== 'object' ||
		typeof (payload as { needs_setup?: unknown }).needs_setup !== 'boolean'
	) {
		throw new ApiError(response.status, payload, 'Invalid setup status response');
	}
	return payload as SetupStatusResponse;
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

export async function listIntegrationApiKeys(): Promise<IntegrationApiKeyResource[]> {
	return expectData(await httpClient.GET('/api/v2/auth/me/api-keys'), 'Unable to load integration API keys');
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

export async function changePassword(payload: ChangePasswordRequest): Promise<void> {
	expectNoContent(
		await httpClient.POST('/api/v2/auth/me/password', { body: payload }),
		'Unable to update password'
	);
}

export function signOut(): void {
	clearAuthSession();
}

/**
 * Request a short-lived one-time token for WebSocket authentication.
 * Using this token in the WS URL avoids exposing the main API key in server logs.
 */
export async function getWsToken(): Promise<string> {
	const authHeader = getAuthorizationHeader();
	if (!authHeader) throw new Error('Not authenticated');
	const response = await fetch(buildApiUrl('/api/v2/auth/ws-token'), {
		method: 'POST',
		headers: { Authorization: authHeader, Accept: 'application/json' }
	});
	if (!response.ok) {
		throw new ApiError(response.status, null, 'Failed to obtain WS token');
	}
	const data = (await response.json()) as { token: string };
	return data.token;
}
