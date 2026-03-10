import { httpClient } from './client';

export default httpClient;

export { httpClient };
export const api = httpClient;
export { API_BASE_URL, buildApiUrl } from './config';
export { ApiError } from './errors';

export * as authApi from './auth';
export * as exploreApi from './explore';
export * as downloadsApi from './downloads';
export * as extensionsApi from './extensions';
export * as healthApi from './health';
export * as libraryApi from './library';
export * as settingsApi from './settings';

export {
	clearAuthSession,
	clearCachedUserProfile,
	getApiKeyPersistence,
	getCachedUserProfile,
	setCachedUserProfile,
	type ApiKeyPersistence,
	type UserProfile
} from './session';

export type { components, operations, paths } from './v2';
