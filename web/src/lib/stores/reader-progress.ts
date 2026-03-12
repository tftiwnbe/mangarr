import { writable } from 'svelte/store';

import { getReaderProgress, setReaderProgress } from '$lib/utils/reader-progress';

type ProgressState = Record<string, number>;

const state = writable<ProgressState>({});

function setPage(chapterId: string | number, pageIndex: number): void {
	state.update((current) => ({ ...current, [String(chapterId)]: pageIndex }));
	setReaderProgress(chapterId, pageIndex);
}

function getPage(chapterId: string | number): number | null {
	let cached: number | null = null;
	state.update((current) => {
		const key = String(chapterId);
		if (key in current) {
			cached = current[key];
			return current;
		}

		const stored = getReaderProgress(chapterId);
		if (stored !== null) {
			cached = stored;
			return { ...current, [key]: stored };
		}

		return current;
	});

	return cached;
}

export const readerProgressStore = {
	subscribe: state.subscribe,
	getPage,
	setPage
};
