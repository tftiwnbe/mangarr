<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { PageHeader } from '$lib/components/page-header/index.js';
	import LibraryCard from '$lib/components/library-card/library-card.svelte';
	import * as Tabs from '$lib/elements/tabs/index.js';
	import { libraryTitles, type LibraryTitle } from '$lib/mock-data';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import PauseCircleIcon from '@lucide/svelte/icons/pause-circle';
	import LibraryIcon from '@lucide/svelte/icons/library-big';

	type TabValue = 'all' | 'reading' | 'completed' | 'plan-to-read' | 'on-hold';

	const tabs: { value: TabValue; label: string; icon: typeof BookOpenIcon }[] = [
		{ value: 'all', label: 'All', icon: LibraryIcon },
		{ value: 'reading', label: 'Reading', icon: BookOpenIcon },
		{ value: 'completed', label: 'Completed', icon: CheckCircleIcon },
		{ value: 'plan-to-read', label: 'Plan to Read', icon: ClockIcon },
		{ value: 'on-hold', label: 'On Hold', icon: PauseCircleIcon }
	];

	// Get category from URL if present
	const categoryParam = $derived(page.url.searchParams.get('category'));

	let activeTab = $state<TabValue>('all');

	const filteredTitles = $derived.by(() => {
		let filtered = libraryTitles;

		// Filter by category if specified
		if (categoryParam) {
			filtered = filtered.filter((t) => t.category === categoryParam);
		}

		// Filter by reading status
		if (activeTab !== 'all') {
			filtered = filtered.filter((t) => t.readingStatus === activeTab);
		}

		return filtered;
	});

	function handleTabChange(value: string) {
		activeTab = value as TabValue;
	}
</script>

<PageHeader
	title={categoryParam ? `Library - ${categoryParam.charAt(0).toUpperCase() + categoryParam.slice(1)}` : 'Library'}
	description="Your personal collection"
	breadcrumbs={[{ label: 'Library' }]}
/>

<main class="flex flex-col gap-6 px-4 pb-24">
	<Tabs.Root value={activeTab} onValueChange={handleTabChange}>
		<Tabs.List class="w-full justify-start overflow-x-auto">
			{#each tabs as tab (tab.value)}
				<Tabs.Trigger value={tab.value} class="gap-2">
					<tab.icon class="size-4" />
					<span class="hidden sm:inline">{tab.label}</span>
					<span class="sm:hidden">{tab.label.split(' ')[0]}</span>
				</Tabs.Trigger>
			{/each}
		</Tabs.List>

		{#each tabs as tab (tab.value)}
			<Tabs.Content value={tab.value} class="mt-6">
				{#if filteredTitles.length === 0}
					<div class="flex flex-col items-center justify-center py-16 text-center">
						<tab.icon class="mb-4 size-12 text-muted-foreground/50" />
						<p class="text-muted-foreground">No titles in this category</p>
					</div>
				{:else}
					<div
						class="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7"
					>
						{#each filteredTitles as item (item.id)}
							<LibraryCard {item} class="w-full" />
						{/each}
					</div>
				{/if}
			</Tabs.Content>
		{/each}
	</Tabs.Root>
</main>
