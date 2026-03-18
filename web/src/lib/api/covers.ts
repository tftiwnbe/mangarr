const FALLBACK_COVER = '/favicon.ico';
const COVER_PROXY_PATH = '/api/covers/proxy';

export function getCachedCoverUrl(url: string | null | undefined): string {
	const trimmed = (url ?? '').trim();
	if (!trimmed) {
		return FALLBACK_COVER;
	}
	if (trimmed.startsWith(COVER_PROXY_PATH) || trimmed.startsWith('/') || trimmed.startsWith('data:')) {
		return trimmed;
	}
	if (/^https?:\/\//i.test(trimmed)) {
		const params = new URLSearchParams({ url: trimmed });
		return `${COVER_PROXY_PATH}?${params.toString()}`;
	}
	return trimmed;
}
