<script lang="ts">
	import { onMount } from 'svelte';

	import { PageHeader } from '$lib/components/page-header/index.js';
	import TitleSection from '$lib/components/title-section/title-section.svelte';
	import { Button } from '$lib/elements/button/index.js';
	import { latestTitlesStore, popularTitlesStore, updatesTitlesStore } from '$lib/stores/discover';
	import { libraryTitlesStore } from '$lib/stores/library';

	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import LibraryIcon from '@lucide/svelte/icons/library-big';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';

	async function loadDiscoverData(force = false): Promise<void> {
		const loader = force ? 'refresh' : 'load';
		await Promise.allSettled([
			popularTitlesStore[loader](),
			latestTitlesStore[loader](),
			updatesTitlesStore[loader](),
			libraryTitlesStore[loader]({ offset: 0, limit: 40 })
		]);
	}

	onMount(() => {
		void loadDiscoverData();
	});

	const featuredLibraryTitles = $derived($libraryTitlesStore.data.slice(0, 12));
	const communityHighlights = $derived(
		featuredLibraryTitles.length > 0 ? featuredLibraryTitles : $updatesTitlesStore.data
	);
	const highlightsTitle = $derived(
		featuredLibraryTitles.length > 0 ? 'From Your Library' : 'Community Highlights'
	);
	const highlightsHref = $derived(featuredLibraryTitles.length > 0 ? '/library' : '/discover/updates');

	const loading = $derived(
		$popularTitlesStore.isLoading ||
			$latestTitlesStore.isLoading ||
			$updatesTitlesStore.isLoading ||
			$libraryTitlesStore.isLoading
	);

	const discoverError = $derived(
		$popularTitlesStore.error ?? $latestTitlesStore.error ?? $updatesTitlesStore.error
	);
</script>

<PageHeader
	title="Discover"
	description="Live recommendations from your configured sources"
	breadcrumbs={[{ label: 'Home' }]}
>
	{#snippet actions()}
		<Button
			variant="outline"
			size="sm"
			class="gap-2"
			disabled={$popularTitlesStore.isRefreshing || $latestTitlesStore.isRefreshing}
			onclick={() => {
				void loadDiscoverData(true);
			}}
		>
			<RefreshCwIcon
				class="size-4 {($popularTitlesStore.isRefreshing || $latestTitlesStore.isRefreshing)
					? 'animate-spin'
					: ''}"
			/>
			Refresh
		</Button>
	{/snippet}
</PageHeader>

<main class="flex flex-col gap-8 px-4 pb-24">
	{#if discoverError && $popularTitlesStore.data.length === 0 && $latestTitlesStore.data.length === 0}
		<div class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
			<p class="font-medium">Unable to load discover feeds</p>
			<p class="text-muted-foreground">{discoverError}</p>
		</div>
	{/if}

	{#if loading && $popularTitlesStore.data.length === 0 && $latestTitlesStore.data.length === 0}
		<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
			{#each Array(4) as _, i (i)}
				<div class="h-28 animate-pulse rounded-lg border bg-card/60"></div>
			{/each}
		</div>
	{/if}

	<TitleSection
		title="Popular"
		icon={TrendingUpIcon}
		href="/discover/popular"
		titles={$popularTitlesStore.data}
	/>

	<TitleSection
		title="Latest Updates"
		icon={ClockIcon}
		href="/discover/latest"
		titles={$latestTitlesStore.data}
	/>

	<TitleSection
		title={highlightsTitle}
		icon={LibraryIcon}
		href={highlightsHref}
		titles={communityHighlights}
	/>
</main>
