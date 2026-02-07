<script lang="ts">
	import { page } from '$app/state';
	import * as Sidebar from '$lib/elements/sidebar/index.js';
	import type { Component, ComponentProps } from 'svelte';

	interface NavItem {
		title: string;
		url: string;
		icon: Component;
	}

	let {
		items,
		class: className,
		...restProps
	}: { items: NavItem[] } & ComponentProps<typeof Sidebar.Group> = $props();

	function isActive(url: string): boolean {
		return page.url.pathname === url || page.url.pathname.startsWith(url + '/');
	}
</script>

<Sidebar.Group class={className} {...restProps}>
	<Sidebar.GroupContent>
		<Sidebar.Menu>
			{#each items as item (item.title)}
				<Sidebar.MenuItem>
					<Sidebar.MenuButton size="sm" isActive={isActive(item.url)}>
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
	</Sidebar.GroupContent>
</Sidebar.Group>
