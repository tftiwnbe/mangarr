<script lang="ts">
	import { onMount } from 'svelte';

	import { PageHeader } from '$lib/components/page-header/index.js';
	import TitleGrid from '$lib/components/title-grid/title-grid.svelte';
	import { Input } from '$lib/elements/input/index.js';
	import { Button } from '$lib/elements/button/index.js';
	import * as Select from '$lib/elements/select/index.js';
	import { DebouncedValue } from '$lib/hooks/use-debounced-value.svelte';
	import {
		discoverSourcesStore,
		popularTitlesStore,
		searchTitlesStore
	} from '$lib/stores/discover';

	import SearchIcon from '@lucide/svelte/icons/search';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import XIcon from '@lucide/svelte/icons/x';

	let searchQuery = $state('');
	let selectedSource = $state('all');

	const debouncedQuery = new DebouncedValue(() => searchQuery, 350);
	const effectiveSource = $derived(selectedSource === 'all' ? null : selectedSource);
	const trimmedQuery = $derived((debouncedQuery.value ?? '').trim());

	onMount(() => {
		void Promise.allSettled([discoverSourcesStore.load(), popularTitlesStore.load()]);
	});

	$effect(() => {
		const query = trimmedQuery;
		if (query.length === 0) {
			searchTitlesStore.reset();
			return;
		}
		void searchTitlesStore.load(query, effectiveSource);
	});

	const results = $derived(trimmedQuery.length > 0 ? $searchTitlesStore.data : $popularTitlesStore.data);
	const isSearching = $derived(trimmedQuery.length > 0);
	const currentError = $derived(isSearching ? $searchTitlesStore.error : $popularTitlesStore.error);
	const selectedSourceLabel = $derived(
		selectedSource === 'all'
			? 'All sources'
			: ($discoverSourcesStore.data.find((source) => source.id === selectedSource)?.name ?? 'Source')
	);
</script>

<PageHeader
	title="Search"
	description="Search titles across enabled sources"
	breadcrumbs={[{ label: 'Search' }]}
>
	{#snippet actions()}
		<Button
			variant="outline"
			size="sm"
			disabled={$searchTitlesStore.isRefreshing}
			onclick={() => {
				if (trimmedQuery.length > 0) {
					void searchTitlesStore.refresh(trimmedQuery, effectiveSource);
				}
			}}
		>
			<RefreshCwIcon class="size-4 {$searchTitlesStore.isRefreshing ? 'animate-spin' : ''}" />
		</Button>
	{/snippet}
</PageHeader>

<main class="flex flex-col gap-6 px-4 pb-24">
	<div class="grid gap-3 md:grid-cols-[1fr,15rem]">
		<div class="relative">
			<SearchIcon class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				type="search"
				placeholder="Search by title"
				bind:value={searchQuery}
				class="pl-10"
			/>
			{#if searchQuery.trim().length > 0}
				<Button
					variant="ghost"
					size="icon"
					class="absolute top-1/2 right-1 size-8 -translate-y-1/2"
					onclick={() => {
						searchQuery = '';
					}}
				>
					<XIcon class="size-4" />
				</Button>
			{/if}
		</div>

		<Select.Root type="single" bind:value={selectedSource}>
			<Select.Trigger>{selectedSourceLabel}</Select.Trigger>
			<Select.Content>
				<Select.Item value="all">All sources</Select.Item>
				{#each $discoverSourcesStore.data as source (source.id)}
					<Select.Item value={source.id}>{source.name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	{#if currentError && results.length === 0}
		<div class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
			<p class="font-medium">Search request failed</p>
			<p class="text-muted-foreground">{currentError}</p>
		</div>
	{/if}

	<div class="flex items-center justify-between text-sm text-muted-foreground">
		<p>
			{isSearching ? `${results.length} result${results.length === 1 ? '' : 's'}` : 'Popular titles'}
		</p>
		{#if isSearching && $searchTitlesStore.isLoading}
			<p>Searching...</p>
		{/if}
	</div>

	<TitleGrid titles={results}>
		{#snippet emptyState()}
			<div class="flex flex-col items-center justify-center py-16 text-center">
				<p class="text-muted-foreground">
					{isSearching
						? ($searchTitlesStore.isLoading ? 'Searching titles...' : 'No matches found')
						: 'No popular titles available'}
				</p>
			</div>
		{/snippet}
	</TitleGrid>
</main>
