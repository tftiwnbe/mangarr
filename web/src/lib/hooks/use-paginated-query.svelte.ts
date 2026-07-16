import type { PaginationStatus } from 'convex/browser';
import type {
	FunctionArgs,
	FunctionReference,
	FunctionReturnType,
	PaginationResult
} from 'convex/server';

import { useConvexClient } from 'convex-svelte';

type PaginatedQueryReference = FunctionReference<
	'query',
	'public',
	Record<string, unknown> & { paginationOpts: unknown },
	PaginationResult<unknown>
>;

type PaginatedQueryArgs<Query extends PaginatedQueryReference> = Omit<
	FunctionArgs<Query>,
	'paginationOpts'
>;

type PaginatedQueryItem<Query extends PaginatedQueryReference> =
	FunctionReturnType<Query> extends PaginationResult<infer Item> ? Item : never;

type PaginatedSubscriptionResult<Item> = {
	results: Item[];
	status: PaginationStatus;
	loadMore: (numItems: number) => boolean;
};

type PaginatedSubscriptionClient = {
	onPaginatedUpdate_experimental<Query extends PaginatedQueryReference>(
		query: Query,
		args: PaginatedQueryArgs<Query>,
		options: { initialNumItems: number },
		callback: (result: PaginatedSubscriptionResult<PaginatedQueryItem<Query>>) => unknown,
		onError?: (error: Error) => unknown
	): () => void;
};

export function usePaginatedQuery<Query extends PaginatedQueryReference>(
	query: Query,
	args: PaginatedQueryArgs<Query> | (() => PaginatedQueryArgs<Query>),
	options: { initialNumItems: number }
) {
	const client = useConvexClient();
	const state = $state<{
		results: PaginatedQueryItem<Query>[];
		status: PaginationStatus;
		error: Error | undefined;
	}>({
		results: [],
		status: 'LoadingFirstPage',
		error: undefined
	});
	let loadMoreCurrent = (_numItems: number) => false;

	$effect(() => {
		const argsObject = $state.snapshot(
			typeof args === 'function' ? args() : args
		) as PaginatedQueryArgs<Query>;
		state.results = [];
		state.status = 'LoadingFirstPage';
		state.error = undefined;
		loadMoreCurrent = (_numItems: number) => false;

		const unsubscribe = (
			client as unknown as PaginatedSubscriptionClient
		).onPaginatedUpdate_experimental(
			query,
			argsObject,
			{ initialNumItems: options.initialNumItems },
			(result) => {
				state.results = structuredClone(result.results);
				state.status = result.status;
				state.error = undefined;
				loadMoreCurrent = result.loadMore;
			},
			(error) => {
				state.error = error;
			}
		);

		return unsubscribe;
	});

	return {
		get data() {
			return state.results;
		},
		get status() {
			return state.status;
		},
		get isLoading() {
			return state.status === 'LoadingFirstPage' && state.error === undefined;
		},
		get isLoadingMore() {
			return state.status === 'LoadingMore';
		},
		get error() {
			return state.error;
		},
		loadMore(numItems: number) {
			return loadMoreCurrent(numItems);
		}
	};
}
