<script lang="ts">
	import { onMount } from 'svelte';

	import { PageHeader } from '$lib/components/page-header/index.js';
	import TitleGrid from '$lib/components/title-grid/title-grid.svelte';
	import { Button } from '$lib/elements/button/index.js';
	import { popularTitlesStore } from '$lib/stores/discover';

	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';

	onMount(() => {
		void popularTitlesStore.load();
	});
</script>

<PageHeader
	title="Popular"
	description="Most read titles across your enabled sources"
	breadcrumbs={[
		{ label: 'Discover', href: '/' },
		{ label: 'Popular' }
	]}
>
	{#snippet actions()}
		<Button
			variant="outline"
			size="sm"
			disabled={$popularTitlesStore.isRefreshing}
			onclick={() => {
				void popularTitlesStore.refresh();
			}}
		>
			<RefreshCwIcon class="size-4 {$popularTitlesStore.isRefreshing ? 'animate-spin' : ''}" />
		</Button>
	{/snippet}
</PageHeader>

<main class="flex flex-col gap-4 px-4 pb-24">
	{#if $popularTitlesStore.error && $popularTitlesStore.data.length === 0}
		<div class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
			<p class="font-medium">Failed to load popular titles</p>
			<p class="text-muted-foreground">{$popularTitlesStore.error}</p>
		</div>
	{/if}

	<TitleGrid titles={$popularTitlesStore.data}>
		{#snippet emptyState()}
			<div class="flex flex-col items-center justify-center py-16 text-center">
				<p class="text-muted-foreground">
					{$popularTitlesStore.isLoading ? 'Loading popular titles...' : 'No popular titles available'}
				</p>
			</div>
		{/snippet}
	</TitleGrid>
</main>
