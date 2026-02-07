<script lang="ts">
	import MangaCard, { type MangaCardData } from '$lib/components/manga-card.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import TagPill from '$lib/components/tag-pill.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	const statusFilters = ['Any status', 'Reading', 'Completed', 'Plan', 'On hold'];
	const genreFilters = ['Action', 'Romance', 'Fantasy', 'Mystery', 'Comedy', 'Sci-Fi'];
	const sortOptions = ['Relevance', 'Popularity', 'Updated', 'Rating'];

	const results: MangaCardData[] = [
		{
			title: 'Sable Horizon',
			slug: 'sable-horizon',
			meta: 'Updated 1d ago',
			tags: [{ label: 'Adventure' }, { label: 'Fantasy', tone: 'outline' }],
			description: 'Explorers map a desert of shifting ruins and hidden relics.',
			href: '/title/sable-horizon'
		},
		{
			title: 'Chromatic Hearts',
			slug: 'chromatic-hearts',
			meta: 'Updated 3d ago',
			tags: [{ label: 'Romance' }, { label: 'Drama', tone: 'outline' }],
			description: 'A prodigy painter and a musician fall for the same melody.',
			href: '/title/chromatic-hearts'
		},
		{
			title: 'Circuit Break',
			slug: 'circuit-break',
			meta: 'Updated 5d ago',
			tags: [{ label: 'Sci-Fi' }, { label: 'Thriller', tone: 'outline' }],
			description: 'An engineer uncovers a neural conspiracy in the megacity.',
			href: '/title/circuit-break'
		},
		{
			title: 'Moonlit Field Notes',
			slug: 'moonlit-field-notes',
			meta: 'Updated 6d ago',
			tags: [{ label: 'Slice of Life' }, { label: 'Mystery', tone: 'outline' }],
			description: 'A botanist documents supernatural flora in remote villages.',
			href: '/title/moonlit-field-notes'
		},
		{
			title: 'Skydock Mechanics',
			slug: 'skydock-mechanics',
			meta: 'Updated 1w ago',
			tags: [{ label: 'Sci-Fi' }, { label: 'Action', tone: 'outline' }],
			description: 'Mechanics keep airships battle-ready above a floating city.',
			href: '/title/skydock-mechanics'
		}
	];

	const hasResults = results.length > 0;
</script>

<section class="space-y-8">
	<SectionHeader
		title="Search results"
		description="Adjust the filters to quickly pivot genres, statuses, or sort order."
	/>

	<div
		class="grid gap-4 rounded-xl border border-border/70 bg-card/80 p-4 shadow-sm sm:grid-cols-[1fr_auto] sm:items-start"
	>
		<div class="space-y-3">
			<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Status</h3>
			<div class="flex flex-wrap gap-2">
				{#each statusFilters as filter (filter)}
					<button
						type="button"
						class="focus-visible:outline-none"
						aria-pressed={filter === 'Any status'}
					>
						<TagPill tone={filter === 'Any status' ? 'neutral' : 'outline'} size="sm">
							{filter}
						</TagPill>
					</button>
				{/each}
			</div>
			<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Genres</h3>
			<div class="flex flex-wrap gap-2">
				{#each genreFilters as filter (filter)}
					<button type="button" class="focus-visible:outline-none">
						<TagPill tone="outline" size="sm">{filter}</TagPill>
					</button>
				{/each}
			</div>
		</div>
		<div class="flex w-full flex-col gap-3 sm:w-auto">
			<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Sort</h3>
			<div class="flex flex-wrap gap-2">
				{#each sortOptions as option (option)}
					<button
						type="button"
						class="focus-visible:outline-none"
						aria-pressed={option === 'Relevance'}
					>
						<TagPill tone={option === 'Relevance' ? 'neutral' : 'outline'} size="sm">
							{option}
						</TagPill>
					</button>
				{/each}
			</div>
			<Button variant="secondary" size="sm">Save search</Button>
		</div>
	</div>

	{#if hasResults}
		<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{#each results as item (item.slug)}
				<MangaCard data={item} />
			{/each}
		</div>
	{:else}
		<EmptyState
			title="No results yet"
			description="Try tweaking filters or searching another keyword."
		/>
	{/if}
</section>
