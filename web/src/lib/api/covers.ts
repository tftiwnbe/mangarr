import { buildApiUrl } from './config';

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
		return buildApiUrl(`${COVER_PROXY_PATH}?url=${encodeURIComponent(trimmed)}`);
	}

	return trimmed;
}
