<script lang="ts">
	import { PageHeader } from '$lib/components/page-header/index.js';
	import TitleGrid from '$lib/components/title-grid/title-grid.svelte';
	import { latestTitles } from '$lib/mock-data';
</script>

<PageHeader
	title="Latest Updates"
	description="Recently updated titles from your sources"
	breadcrumbs={[
		{ label: 'Discover', href: '/' },
		{ label: 'Latest' }
	]}
/>

<main class="px-4 pb-24">
	<TitleGrid titles={latestTitles} />
</main>
