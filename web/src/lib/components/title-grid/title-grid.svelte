<script lang="ts">
	import { cn } from '$lib/utils';
	import TitleCard from '$lib/components/title-card/title-card.svelte';
	import type { TitleCardItem } from '$lib/models/title';
	import type { Snippet } from 'svelte';

	interface Props {
		titles: TitleCardItem[];
		emptyState?: Snippet;
		class?: string;
	}

	let { titles, emptyState, class: className }: Props = $props();
</script>

{#if titles.length === 0}
	{#if emptyState}
		{@render emptyState()}
	{:else}
		<div class="flex flex-col items-center justify-center py-16 text-center">
			<p class="text-muted-foreground">No titles found</p>
		</div>
	{/if}
{:else}
	<div
		class={cn(
			'grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7',
			className
		)}
	>
		{#each titles as item (item.id)}
			<TitleCard {item} class="w-full" />
		{/each}
	</div>
{/if}
