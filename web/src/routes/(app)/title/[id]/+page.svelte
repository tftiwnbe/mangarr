<script lang="ts">
	import { page } from '$app/state';
	import { PageHeader } from '$lib/components/page-header/index.js';
	import { Button } from '$lib/elements/button/index.js';
	import { Badge } from '$lib/elements/badge/index.js';
	import { Separator } from '$lib/elements/separator/index.js';
	import * as Tabs from '$lib/elements/tabs/index.js';
	import { libraryTitleDetailStore } from '$lib/stores/library';
	import { cn } from '$lib/utils';

	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CheckIcon from '@lucide/svelte/icons/check';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';

	let showFullDescription = $state(false);
	let activeTab = $state<'chapters' | 'info'>('chapters');

	const routeTitleId = $derived(Number(page.params.id));

	$effect(() => {
		if (Number.isInteger(routeTitleId) && routeTitleId > 0) {
			void libraryTitleDetailStore.load(routeTitleId);
		} else {
			libraryTitleDetailStore.setData(null);
		}
	});

	const title = $derived($libraryTitleDetailStore.data);

	const statusColors = {
		ongoing: 'bg-blue-500/90',
		completed: 'bg-green-500/90',
		hiatus: 'bg-yellow-500/90'
	} as const;

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		if (Number.isNaN(date.getTime())) {
			return dateStr;
		}
		return date.toLocaleDateString();
	}

	function isExternalUrl(url: string): boolean {
		return /^https?:\/\//i.test(url);
	}
</script>

