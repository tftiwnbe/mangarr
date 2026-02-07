<script lang="ts">
	import { resolve } from '$app/paths';
	import { cn } from '$lib/utils';
	import { useSidebar } from '$lib/elements/sidebar/index.js';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import type { Component } from 'svelte';

	const variantClasses = {
		floating: 'mx-4 mb-4 rounded-2xl shadow-lg border',
		compact: 'rounded-none border-t'
	};

	let {
		items,
		variant = 'floating',
		class: className
	}: {
		items: {
			title: string;
			url: string;
			icon: Component;
			isActive?: boolean;
		}[];
		variant?: 'floating' | 'compact';
		class?: string;
	} = $props();

	const sidebar = useSidebar();
</script>

<nav
	class={cn(
		'fixed right-0 bottom-0 left-0 z-50 bg-background md:hidden',
		variantClasses[variant],
		className
	)}
>
	<div class="flex items-center justify-around">
		{#each items as item (item.title)}
			<a
				href={resolve(item.url)}
				class={cn(
					'flex flex-col items-center justify-center gap-1 px-3 py-3 text-muted-foreground transition-colors hover:text-foreground',
					variant === 'floating' ? 'min-w-[72px]' : 'flex-1',
					item.isActive && 'text-foreground'
				)}
			>
				<item.icon class="size-5" />
				<span class="text-xs font-medium">{item.title}</span>
			</a>
		{/each}

		<!-- Sidebar Toggle Button -->
		<button
			onclick={() => sidebar.toggle()}
			class={cn(
				'flex flex-col items-center justify-center gap-1 px-3 py-3 text-muted-foreground transition-colors hover:text-foreground',
				variant === 'floating' ? 'min-w-[72px]' : 'flex-1'
			)}
		>
			<MenuIcon class="size-5" />
			<span class="text-xs font-medium">Menu</span>
		</button>
	</div>
</nav>
