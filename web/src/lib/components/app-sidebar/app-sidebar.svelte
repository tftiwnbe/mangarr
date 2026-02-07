<script lang="ts">
	import * as Sidebar from '$lib/elements/sidebar/index.js';
	import NavMain from './nav-main.svelte';
	import NavCategories from './nav-categories.svelte';
	import NavSecondary from './nav-secondary.svelte';
	import MobileNav from './mobile-nav.svelte';

	import CompassIcon from '@lucide/svelte/icons/compass';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import LibraryIcon from '@lucide/svelte/icons/library-big';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import PuzzleIcon from '@lucide/svelte/icons/puzzle';
	import HeartIcon from '@lucide/svelte/icons/heart';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import ClockIcon from '@lucide/svelte/icons/clock';

	const navigation = {
		main: [
			{
				title: 'Discover',
				url: '/',
				icon: CompassIcon,
				items: [
					{ title: 'Updates', url: '/discover/updates' },
					{ title: 'Latest', url: '/discover/latest' },
					{ title: 'Popular', url: '/discover/popular' }
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
			{ title: 'Favorites', url: '/library?category=favorites', icon: HeartIcon },
			{ title: 'Reading', url: '/library?category=reading', icon: BookOpenIcon },
			{ title: 'Completed', url: '/library?category=completed', icon: CheckCircleIcon },
			{ title: 'Plan to Read', url: '/library?category=plan-to-read', icon: ClockIcon }
		],
		secondary: [
			{ title: 'Extensions', url: '/extensions', icon: PuzzleIcon },
			{ title: 'Settings', url: '/settings', icon: SettingsIcon }
		]
	};
</script>

<Sidebar.Root variant="inset">
	<Sidebar.Content>
		<NavMain items={navigation.main} />
		<NavCategories items={navigation.categories} />
		<NavSecondary items={navigation.secondary} class="mt-auto" />
	</Sidebar.Content>
</Sidebar.Root>
<MobileNav items={navigation.main} />
