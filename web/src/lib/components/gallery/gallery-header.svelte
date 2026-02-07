<script lang="ts">
	import { cn } from '$lib/utils';
	import GridIcon from '@lucide/svelte/icons/grid-3x3';
	import ListIcon from '@lucide/svelte/icons/list';
	import LayoutListIcon from '@lucide/svelte/icons/layout-list';
	import type { Snippet } from 'svelte';

	type ViewType = 'grid' | 'list' | 'carousel';

	let {
		title,
		count,
		view = $bindable('grid'),
		availableViews = ['grid', 'list', 'carousel'],
		showToggle = true,
		actions,
		class: className
	}: {
		title?: string;
		count?: number;
		view?: ViewType;
		availableViews?: ViewType[];
		showToggle?: boolean;
		actions?: Snippet;
		class?: string;
	} = $props();

	const viewIcons: Record<ViewType, typeof GridIcon> = {
		grid: GridIcon,
		list: ListIcon,
		carousel: LayoutListIcon
	};

	const viewLabels: Record<ViewType, string> = {
		grid: 'Grid view',
		list: 'List view',
		carousel: 'Carousel view'
	};
</script>

<div class={cn('mb-4 flex items-center justify-between gap-4', className)}>
	<div class="min-w-0 flex-1">
		{#if title}
			<h2 class="text-lg font-semibold md:text-xl">{title}</h2>
		{/if}
		{#if count !== undefined}
			<p class="text-sm text-muted-foreground">
				{count}
				{count === 1 ? 'item' : 'items'}
			</p>
		{/if}
	</div>

	<div class="flex flex-shrink-0 items-center gap-2">
		{#if actions}
			{@render actions()}
		{/if}

		{#if showToggle && availableViews.length > 1}
			<div class="flex gap-1 rounded-lg border bg-background p-1 shadow-sm">
				{#each availableViews as viewType}
					{@const Icon = viewIcons[viewType]}
					<button
						type="button"
						onclick={() => (view = viewType)}
						class={cn(
							'rounded-md p-2 transition-all',
							view === viewType
								? 'bg-primary text-primary-foreground shadow-sm'
								: 'text-muted-foreground hover:bg-muted hover:text-foreground'
						)}
						aria-label={viewLabels[viewType]}
						aria-pressed={view === viewType}
					>
						<Icon class="size-4" />
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
