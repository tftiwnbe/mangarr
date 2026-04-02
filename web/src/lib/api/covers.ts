const FALLBACK_COVER = '/favicon.svg';
const COVER_PROXY_PATH = '/api/covers/proxy';
const DIRECT_COVER_HOSTS = new Set(['cdn.nhentai.com']);

export function getCachedCoverUrl(url: string | null | undefined): string {
	const trimmed = (url ?? '').trim();
	if (!trimmed) {
		return FALLBACK_COVER;
	}
	if (
		trimmed.startsWith(COVER_PROXY_PATH) ||
		trimmed.startsWith('/') ||
		trimmed.startsWith('data:')
	) {
		return trimmed;
	}
	if (/^https?:\/\//i.test(trimmed)) {
		try {
			const parsed = new URL(trimmed);
			if (DIRECT_COVER_HOSTS.has(parsed.hostname)) {
				return trimmed;
			}
		} catch {
			return trimmed;
		}
		const params = new URLSearchParams({ url: trimmed });
		return `${COVER_PROXY_PATH}?${params.toString()}`;
	}
	return trimmed;
}
