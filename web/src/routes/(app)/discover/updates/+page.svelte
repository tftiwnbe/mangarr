<script lang="ts">
	import { onMount } from 'svelte';

	import { PageHeader } from '$lib/components/page-header/index.js';
	import TitleGrid from '$lib/components/title-grid/title-grid.svelte';
	import { Button } from '$lib/elements/button/index.js';
	import { updatesTitlesStore } from '$lib/stores/discover';

	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';

	onMount(() => {
		void updatesTitlesStore.load();
	});
</script>

<PageHeader
	title="Recently Added"
	description="Fresh picks and backfilled updates from your feeds"
	breadcrumbs={[
		{ label: 'Discover', href: '/' },
		{ label: 'Updates' }
	]}
>
	{#snippet actions()}
		<Button
			variant="outline"
			size="sm"
			disabled={$updatesTitlesStore.isRefreshing}
			onclick={() => {
				void updatesTitlesStore.refresh();
			}}
		>
			<RefreshCwIcon class="size-4 {$updatesTitlesStore.isRefreshing ? 'animate-spin' : ''}" />
		</Button>
	{/snippet}
</PageHeader>

<main class="flex flex-col gap-4 px-4 pb-24">
	{#if $updatesTitlesStore.error && $updatesTitlesStore.data.length === 0}
		<div class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
			<p class="font-medium">Failed to load recent additions</p>
			<p class="text-muted-foreground">{$updatesTitlesStore.error}</p>
		</div>
	{/if}

	<TitleGrid titles={$updatesTitlesStore.data}>
		{#snippet emptyState()}
			<div class="flex flex-col items-center justify-center py-16 text-center">
				<p class="text-muted-foreground">
					{$updatesTitlesStore.isLoading ? 'Loading new additions...' : 'No additional titles available'}
				</p>
			</div>
		{/snippet}
	</TitleGrid>
</main>
