import { httpClient } from './client';
import { expectData, expectNoContent } from './errors';
import { clearAuthSession, setCachedUserProfile, type ApiKeyPersistence } from './session';
import type { components } from './v2';

export type RegisterFirstUserRequest = components['schemas']['RegisterFirstUserRequest'];
export type ChangePasswordRequest = components['schemas']['ChangePasswordRequest'];
export type IntegrationApiKeyResource = components['schemas']['IntegrationApiKeyResource'];
export type CreateIntegrationApiKeyRequest =
	components['schemas']['CreateIntegrationApiKeyRequest'];
export type CreateIntegrationApiKeyResponse =
	components['schemas']['CreateIntegrationApiKeyResponse'];
export type UserProfile = {
	id: string;
	username: string;
	is_admin: boolean;
	created_at: string;
	last_login_at?: string | null;
};
export type LoginRequest = components['schemas']['LoginRequest'];
export type SetupStatusResponse = components['schemas']['SetupStatusResponse'];
export type SessionAuthResponse = {
	user: UserProfile;
	issued_at?: string;
};

export async function registerFirstUser(
	payload: RegisterFirstUserRequest,
	options?: { persistence?: ApiKeyPersistence }
): Promise<SessionAuthResponse> {
	const data = expectData(
		await httpClient.POST('/api/v2/auth/register-first-user', { body: payload }),
		'Unable to register first user'
	) as unknown as SessionAuthResponse;
	const persistence = options?.persistence ?? 'session';
	setCachedUserProfile(data.user, persistence);
	return data;
}

export async function login(
	payload: LoginRequest,
	options?: { persistence?: ApiKeyPersistence }
): Promise<SessionAuthResponse> {
	const data = expectData(
		await httpClient.POST('/api/v2/auth/login', { body: payload }),
		'Unable to sign in'
	) as unknown as SessionAuthResponse;
	const persistence = options?.persistence ?? 'session';
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
	) as unknown as UserProfile;
	setCachedUserProfile(profile);
	return profile;
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

export async function changePassword(payload: ChangePasswordRequest): Promise<void> {
	expectNoContent(
		await httpClient.POST('/api/v2/auth/me/password', { body: payload }),
		'Unable to update password'
	);
}

export async function signOut(): Promise<void> {
	try {
		await httpClient.POST('/api/v2/auth/logout');
	} catch {
		// Best effort server-side revocation; always clear browser-side cache.
	}
	clearAuthSession();
}

export async function getWsToken(): Promise<string> {
	const data = expectData(
		await httpClient.POST('/api/v2/auth/ws-token'),
		'Failed to obtain WS token'
	);
	return data.token;
}
