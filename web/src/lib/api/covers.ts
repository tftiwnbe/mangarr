import { buildApiUrl } from './config';
import { getStoredApiKey } from './session';

const FALLBACK_COVER = '/favicon.ico';
const COVER_PROXY_PATH = '/api/v2/covers/proxy';
const COVER_LIBRARY_PATH = '/api/v2/covers/library/';

function appendCoverApiKey(url: string): string {
	const apiKey = getStoredApiKey();
	if (!apiKey) {
		return url;
	}

	const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
	const parsed = new URL(url, base);
	if (parsed.searchParams.has('api_key')) {
		return url;
	}
	parsed.searchParams.set('api_key', apiKey);

	if (/^https?:\/\//i.test(url)) {
		return parsed.toString();
	}

	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function getCachedCoverUrl(url: string | null | undefined): string {
	const trimmed = (url ?? '').trim();
	if (!trimmed) {
		return FALLBACK_COVER;
	}
	if (
		trimmed.startsWith(COVER_PROXY_PATH) ||
		trimmed.startsWith(COVER_LIBRARY_PATH) ||
		trimmed.includes(`${COVER_PROXY_PATH}?`) ||
		trimmed.includes(`${COVER_LIBRARY_PATH}?`)
	) {
		return appendCoverApiKey(trimmed);
	}
	if (trimmed.startsWith('/') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
		return trimmed;
	}

	if (/^https?:\/\//i.test(trimmed)) {
		const params = new URLSearchParams({ url: trimmed });
		return appendCoverApiKey(buildApiUrl(`${COVER_PROXY_PATH}?${params}`));
	}

	return trimmed;
}
