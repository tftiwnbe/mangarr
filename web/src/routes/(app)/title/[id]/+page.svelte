<script lang="ts">
	import { page } from '$app/state';
	import { PageHeader } from '$lib/components/page-header/index.js';
	import { Button } from '$lib/elements/button/index.js';
	import { Badge } from '$lib/elements/badge/index.js';
	import { Separator } from '$lib/elements/separator/index.js';
	import * as Tabs from '$lib/elements/tabs/index.js';
	import { getTitleById, type Chapter } from '$lib/mock-data';
	import { cn } from '$lib/utils';

	import BookmarkPlusIcon from '@lucide/svelte/icons/bookmark-plus';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ShareIcon from '@lucide/svelte/icons/share';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import StarIcon from '@lucide/svelte/icons/star';

	const titleId = $derived(page.params.id);
	const title = $derived(getTitleById(titleId));

	let showFullDescription = $state(false);
	let activeTab = $state<'chapters' | 'info'>('chapters');

	const statusColors = {
		ongoing: 'bg-blue-500/90',
		completed: 'bg-green-500/90',
		hiatus: 'bg-yellow-500/90'
	} as const;

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		const now = new Date();
		const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Yesterday';
		if (diffDays < 7) return `${diffDays} days ago`;
		if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
		return date.toLocaleDateString();
	}
</script>

