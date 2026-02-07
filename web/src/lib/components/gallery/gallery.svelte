<script lang="ts">
	import { cn } from '$lib/utils';
	import GalleryHeader from './gallery-header.svelte';
	import GalleryGrid from './gallery-grid.svelte';
	import GalleryList from './gallery-list.svelte';
	import GalleryCarousel from './gallery-carousel.svelte';
	import type { Snippet } from 'svelte';
	import type { ComponentProps } from 'svelte';

	type ViewType = 'grid' | 'list' | 'carousel';

	interface GalleryItem {
		id: string;
		[key: string]: any;
	}

	let {
		items,
		title,
		defaultView = 'grid',
		availableViews = ['grid', 'list', 'carousel'],
		showToggle = true,
		gridColumns,
		listGap,
		carouselOptions,
		renderItem,
		emptyState,
		headerActions,
		class: className
	}: {
		items: GalleryItem[];
		title?: string;
		defaultView?: ViewType;
		availableViews?: ViewType[];
		showToggle?: boolean;
		gridColumns?: ComponentProps<typeof GalleryGrid>['columns'];
		listGap?: ComponentProps<typeof GalleryList>['gap'];
		carouselOptions?: Omit<ComponentProps<typeof GalleryCarousel>, 'children'>;
		renderItem: Snippet<[GalleryItem, ViewType]>;
		emptyState?: Snippet;
		headerActions?: Snippet;
		class?: string;
	} = $props();

	let view = $state<ViewType>(defaultView);
</script>

<div class={cn('w-full', className)}>
	<GalleryHeader
		{title}
		count={items.length}
		bind:view
		{availableViews}
		{showToggle}
		actions={headerActions}
	/>

	{#if items.length === 0}
		{#if emptyState}
			{@render emptyState()}
		{:else}
			<div class="flex flex-col items-center justify-center py-12 text-center">
				<p class="text-muted-foreground">No items found</p>
			</div>
		{/if}
	{:else if view === 'grid'}
		<GalleryGrid columns={gridColumns}>
			{#each items as item (item.id)}
				{@render renderItem(item, view)}
			{/each}
		</GalleryGrid>
	{:else if view === 'list'}
		<GalleryList gap={listGap}>
			{#each items as item (item.id)}
				{@render renderItem(item, view)}
			{/each}
		</GalleryList>
	{:else if view === 'carousel'}
		<GalleryCarousel {...carouselOptions}>
			{#each items as item (item.id)}
				{@render renderItem(item, view)}
			{/each}
		</GalleryCarousel>
	{/if}
</div>
