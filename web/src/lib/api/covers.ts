import { buildApiUrl } from './config';
import { getStoredApiKey } from './session';

const FALLBACK_COVER = '/favicon.ico';
const COVER_PROXY_PATH = '/api/v2/covers/proxy';

export function getCachedCoverUrl(url: string | null | undefined): string {
	const trimmed = (url ?? '').trim();
	if (!trimmed) {
		return FALLBACK_COVER;
	}
	if (
		trimmed.startsWith('/') ||
		trimmed.startsWith('data:') ||
		trimmed.startsWith('blob:') ||
		trimmed.includes(`${COVER_PROXY_PATH}?`)
	) {
		return trimmed;
	}

	if (/^https?:\/\//i.test(trimmed)) {
		// <img> tags cannot send Authorization headers, so we pass the key as a
		// query param — the server's get_current_user dep accepts ?api_key=...
		const params = new URLSearchParams({ url: trimmed });
		const apiKey = getStoredApiKey();
		if (apiKey) params.set('api_key', apiKey);
		return buildApiUrl(`${COVER_PROXY_PATH}?${params}`);
	}

	return trimmed;
}