{#if title}
	<PageHeader
		title={title.title}
		breadcrumbs={[
			{ label: 'Discover', href: '/' },
			{ label: title.title }
		]}
	/>

	<main class="flex flex-col gap-6 px-4 pb-24">
		<!-- Hero Section -->
		<div class="flex flex-col gap-6 md:flex-row">
			<!-- Cover -->
			<div class="shrink-0">
				<img
					src={title.cover}
					alt={title.title}
					class="mx-auto aspect-[2/3] w-48 rounded-lg object-cover shadow-lg md:w-56"
				/>
			</div>

			<!-- Info -->
			<div class="flex flex-1 flex-col gap-4">
				<div>
					<h1 class="text-2xl font-bold md:text-3xl">{title.title}</h1>
					{#if title.author}
						<p class="text-muted-foreground">{title.author}</p>
					{/if}
				</div>

				<!-- Stats -->
				<div class="flex flex-wrap items-center gap-3">
					{#if title.status}
						<Badge class={cn('text-white', statusColors[title.status])}>
							{title.status.charAt(0).toUpperCase() + title.status.slice(1)}
						</Badge>
					{/if}
					{#if title.chapters}
						<span class="text-sm text-muted-foreground">{title.chapters} chapters</span>
					{/if}
					{#if title.rating}
						<div class="flex items-center gap-1">
							<StarIcon class="size-4 fill-yellow-500 text-yellow-500" />
							<span class="text-sm">{title.rating}</span>
						</div>
					{/if}
				</div>

				<!-- Genres -->
				{#if title.genres && title.genres.length > 0}
					<div class="flex flex-wrap gap-2">
						{#each title.genres as genre (genre)}
							<Badge variant="secondary">{genre}</Badge>
						{/each}
					</div>
				{/if}

				<!-- Action Buttons -->
				<div class="flex flex-wrap gap-2">
					<Button class="gap-2">
						<BookmarkPlusIcon class="size-4" />
						Add to Library
					</Button>
					<Button variant="secondary" class="gap-2">
						<BookOpenIcon class="size-4" />
						Start Reading
					</Button>
					<Button variant="outline" size="icon">
						<DownloadIcon class="size-4" />
					</Button>
					<Button variant="outline" size="icon">
						<ShareIcon class="size-4" />
					</Button>
				</div>

				<!-- Description (Desktop) -->
				<div class="hidden md:block">
					<p class="text-sm text-muted-foreground">
						{title.description}
					</p>
				</div>
			</div>
		</div>

		<!-- Description (Mobile) -->
		<div class="md:hidden">
			<p
				class={cn(
					'text-sm text-muted-foreground',
					!showFullDescription && 'line-clamp-3'
				)}
			>
				{title.description}
			</p>
			{#if title.description && title.description.length > 150}
				<button
					onclick={() => (showFullDescription = !showFullDescription)}
					class="mt-2 flex items-center gap-1 text-sm text-primary"
				>
					{showFullDescription ? 'Show less' : 'Show more'}
					<ChevronDownIcon
						class={cn('size-4 transition-transform', showFullDescription && 'rotate-180')}
					/>
				</button>
			{/if}
		</div>

		<!-- Tabs -->
		<Tabs.Root bind:value={activeTab}>
			<Tabs.List>
				<Tabs.Trigger value="chapters">Chapters</Tabs.Trigger>
				<Tabs.Trigger value="info">Info</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="chapters" class="mt-4">
				<div class="flex flex-col rounded-lg border">
					{#each title.chapters as chapter, i (chapter.id)}
						{#if i > 0}
							<Separator />
						{/if}
						<a
							href="/title/{titleId}/chapter/{chapter.number}"
							class={cn(
								'flex items-center gap-4 p-4 transition-colors hover:bg-secondary/50',
								chapter.isRead && 'opacity-60'
							)}
						>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="font-medium">Chapter {chapter.number}</span>
									{#if chapter.title}
										<span class="truncate text-muted-foreground">- {chapter.title}</span>
									{/if}
								</div>
								<div class="flex items-center gap-2 text-xs text-muted-foreground">
									<span>{formatDate(chapter.uploadDate)}</span>
									{#if chapter.scanlator}
										<span>&bull;</span>
										<span>{chapter.scanlator}</span>
									{/if}
									{#if chapter.pages}
										<span>&bull;</span>
										<span>{chapter.pages} pages</span>
									{/if}
								</div>
							</div>
							<div class="flex items-center gap-2">
								{#if chapter.isDownloaded}
									<DownloadIcon class="size-4 text-green-500" />
								{/if}
								{#if chapter.isRead}
									<CheckIcon class="size-4 text-muted-foreground" />
								{/if}
							</div>
						</a>
					{/each}
				</div>
			</Tabs.Content>

			<Tabs.Content value="info" class="mt-4">
				<div class="flex flex-col gap-4 rounded-lg border p-4">
					{#if title.author}
						<div>
							<p class="text-sm font-medium">Author</p>
							<p class="text-muted-foreground">{title.author}</p>
						</div>
					{/if}
					{#if title.artist && title.artist !== title.author}
						<div>
							<p class="text-sm font-medium">Artist</p>
							<p class="text-muted-foreground">{title.artist}</p>
						</div>
					{/if}
					{#if title.alternativeTitles && title.alternativeTitles.length > 0}
						<div>
							<p class="text-sm font-medium">Alternative Titles</p>
							<p class="text-muted-foreground">{title.alternativeTitles.join(', ')}</p>
						</div>
					{/if}
					{#if title.status}
						<div>
							<p class="text-sm font-medium">Status</p>
							<p class="text-muted-foreground capitalize">{title.status}</p>
						</div>
					{/if}
					{#if title.genres && title.genres.length > 0}
						<div>
							<p class="text-sm font-medium">Genres</p>
							<p class="text-muted-foreground">{title.genres.join(', ')}</p>
						</div>
					{/if}
				</div>
			</Tabs.Content>
		</Tabs.Root>
	</main>
{:else}
	<PageHeader
		title="Title Not Found"
		breadcrumbs={[
			{ label: 'Discover', href: '/' },
			{ label: 'Not Found' }
		]}
	/>
	<main class="flex flex-col items-center justify-center px-4 py-16">
		<p class="text-muted-foreground">The requested title could not be found.</p>
		<Button variant="link" href="/">Go back to Discover</Button>
	</main>
{/if}
