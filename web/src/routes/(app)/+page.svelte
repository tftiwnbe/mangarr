<script lang="ts">
	import { PageHeader } from '$lib/components/page-header/index.js';
	import TitleSection from '$lib/components/title-section/title-section.svelte';
	import { popularTitles, latestTitles, recentlyAddedTitles } from '$lib/mock-data';

	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
</script>

<PageHeader
	title="Discover"
	description="Find your next favorite read"
	breadcrumbs={[{ label: 'Home' }]}
/>

<main class="flex flex-col gap-8 px-4 pb-24">
	<TitleSection
		title="Popular"
		icon={TrendingUpIcon}
		href="/discover/popular"
		titles={popularTitles}
	/>

	<TitleSection
		title="Latest Updates"
		icon={ClockIcon}
		href="/discover/latest"
		titles={latestTitles}
	/>

	<TitleSection
		title="Recently Added"
		icon={SparklesIcon}
		href="/discover/updates"
		titles={recentlyAddedTitles}
	/>
</main>
