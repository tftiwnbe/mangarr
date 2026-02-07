<script lang="ts">
	import { PageHeader } from '$lib/components/page-header/index.js';
	import TitleGrid from '$lib/components/title-grid/title-grid.svelte';
	import { popularTitles } from '$lib/mock-data';
</script>

<PageHeader
	title="Popular"
	description="Most read titles across all sources"
	breadcrumbs={[
		{ label: 'Discover', href: '/' },
		{ label: 'Popular' }
	]}
/>

<main class="px-4 pb-24">
	<TitleGrid titles={popularTitles} />
</main>
