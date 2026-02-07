<script lang="ts">
	import NavSidebar from '$components/nav-sidebar/sidebar.svelte';
	import * as Sidebar from '$elements/sidebar/index.js';

	import SettingsIcon from '@lucide/svelte/icons/settings';
	import CompassIcon from '@lucide/svelte/icons/compass';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import LibraryIcon from '@lucide/svelte/icons/library';
	import PuzzleIcon from '@lucide/svelte/icons/puzzle';
	import SearchIcon from '@lucide/svelte/icons/search';
	import BookmarkIcon from '@lucide/svelte/icons/bookmark';
	import HeartIcon from '@lucide/svelte/icons/heart';
	import InboxIcon from '@lucide/svelte/icons/inbox';

	let { children } = $props();
	const links = {
		titles: [
			{
				title: 'Discover',
				url: '/',
				icon: CompassIcon,
				isActive: true,
				items: [
					{ title: 'Updates', url: '/discover/updates' },
					{ title: 'Latest', url: '/discover/latest' },
					{ title: 'Popular', url: '/discover/popular' },
					{ title: 'Recomended', url: '/discover/recomended' }
				]
			},
			{
				title: 'Library',
				url: '/library',
				icon: LibraryIcon
			},
			{
				title: 'Search',
				url: '/search',
				icon: SearchIcon
			},
			{
				title: 'Downloads',
				url: '/downloads',
				icon: DownloadIcon
			}
		],
		categories: [
			{ name: 'Favorites', url: '/library?category=favorites', icon: HeartIcon },
			{ name: 'Plan to Read', url: '/library?category=plan', icon: BookmarkIcon },
			{ name: 'Uncategorized', url: '/library?category=uncategorized', icon: InboxIcon }
		],
		settings: [
			{ title: 'Settings', url: '/settings', icon: SettingsIcon },
			{ title: 'Extensions', url: '/extensions', icon: PuzzleIcon }
		],
		// WARNING: Remove user from here
		user: {
			name: 'shadcn',
			email: 'm@example.com',
			avatar: '/avatars/shadcn.jpg'
		}
	};
</script>

<Sidebar.Provider>
	<NavSidebar {links} />
	<Sidebar.Inset>
		{@render children()}
	</Sidebar.Inset>
</Sidebar.Provider>
