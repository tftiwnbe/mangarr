<script lang="ts">
	import { page } from '$app/state';
	import * as Sidebar from '$lib/elements/sidebar/index.js';
	import type { Component } from 'svelte';

	interface CategoryItem {
		title: string;
		url: string;
		icon: Component;
	}

	let { items }: { items: CategoryItem[] } = $props();

	function isActive(url: string): boolean {
		return page.url.href.includes(url);
	}
</script>

<Sidebar.Group class="group-data-[collapsible=icon]:hidden">
	<Sidebar.GroupLabel>Categories</Sidebar.GroupLabel>
	<Sidebar.Menu>
		{#each items as item (item.title)}
			<Sidebar.MenuItem>
				<Sidebar.MenuButton isActive={isActive(item.url)}>
					{#snippet child({ props })}
						<a href={item.url} {...props}>
							<item.icon />
							<span>{item.title}</span>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		{/each}
	</Sidebar.Menu>
</Sidebar.Group>
