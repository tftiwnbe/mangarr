<script lang="ts">
	import { page } from '$app/state';
	import { cn } from '$lib/utils';
	import { useSidebar } from '$lib/elements/sidebar/index.js';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import type { Component } from 'svelte';

	interface NavItem {
		title: string;
		url: string;
		icon: Component;
	}

	let {
		items,
		class: className
	}: {
		items: NavItem[];
		class?: string;
	} = $props();

	const sidebar = useSidebar();

	function isActive(url: string): boolean {
		return page.url.pathname === url;
	}

	// Show max 4 items in mobile nav
	const visibleItems = $derived(items.slice(0, 4));
</script>

<nav
	class={cn(
		'fixed right-0 bottom-0 left-0 z-50 border-t bg-background md:hidden',
		className
	)}
>
	<div class="flex items-center justify-around">
		{#each visibleItems as item (item.title)}
			{@const active = isActive(item.url)}
			<a
				href={item.url}
				class={cn(
					'flex flex-1 flex-col items-center justify-center gap-1 py-3 text-muted-foreground transition-colors',
					active && 'text-primary'
				)}
			>
				<item.icon class="size-5" />
				<span class="text-xs font-medium">{item.title}</span>
			</a>
		{/each}

		<button
			onclick={() => sidebar.toggle()}
			class="flex flex-1 flex-col items-center justify-center gap-1 py-3 text-muted-foreground transition-colors"
		>
			<MenuIcon class="size-5" />
			<span class="text-xs font-medium">More</span>
		</button>
	</div>
</nav>
