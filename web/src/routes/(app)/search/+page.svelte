<script lang="ts">
	import { PageHeader } from '$lib/components/page-header/index.js';
	import TitleCard from '$lib/components/title-card/title-card.svelte';
	import { Input } from '$lib/elements/input/index.js';
	import { Button } from '$lib/elements/button/index.js';
	import { Badge } from '$lib/elements/badge/index.js';
	import * as Select from '$lib/elements/select/index.js';
	import { popularTitles, latestTitles, recentlyAddedTitles, type Title } from '$lib/mock-data';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';

	// Combine all titles for search
	const allTitles = [...popularTitles, ...latestTitles, ...recentlyAddedTitles];

	// Remove duplicates by id
	const uniqueTitles = allTitles.filter(
		(title, index, self) => index === self.findIndex((t) => t.id === title.id)
	);

	let searchQuery = $state('');
	let selectedStatus = $state<string>('all');
	let selectedGenres = $state<string[]>([]);
	let showFilters = $state(false);

	const genres = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Romance', 'Sci-Fi', 'Supernatural', 'Sports'];

	const statusOptions = [
		{ value: 'all', label: 'All Status' },
		{ value: 'ongoing', label: 'Ongoing' },
		{ value: 'completed', label: 'Completed' },
		{ value: 'hiatus', label: 'Hiatus' }
	];

	const filteredTitles = $derived.by(() => {
		let results = uniqueTitles;

		// Filter by search query
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			results = results.filter(
				(t) =>
					t.title.toLowerCase().includes(query) ||
					t.author?.toLowerCase().includes(query) ||
					t.genres?.some((g) => g.toLowerCase().includes(query))
			);
		}

		// Filter by status
		if (selectedStatus !== 'all') {
			results = results.filter((t) => t.status === selectedStatus);
		}

		// Filter by genres
		if (selectedGenres.length > 0) {
			results = results.filter((t) =>
				selectedGenres.some((g) => t.genres?.includes(g))
			);
		}

		return results;
	});

	function toggleGenre(genre: string) {
		if (selectedGenres.includes(genre)) {
			selectedGenres = selectedGenres.filter((g) => g !== genre);
		} else {
			selectedGenres = [...selectedGenres, genre];
		}
	}

	function clearFilters() {
		searchQuery = '';
		selectedStatus = 'all';
		selectedGenres = [];
	}

	const hasActiveFilters = $derived(
		searchQuery.trim() !== '' || selectedStatus !== 'all' || selectedGenres.length > 0
	);
</script>

<PageHeader
	title="Search"
	description="Find titles across all sources"
	breadcrumbs={[{ label: 'Search' }]}
/>

<main class="flex flex-col gap-6 px-4 pb-24">
	<!-- Search Input -->
	<div class="flex gap-2">
		<div class="relative flex-1">
			<SearchIcon class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				type="search"
				placeholder="Search titles, authors, genres..."
				bind:value={searchQuery}
				class="pl-10"
			/>
		</div>
		<Button
			variant={showFilters ? 'secondary' : 'outline'}
			size="icon"
			onclick={() => (showFilters = !showFilters)}
		>
			<SlidersHorizontalIcon class="size-4" />
		</Button>
	</div>

	<!-- Filters Panel -->
	{#if showFilters}
		<div class="flex flex-col gap-4 rounded-lg border bg-card p-4">
			<div class="flex items-center justify-between">
				<h3 class="font-medium">Filters</h3>
				{#if hasActiveFilters}
					<Button variant="ghost" size="sm" onclick={clearFilters}>
						Clear all
					</Button>
				{/if}
			</div>

			<!-- Status Filter -->
			<div class="flex flex-col gap-2">
				<label class="text-sm text-muted-foreground">Status</label>
				<Select.Root type="single" bind:value={selectedStatus}>
					<Select.Trigger class="w-full sm:w-48">
						{statusOptions.find((o) => o.value === selectedStatus)?.label || 'All Status'}
					</Select.Trigger>
					<Select.Content>
						{#each statusOptions as option (option.value)}
							<Select.Item value={option.value}>{option.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<!-- Genre Filter -->
			<div class="flex flex-col gap-2">
				<label class="text-sm text-muted-foreground">Genres</label>
				<div class="flex flex-wrap gap-2">
					{#each genres as genre (genre)}
						<button
							onclick={() => toggleGenre(genre)}
							class="rounded-full px-3 py-1 text-sm transition-colors {selectedGenres.includes(genre)
								? 'bg-primary text-primary-foreground'
								: 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}"
						>
							{genre}
						</button>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<!-- Active Filters Display -->
	{#if hasActiveFilters && !showFilters}
		<div class="flex flex-wrap items-center gap-2">
			<span class="text-sm text-muted-foreground">Filters:</span>
			{#if searchQuery.trim()}
				<Badge variant="secondary" class="gap-1">
					"{searchQuery}"
					<button onclick={() => (searchQuery = '')}>
						<XIcon class="size-3" />
					</button>
				</Badge>
			{/if}
			{#if selectedStatus !== 'all'}
				<Badge variant="secondary" class="gap-1">
					{selectedStatus}
					<button onclick={() => (selectedStatus = 'all')}>
						<XIcon class="size-3" />
					</button>
				</Badge>
			{/if}
			{#each selectedGenres as genre (genre)}
				<Badge variant="secondary" class="gap-1">
					{genre}
					<button onclick={() => toggleGenre(genre)}>
						<XIcon class="size-3" />
					</button>
				</Badge>
			{/each}
		</div>
	{/if}

	<!-- Results -->
	<div>
		<p class="mb-4 text-sm text-muted-foreground">
			{filteredTitles.length} {filteredTitles.length === 1 ? 'result' : 'results'}
		</p>

		{#if filteredTitles.length === 0}
			<div class="flex flex-col items-center justify-center py-16 text-center">
				<SearchIcon class="mb-4 size-12 text-muted-foreground/50" />
				<p class="text-muted-foreground">No titles found</p>
				{#if hasActiveFilters}
					<Button variant="link" onclick={clearFilters} class="mt-2">
						Clear filters
					</Button>
				{/if}
			</div>
		{:else}
			<div
				class="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7"
			>
				{#each filteredTitles as item (item.id)}
					<TitleCard {item} class="w-full" />
				{/each}
			</div>
		{/if}
	</div>
</main>
