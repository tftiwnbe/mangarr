<script lang="ts">
	import MangaCard, { type MangaCardData } from '$lib/components/manga-card.svelte';
	import PrimarySearchBar from '$lib/components/primary-search-bar.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import TagPill from '$lib/components/tag-pill.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	const statusTabs = ['All', 'Reading', 'Completed', 'Plan', 'Uncategorized', 'Categories'];

	const readingList: MangaCardData[] = [
		{
			title: 'Blazing Trails',
			slug: 'blazing-trails',
			progressLabel: 'Chapter 44 of 120',
			status: 'reading',
			statusLabel: 'Reading',
			tags: [{ label: 'Action' }, { label: 'Adventure' }],
			description: 'Smugglers chart their own future across desert empires.',
			href: '/title/blazing-trails'
		},
		{
			title: 'Sakura Courier',
			slug: 'sakura-courier',
			progressLabel: 'Chapter 19 of 60',
			status: 'reading',
			statusLabel: 'Reading',
			tags: [{ label: 'Drama' }, { label: 'Slice of Life', tone: 'outline' }],
			description: 'Delivering more than parcels through the city night.',
			href: '/title/sakura-courier'
		}
	];

	const completedList: MangaCardData[] = [
		{
			title: 'Moonlit Field Notes',
			slug: 'moonlit-field-notes',
			meta: 'Finished last week',
			tags: [{ label: 'Mystery' }, { label: 'Slice of Life', tone: 'outline' }],
			description: 'Botanist journals supernatural flora in remote villages.',
			href: '/title/moonlit-field-notes'
		},
		{
			title: 'Gearshift Rally',
			slug: 'gearshift-rally',
			meta: 'Finished last month',
			tags: [{ label: 'Sports' }, { label: 'Seinen', tone: 'outline' }],
			description: 'Underground racers push limits in neon circuits.',
			href: '/title/gearshift-rally'
		}
	];

	const categories = [
		{
			name: 'Favorites',
			description: 'Stories you revisit often.',
			count: 12,
			href: '/library?category=favorites'
		},
		{
			name: 'Weekend Reads',
			description: 'Short arcs perfect for downtime.',
			count: 6,
			href: '/library?category=weekend'
		},
		{
			name: 'Uncategorized',
			description: 'Titles without a category yet.',
			count: 3,
			href: '/library?category=uncategorized'
		}
	];
</script>

<section class="space-y-8">
	<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
		<div class="space-y-1">
			<h1 class="text-2xl font-semibold md:text-3xl">Library</h1>
			<p class="text-sm text-muted-foreground">
				Find titles you’re reading, revisit completed series, or reorganize categories.
			</p>
		</div>
		<div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-end md:gap-3">
			<PrimarySearchBar
				class="w-full md:max-w-md"
				variant="inline"
				action="/search"
				method="get"
				submitLabel="Search"
			/>
			<Input
				class="h-10 md:w-56"
				placeholder="Search in library..."
				name="library-filter"
				aria-label="Search within library"
			/>
		</div>
	</div>
	<div class="flex flex-wrap gap-2">
		{#each statusTabs as tab (tab)}
			<button type="button" class="focus-visible:outline-none" aria-pressed={tab === 'All'}>
				<TagPill tone={tab === 'All' ? 'neutral' : 'outline'} size="sm">
					{tab}
				</TagPill>
			</button>
		{/each}
	</div>

	<section class="space-y-4">
		<SectionHeader
			title="Currently reading"
			description="Resume recent chapters or update your status."
			actionHref="/discover/continue"
			actionLabel="See all"
		/>
		<div class="space-y-4">
			{#each readingList as item (item.slug)}
				<MangaCard data={item} layout="list">
					<svelte:fragment slot="footer">
						<div class="mt-auto flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
							<Button size="sm" variant="secondary" href={item.href}>Resume</Button>
							<span>{item.progressLabel}</span>
						</div>
					</svelte:fragment>
				</MangaCard>
			{/each}
		</div>
	</section>

	<section class="space-y-4">
		<SectionHeader
			title="Completed recently"
			description="Keep tabs on the stories you’ve wrapped up."
			actionHref="/library?status=completed"
			actionLabel="All completed"
		/>
		<div class="grid gap-4 sm:grid-cols-2">
			{#each completedList as item (item.slug)}
				<MangaCard data={item} />
			{/each}
		</div>
	</section>

	<section class="space-y-4">
		<SectionHeader
			title="Categories"
			description="Personal shelves to organize your library."
			actionHref="/library?view=categories"
			actionLabel="Manage"
		/>
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each categories as category (category.name)}
				<a
					class="rounded-xl border border-border/70 bg-card/80 p-4 transition-shadow hover:border-border hover:shadow-md"
					href={category.href}
				>
					<div class="flex items-baseline justify-between">
						<h3 class="text-base font-semibold">{category.name}</h3>
						<span class="text-xs tracking-wide text-muted-foreground uppercase">
							{category.count} titles
						</span>
					</div>
					<p class="mt-2 text-sm text-muted-foreground">{category.description}</p>
				</a>
			{/each}
			<EmptyState
				title="Need another category?"
				description="Group discoveries however you like. Add genres, moods, or read-a-thons."
				class="border-dashed bg-transparent py-8"
			>
				<Button size="sm" variant="secondary">Create category</Button>
			</EmptyState>
		</div>
	</section>
</section>
