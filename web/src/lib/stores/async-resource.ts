import { get, writable, type Readable } from 'svelte/store';

import { ApiError } from '$lib/api/errors';

export interface AsyncResourceState<T> {
	data: T;
	hasLoaded: boolean;
	isLoading: boolean;
	isRefreshing: boolean;
	error: string | null;
	lastLoadedAt: number | null;
}

export interface AsyncResourceStore<T, A extends unknown[]> extends Readable<AsyncResourceState<T>> {
	load: (...args: A) => Promise<T>;
	refresh: (...args: A) => Promise<T>;
	reset: () => void;
	setData: (nextData: T) => void;
}

interface AsyncResourceOptions<T> {
	initialData: T;
	cacheMs?: number;
}

function toErrorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		return error.message;
	}
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === 'string' && error.trim().length > 0) {
		return error;
	}
	return 'Something went wrong';
}

function serializeArgs(args: readonly unknown[]): string | null {
	try {
		return JSON.stringify(args);
	} catch {
		return null;
	}
}

export function createAsyncResourceStore<T, A extends unknown[]>(
	loader: (...args: A) => Promise<T>,
	options: AsyncResourceOptions<T>
): AsyncResourceStore<T, A> {
	const cacheMs = options.cacheMs ?? 0;
	const initialState: AsyncResourceState<T> = {
		data: options.initialData,
		hasLoaded: false,
		isLoading: false,
		isRefreshing: false,
		error: null,
		lastLoadedAt: null
	};

	const baseStore = writable<AsyncResourceState<T>>(initialState);

	let activeRequestId = 0;
	let inFlight: { key: string | null; promise: Promise<T> } | null = null;
	let lastArgsKey: string | null = null;

	async function execute(force: boolean, args: A): Promise<T> {
		const argsKey = serializeArgs(args);
		const currentState = get(baseStore);
		const now = Date.now();

		if (
			!force &&
			cacheMs > 0 &&
			currentState.hasLoaded &&
			argsKey !== null &&
			argsKey === lastArgsKey &&
			currentState.lastLoadedAt !== null &&
			now - currentState.lastLoadedAt < cacheMs
		) {
			return currentState.data;
		}

		if (inFlight && inFlight.key === argsKey) {
			return inFlight.promise;
		}

		const requestId = ++activeRequestId;
		baseStore.update((state) => ({
			...state,
			isLoading: !state.hasLoaded,
			isRefreshing: state.hasLoaded,
			error: null
		}));

		const promise = loader(...args)
			.then((nextData) => {
				if (requestId === activeRequestId) {
					lastArgsKey = argsKey;
					baseStore.set({
						data: nextData,
						hasLoaded: true,
						isLoading: false,
						isRefreshing: false,
						error: null,
						lastLoadedAt: Date.now()
					});
				}
				return nextData;
			})
			.catch((error: unknown) => {
				if (requestId === activeRequestId) {
					baseStore.update((state) => ({
						...state,
						isLoading: false,
						isRefreshing: false,
						error: toErrorMessage(error)
					}));
				}
				throw error;
			})
			.finally(() => {
				if (inFlight?.promise === promise) {
					inFlight = null;
				}
			});

		inFlight = { key: argsKey, promise };
		return promise;
	}

	return {
		subscribe: baseStore.subscribe,
		load: (...args: A) => execute(false, args),
		refresh: (...args: A) => execute(true, args),
		reset: () => {
			activeRequestId += 1;
			inFlight = null;
			lastArgsKey = null;
			baseStore.set(initialState);
		},
		setData: (nextData: T) => {
			baseStore.update((state) => ({
				...state,
				data: nextData,
				hasLoaded: true,
				lastLoadedAt: Date.now(),
				error: null
			}));
		}
	};
}
