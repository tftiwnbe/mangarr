import { writable } from 'svelte/store';

import { getReaderProgress, setReaderProgress } from '$lib/utils/reader-progress';

type ProgressState = Record<number, number>;

const state = writable<ProgressState>({});

function setPage(chapterId: number, pageIndex: number): void {
	state.update((current) => ({ ...current, [chapterId]: pageIndex }));
	setReaderProgress(chapterId, pageIndex);
}

function getPage(chapterId: number): number | null {
	let cached: number | null = null;
	state.update((current) => {
		if (chapterId in current) {
			cached = current[chapterId];
			return current;
		}

		const stored = getReaderProgress(chapterId);
		if (stored !== null) {
			cached = stored;
			return { ...current, [chapterId]: stored };
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
