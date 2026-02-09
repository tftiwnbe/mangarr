<script lang="ts">
	import { onMount } from 'svelte';

	import { page } from '$app/state';
	import { PageHeader } from '$lib/components/page-header/index.js';
	import TitleGrid from '$lib/components/title-grid/title-grid.svelte';
	import { Button } from '$lib/elements/button/index.js';
	import { Input } from '$lib/elements/input/index.js';
	import { Badge } from '$lib/elements/badge/index.js';
	import { libraryTitlesStore } from '$lib/stores/library';
	import type { TitleStatus } from '$lib/models/title';

	import SearchIcon from '@lucide/svelte/icons/search';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import LibraryIcon from '@lucide/svelte/icons/library-big';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import ClockIcon from '@lucide/svelte/icons/clock';

	type StatusFilter = 'all' | TitleStatus;

	const statusFilters: { label: string; value: StatusFilter }[] = [
		{ label: 'All', value: 'all' },
		{ label: 'Ongoing', value: 'ongoing' },
		{ label: 'Completed', value: 'completed' },
		{ label: 'Hiatus', value: 'hiatus' }
	];

	const categoryToStatus: Record<string, StatusFilter> = {
		completed: 'completed',
		reading: 'ongoing'
	};

	let searchQuery = $state('');
	let activeStatus = $state<StatusFilter>('all');

	const categoryParam = $derived(page.url.searchParams.get('category') ?? '');

	$effect(() => {
		const categoryStatus = categoryToStatus[categoryParam] ?? 'all';
		if (categoryStatus !== 'all') {
			activeStatus = categoryStatus;
		}
	});

	onMount(() => {
		void libraryTitlesStore.load({ offset: 0, limit: 200 });
	});

	const filteredTitles = $derived.by(() => {
		const query = searchQuery.trim().toLowerCase();
		return $libraryTitlesStore.data.filter((title) => {
			const statusMatches = activeStatus === 'all' || title.status === activeStatus;
			if (!statusMatches) {
				return false;
			}
			if (!query) {
				return true;
			}
			return (
				title.title.toLowerCase().includes(query) ||
				(title.author ?? '').toLowerCase().includes(query)
			);
		});
	});

	const completedCount = $derived(
		$libraryTitlesStore.data.filter((title) => title.status === 'completed').length
	);
	const ongoingCount = $derived(
		$libraryTitlesStore.data.filter((title) => title.status === 'ongoing').length
	);
</script>

<PageHeader
	title="Library"
	description="Synced titles imported from discover feeds"
	breadcrumbs={[{ label: 'Library' }]}
>
	{#snippet actions()}
		<Button
			variant="outline"
			size="sm"
			disabled={$libraryTitlesStore.isRefreshing}
			onclick={() => {
				void libraryTitlesStore.refresh({ offset: 0, limit: 200 });
			}}
		>
			<RefreshCwIcon class="size-4 {$libraryTitlesStore.isRefreshing ? 'animate-spin' : ''}" />
		</Button>
	{/snippet}
</PageHeader>

<main class="flex flex-col gap-6 px-4 pb-24">
	{#if $libraryTitlesStore.error && $libraryTitlesStore.data.length === 0}
		<div class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
			<p class="font-medium">Failed to load library</p>
			<p class="text-muted-foreground">{$libraryTitlesStore.error}</p>
		</div>
	{/if}

	<div class="grid gap-3 sm:grid-cols-3">
		<div class="rounded-lg border bg-card p-4">
			<div class="flex items-center gap-2 text-muted-foreground">
				<LibraryIcon class="size-4" />
				<span class="text-sm">Total titles</span>
			</div>
			<p class="mt-2 text-2xl font-semibold">{$libraryTitlesStore.data.length}</p>
		</div>
		<div class="rounded-lg border bg-card p-4">
			<div class="flex items-center gap-2 text-muted-foreground">
				<ClockIcon class="size-4" />
				<span class="text-sm">Ongoing</span>
			</div>
			<p class="mt-2 text-2xl font-semibold">{ongoingCount}</p>
		</div>
		<div class="rounded-lg border bg-card p-4">
			<div class="flex items-center gap-2 text-muted-foreground">
				<CheckCircleIcon class="size-4" />
				<span class="text-sm">Completed</span>
			</div>
			<p class="mt-2 text-2xl font-semibold">{completedCount}</p>
		</div>
	</div>

	<div class="flex flex-col gap-3 rounded-lg border bg-card/70 p-4">
		<div class="relative">
			<SearchIcon class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				type="search"
				placeholder="Search imported titles"
				bind:value={searchQuery}
				class="pl-10"
			/>
		</div>
		<div class="flex flex-wrap gap-2">
			{#each statusFilters as filter (filter.value)}
				<Button
					variant={activeStatus === filter.value ? 'default' : 'outline'}
					size="sm"
					onclick={() => {
						activeStatus = filter.value;
					}}
				>
					{filter.label}
				</Button>
			{/each}
			{#if categoryParam}
				<Badge variant="secondary" class="ml-auto">category: {categoryParam}</Badge>
			{/if}
		</div>
	</div>

	<TitleGrid titles={filteredTitles}>
		{#snippet emptyState()}
			<div class="flex flex-col items-center justify-center py-16 text-center">
				<p class="text-muted-foreground">
					{$libraryTitlesStore.isLoading ? 'Loading library titles...' : 'No titles match your filters'}
				</p>
			</div>
		{/snippet}
	</TitleGrid>
</main>