{#if $libraryTitleDetailStore.isLoading && !title}
	<PageHeader
		title="Loading..."
		breadcrumbs={[
			{ label: 'Library', href: '/library' },
			{ label: 'Loading' }
		]}
	/>
	<main class="flex flex-col gap-4 px-4 pb-24">
		<div class="h-64 animate-pulse rounded-lg border bg-card/60"></div>
		<div class="h-32 animate-pulse rounded-lg border bg-card/60"></div>
	</main>
{:else if title}
	<PageHeader
		title={title.title}
		breadcrumbs={[
			{ label: 'Library', href: '/library' },
			{ label: title.title }
		]}
	>
		{#snippet actions()}
			<Button
				variant="outline"
				size="icon"
				disabled={$libraryTitleDetailStore.isRefreshing}
				onclick={() => {
					void libraryTitleDetailStore.refresh(title.libraryId);
				}}
			>
				<RefreshCwIcon class="size-4 {$libraryTitleDetailStore.isRefreshing ? 'animate-spin' : ''}" />
			</Button>
		{/snippet}
	</PageHeader>

	<main class="flex flex-col gap-6 px-4 pb-24">
		<div class="flex flex-col gap-6 md:flex-row">
			<div class="shrink-0">
				<img
					src={title.cover}
					alt={title.title}
					class="mx-auto aspect-[2/3] w-48 rounded-lg object-cover shadow-lg md:w-56"
				/>
			</div>

			<div class="flex flex-1 flex-col gap-4">
				<div>
					<h1 class="text-2xl font-bold md:text-3xl">{title.title}</h1>
					{#if title.author}
						<p class="text-muted-foreground">{title.author}</p>
					{/if}
				</div>

				<div class="flex flex-wrap items-center gap-3">
					{#if title.status}
						<Badge class={cn('text-white', statusColors[title.status])}>
							{title.status.charAt(0).toUpperCase() + title.status.slice(1)}
						</Badge>
					{/if}
					<span class="text-sm text-muted-foreground">{title.chapters.length} cached chapters</span>
					<span class="text-sm text-muted-foreground">{title.variants.length} sources</span>
				</div>

				{#if title.genres && title.genres.length > 0}
					<div class="flex flex-wrap gap-2">
						{#each title.genres as genre (genre)}
							<Badge variant="secondary">{genre}</Badge>
						{/each}
					</div>
				{/if}

				<div class="flex flex-wrap gap-2">
					{#if title.variants[0]?.titleUrl}
						<Button
							variant="secondary"
							href={title.variants[0].titleUrl}
							target={isExternalUrl(title.variants[0].titleUrl) ? '_blank' : undefined}
							rel={isExternalUrl(title.variants[0].titleUrl) ? 'noopener noreferrer' : undefined}
							class="gap-2"
						>
							<ExternalLinkIcon class="size-4" />
							Open Source
						</Button>
					{/if}
					<Button variant="outline" class="gap-2" href="/downloads">
						<DownloadIcon class="size-4" />
						Open Downloads
					</Button>
					<Button variant="outline" class="gap-2" href="/library">
						<BookOpenIcon class="size-4" />
						Back to Library
					</Button>
				</div>

				<div class="hidden md:block">
					<p class="text-sm text-muted-foreground">
						{title.description || 'No description available.'}
					</p>
				</div>
			</div>
		</div>

		<div class="md:hidden">
			<p class={cn('text-sm text-muted-foreground', !showFullDescription && 'line-clamp-3')}>
				{title.description || 'No description available.'}
			</p>
			{#if title.description && title.description.length > 150}
				<button
					onclick={() => {
						showFullDescription = !showFullDescription;
					}}
					class="mt-2 flex items-center gap-1 text-sm text-primary"
				>
					{showFullDescription ? 'Show less' : 'Show more'}
					<ChevronDownIcon
						class={cn('size-4 transition-transform', showFullDescription && 'rotate-180')}
					/>
				</button>
			{/if}
		</div>

		<Tabs.Root bind:value={activeTab}>
			<Tabs.List>
				<Tabs.Trigger value="chapters">Chapters</Tabs.Trigger>
				<Tabs.Trigger value="info">Info</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="chapters" class="mt-4">
				{#if title.chapters.length === 0}
					<div class="rounded-lg border p-6 text-sm text-muted-foreground">
						No cached chapters yet.
					</div>
				{:else}
					<div class="flex flex-col rounded-lg border">
						{#each title.chapters as chapter, i (chapter.id)}
							{#if i > 0}
								<Separator />
							{/if}
							<a
								href={chapter.chapterUrl}
								target={isExternalUrl(chapter.chapterUrl) ? '_blank' : undefined}
								rel={isExternalUrl(chapter.chapterUrl) ? 'noopener noreferrer' : undefined}
								class={cn(
									'flex items-center gap-4 p-4 transition-colors hover:bg-secondary/50',
									chapter.isRead && 'opacity-70'
								)}
							>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<span class="font-medium">Chapter {chapter.number}</span>
										<span class="truncate text-muted-foreground">- {chapter.title}</span>
									</div>
									<div class="flex items-center gap-2 text-xs text-muted-foreground">
										<span>{formatDate(chapter.uploadDate)}</span>
										{#if chapter.scanlator}
											<span>&bull;</span>
											<span>{chapter.scanlator}</span>
										{/if}
									</div>
									{#if chapter.downloadError}
										<p class="text-xs text-destructive">{chapter.downloadError}</p>
									{/if}
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
				{/if}
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
					{#if title.genres && title.genres.length > 0}
						<div>
							<p class="text-sm font-medium">Genres</p>
							<p class="text-muted-foreground">{title.genres.join(', ')}</p>
						</div>
					{/if}
					<div>
						<p class="text-sm font-medium">Source variants</p>
						<div class="mt-2 space-y-2">
							{#each title.variants as variant (variant.id)}
								<div class="rounded-md border p-3">
									<div class="flex flex-wrap items-center justify-between gap-2">
										<p class="font-medium">{variant.sourceName || variant.sourceId}</p>
										<Badge variant="outline">{variant.sourceLang || 'n/a'}</Badge>
									</div>
									<p class="text-sm text-muted-foreground">{variant.title}</p>
								</div>
							{/each}
						</div>
					</div>
				</div>
			</Tabs.Content>
		</Tabs.Root>
	</main>
{:else}
	<PageHeader
		title="Title Not Found"
		breadcrumbs={[
			{ label: 'Library', href: '/library' },
			{ label: 'Not Found' }
		]}
	/>
	<main class="flex flex-col items-center justify-center px-4 py-16">
		<p class="text-muted-foreground">
			{#if $libraryTitleDetailStore.error}
				{$libraryTitleDetailStore.error}
			{:else}
				The requested library title could not be found.
			{/if}
		</p>
		<Button variant="link" href="/library">Go back to Library</Button>
	</main>
{/if}
