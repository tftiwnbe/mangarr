import { httpClient } from './client';

export default httpClient;

export { httpClient };
export const api = httpClient;
export { API_BASE_URL, buildApiUrl } from './config';
export { ApiError } from './errors';

export * as authApi from './auth';
export * as discoverApi from './discover';
export * as downloadsApi from './downloads';
export * as extensionsApi from './extensions';
export * as healthApi from './health';
export * as libraryApi from './library';

export {
	clearAuthSession,
	clearCachedUserProfile,
	clearStoredApiKey,
	getApiKeyPersistence,
	getAuthorizationHeader,
	getCachedUserProfile,
	getStoredApiKey,
	setCachedUserProfile,
	setStoredApiKey,
	type ApiKeyPersistence,
	type UserProfile
} from './session';

export type { components, operations, paths } from './v2';
