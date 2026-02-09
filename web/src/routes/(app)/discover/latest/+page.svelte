<script lang="ts">
	import { onMount } from 'svelte';

	import { PageHeader } from '$lib/components/page-header/index.js';
	import TitleGrid from '$lib/components/title-grid/title-grid.svelte';
	import { Button } from '$lib/elements/button/index.js';
	import { latestTitlesStore } from '$lib/stores/discover';

	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';

	onMount(() => {
		void latestTitlesStore.load();
	});
</script>

<PageHeader
	title="Latest Updates"
	description="Recently updated titles from your sources"
	breadcrumbs={[
		{ label: 'Discover', href: '/' },
		{ label: 'Latest' }
	]}
>
	{#snippet actions()}
		<Button
			variant="outline"
			size="sm"
			disabled={$latestTitlesStore.isRefreshing}
			onclick={() => {
				void latestTitlesStore.refresh();
			}}
		>
			<RefreshCwIcon class="size-4 {$latestTitlesStore.isRefreshing ? 'animate-spin' : ''}" />
		</Button>
	{/snippet}
</PageHeader>

<main class="flex flex-col gap-4 px-4 pb-24">
	{#if $latestTitlesStore.error && $latestTitlesStore.data.length === 0}
		<div class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
			<p class="font-medium">Failed to load latest updates</p>
			<p class="text-muted-foreground">{$latestTitlesStore.error}</p>
		</div>
	{/if}

	<TitleGrid titles={$latestTitlesStore.data}>
		{#snippet emptyState()}
			<div class="flex flex-col items-center justify-center py-16 text-center">
				<p class="text-muted-foreground">
					{$latestTitlesStore.isLoading ? 'Loading latest updates...' : 'No recent updates available'}
				</p>
			</div>
		{/snippet}
	</TitleGrid>
</main>
