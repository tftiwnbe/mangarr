const STORAGE_PREFIX = 'mangarr:reader-progress';

function getKey(chapterId: number): string {
	return `${STORAGE_PREFIX}:${chapterId}`;
}

export function getReaderProgress(chapterId: number): number | null {
	if (typeof window === 'undefined') return null;

	const raw = window.localStorage.getItem(getKey(chapterId));
	if (raw === null) return null;

	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : null;
}

export function setReaderProgress(chapterId: number, pageIndex: number): void {
	if (typeof window === 'undefined') return;
	window.localStorage.setItem(getKey(chapterId), String(pageIndex));
}
