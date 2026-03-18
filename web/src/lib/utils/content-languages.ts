const ISO6391_RE = /^[a-z]{2}$/;

/**
 * Reduce extension language tags to a compact "main language" code.
 * Examples: zh-hans -> zh, pt-BR -> pt, multi/all -> multi.
 */
export function normalizeContentLanguageCode(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const lowered = raw.trim().toLowerCase();
	if (!lowered) return null;
	if (lowered === 'multi' || lowered === 'all') return 'multi';

	const normalized = lowered.replace(/_/g, '-');
	const base = normalized.split('-')[0];
	if (base === 'multi' || base === 'all') return 'multi';
	if (!ISO6391_RE.test(base)) return null;
	return base;
}

export function sortContentLanguageCodes(langs: Iterable<string>): string[] {
	const unique = [...new Set(langs)];
	unique.sort((a, b) => {
		if (a === 'multi') return -1;
		if (b === 'multi') return 1;
		return a.localeCompare(b);
	});
	return unique;
}

export function toMainContentLanguages(langs: Iterable<string | null | undefined>): string[] {
	const normalized = [];
	for (const value of langs) {
		const code = normalizeContentLanguageCode(value);
		if (code) normalized.push(code);
	}
	return sortContentLanguageCodes(normalized);
}
