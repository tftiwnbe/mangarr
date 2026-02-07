<script lang="ts">
	import { cn } from '$lib/utils';
	import TitleCard from '$lib/components/title-card/title-card.svelte';
	import { Button } from '$lib/elements/button/index.js';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Title } from '$lib/mock-data';
	import type { Component } from 'svelte';

	interface Props {
		title: string;
		icon?: Component;
		href?: string;
		titles: Title[];
		class?: string;
	}

	let { title, icon: Icon, href, titles, class: className }: Props = $props();
</script>

<section class={cn('flex flex-col gap-4', className)}>
	<!-- Section Header -->
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			{#if Icon}
				<Icon class="size-5 text-muted-foreground" />
			{/if}
			<h2 class="text-lg font-semibold">{title}</h2>
		</div>
		{#if href}
			<Button variant="ghost" size="sm" href={href} class="text-muted-foreground">
				View all
				<ChevronRightIcon class="ml-1 size-4" />
			</Button>
		{/if}
	</div>

	<!-- Scrollable Title List -->
	<div class="relative -mx-4">
		<div
			class="scrollbar-hide flex gap-3 overflow-x-auto px-4 pb-2"
		>
			{#each titles as item (item.id)}
				<TitleCard {item} />
			{/each}
		</div>
	</div>
</section>

<style>
	.scrollbar-hide {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
	.scrollbar-hide::-webkit-scrollbar {
		display: none;
	}
</style>
