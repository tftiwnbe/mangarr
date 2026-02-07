<script lang="ts">
	import NavTitles from './nav-titles.svelte';
	import NavCategories from './nav-categories.svelte';
	import NavSettings from './nav-settings.svelte';
	import NavUser from './nav-user.svelte';
	import NavMobile from './nav-mobile.svelte';
	import * as Sidebar from '$lib/elements/sidebar/index.js';
	import CommandIcon from '@lucide/svelte/icons/command';
	import type { Component, ComponentProps } from 'svelte';

	interface User {
		name: string;
		email: string;
		avatar: string;
	}

	interface NavItem {
		title: string;
		url: string;
		icon: Component;
		isActive?: boolean;
		items?: { title: string; url: string }[];
	}

	interface Category {
		name: string;
		url: string;
		icon: Component;
	}

	interface SidebarData {
		titles: NavItem[];
		categories: Category[];
		settings: NavItem[];
		mobile?: NavItem[];
		user: User;
	}

	interface Props extends ComponentProps<typeof Sidebar.Root> {
		links: SidebarData;
		mobileNavVariant?: 'floating' | 'compact';
	}
	let {
		ref = $bindable(null),
		links,
		mobileNavVariant = 'floating',
		...restProps
	}: Props = $props();
	const mobileNavItems = $derived(links.mobile || links.titles.slice(0, 4));
</script>

<Sidebar.Root bind:ref variant="inset" {...restProps}>
	<!-- <Sidebar.Header> -->
	<!-- 	<Sidebar.Menu> -->
	<!-- 		<Sidebar.MenuItem> -->
	<!-- 			<Sidebar.MenuButton size="lg"> -->
	<!-- 				{#snippet child({ props })} -->
	<!-- 					<a href="##" {...props}> -->
	<!-- 						<div -->
	<!-- 							class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground" -->
	<!-- 						> -->
	<!-- 							<CommandIcon class="size-4" /> -->
	<!-- 						</div> -->
	<!-- 						<div class="grid flex-1 text-left text-sm leading-tight"> -->
	<!-- 							<span class="truncate font-medium">Acme Inc</span> -->
	<!-- 							<span class="truncate text-xs">Enterprise</span> -->
	<!-- 						</div> -->
	<!-- 					</a> -->
	<!-- 				{/snippet} -->
	<!-- 			</Sidebar.MenuButton> -->
	<!-- 		</Sidebar.MenuItem> -->
	<!-- 	</Sidebar.Menu> -->
	<!-- </Sidebar.Header> -->
	<Sidebar.Content>
		<NavTitles items={links.titles} />
		<NavCategories categories={links.categories} />
		<NavSettings items={links.settings} class="mt-auto" />
	</Sidebar.Content>
	<Sidebar.Footer>
		<NavUser user={links.user} />
	</Sidebar.Footer>
</Sidebar.Root>
<NavMobile items={mobileNavItems} variant={mobileNavVariant} />
