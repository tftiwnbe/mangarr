import { buildApiUrl } from './config';

const FALLBACK_COVER = '/favicon.ico';
const COVER_PROXY_PATH = '/api/v2/covers/proxy';
const COVER_LIBRARY_PATH = '/api/v2/covers/library/';

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
		return trimmed;
	}
	if (trimmed.startsWith('/') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
		return trimmed;
	}

	if (/^https?:\/\//i.test(trimmed)) {
		const params = new URLSearchParams({ url: trimmed });
		return buildApiUrl(`${COVER_PROXY_PATH}?${params}`);
	}

	return trimmed;
}
