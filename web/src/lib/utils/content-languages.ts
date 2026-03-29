const LANGUAGE_CODE_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;

/**
 * Normalize extension language tags while preserving script/region variants.
 * Examples: zh_hans -> zh-hans, pt-BR -> pt-br, multi/all -> multi.
 */
export function normalizeContentLanguageCode(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const lowered = raw.trim().toLowerCase();
	if (!lowered) return null;
	if (lowered === 'multi' || lowered === 'all') return 'multi';

	const normalized = lowered.replace(/_/g, '-');
	if (!LANGUAGE_CODE_RE.test(normalized)) return null;
	return normalized;
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
