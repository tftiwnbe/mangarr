<script lang="ts">
	import { PageHeader } from '$lib/components/page-header/index.js';
	import TitleGrid from '$lib/components/title-grid/title-grid.svelte';
	import { recentlyAddedTitles } from '$lib/mock-data';
</script>

<PageHeader
	title="Recently Added"
	description="New titles added to your sources"
	breadcrumbs={[
		{ label: 'Discover', href: '/' },
		{ label: 'Updates' }
	]}
/>

<main class="px-4 pb-24">
	<TitleGrid titles={recentlyAddedTitles} />
</main>
