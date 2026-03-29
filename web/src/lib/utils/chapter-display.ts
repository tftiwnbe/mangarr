const STRUCTURED_CHAPTER_RE =
	/^(?:(?:vol(?:ume)?\.?\s*([0-9]+(?:\.[0-9]+)?))\s+)?(?:ch(?:apter)?\.?\s*([0-9]+(?:\.[0-9]+)?))(?:\s*[-—–:]\s*|\s+)?(.*)$/i;

export function hasDisplayableChapterNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function formatChapterNumberValue(value: number | string): string {
	if (typeof value === 'number') {
		return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '');
	}
	return value.trim().replace(/\.0+$/, '');
}

export function parseStructuredChapterName(raw: string): {
	volumeNumber: string | null;
	chapterNumber: string | null;
	detail: string | null;
} | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const match = trimmed.match(STRUCTURED_CHAPTER_RE);
	if (!match) return null;
	const [, volumeNumber, chapterNumber, detail] = match;
	if (!volumeNumber && !chapterNumber) return null;
	return {
		volumeNumber: volumeNumber ? formatChapterNumberValue(volumeNumber) : null,
		chapterNumber: chapterNumber ? formatChapterNumberValue(chapterNumber) : null,
		detail: detail?.trim() || null
	};
}
