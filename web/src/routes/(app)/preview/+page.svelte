<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	import { getTitleDetails } from '$lib/api/explore';
	import { getCachedCoverUrl } from '$lib/api/covers';
	import { importLibraryTitle } from '$lib/api/library';
	import { Button } from '$lib/elements/button';
	import { Icon } from '$lib/elements/icon';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { previewItemStore, type ExploreItem } from '$lib/stores/explore';
	import { _ } from '$lib/i18n';
	import { buildTitlePath } from '$lib/utils/routes';

	let item = $state<ExploreItem | null>(null);
	let importing = $state(false);
	let error = $state<string | null>(null);
	let showFullDescription = $state(false);
	let detailsLoading = $state(false);
	let detailsLoadedKey = $state<string | null>(null);
	let detailsRequestId = 0;

	const statusLabels: Record<number, string> = {
		1: 'ongoing',
		2: 'completed',
		4: 'completed',
		6: 'hiatus'
	};

	const statusColors: Record<string, string> = {
		ongoing: 'text-[var(--success)]',
		completed: 'text-[var(--text)]',
		hiatus: 'text-[var(--text-muted)]'
	};

	function itemFromQueryString(): ExploreItem | null {
		const sourceId = page.url.searchParams.get('source_id')?.trim() ?? '';
		const titleUrl = page.url.searchParams.get('title_url')?.trim() ?? '';
		if (!sourceId || !titleUrl) {
			return null;
		}

		const title = page.url.searchParams.get('title')?.trim() || titleUrl;
		const sourceName = page.url.searchParams.get('source_name')?.trim() || sourceId;
		const sourceLang = page.url.searchParams.get('source_lang')?.trim() || '';
		const thumbnailUrl = page.url.searchParams.get('thumbnail_url')?.trim() || '';

		return {
			dedupe_key: `${sourceId}::${titleUrl}`,
			title,
			thumbnail_url: thumbnailUrl,
			artist: null,
			author: null,
			description: null,
			genre: null,
			status: 0,
			links: [
				{
					source: {
						id: sourceId,
						name: sourceName,
						lang: sourceLang,
						supports_latest: null,
						extension_pkg: '',
						extension_name: sourceName
					},
					title_url: titleUrl
				}
			],
			imported_library_id: null
		};
	}

	function splitGenres(genre: string | null | undefined): string[] {
		if (!genre) return [];
		return genre
			.split(',')
			.map((g) => g.trim())
			.filter((g) => g.length > 0);
	}

	onMount(() => {
		const unsubscribe = previewItemStore.subscribe((value) => {
			item = value;
		});

		if (!item) {
			const fromQuery = itemFromQueryString();
			if (fromQuery) {
				item = fromQuery;
				previewItemStore.set(fromQuery);
			}
		}

		// Redirect to explore if no item in memory or URL
		if (!item) {
			goto('/explore');
		}

		return unsubscribe;
	});

	$effect(() => {
		const current = item;
		const primary = current?.links[0];
		if (!current || !primary) return;

		const key = `${primary.source.id}::${primary.title_url}`;
		if (detailsLoadedKey === key) return;

		detailsLoadedKey = key;
		const requestId = ++detailsRequestId;
		detailsLoading = true;

		void (async () => {
			try {
				const details = await getTitleDetails({
					source_id: primary.source.id,
					title_url: primary.title_url
				});
				if (requestId !== detailsRequestId || !item) return;
				item = {
					...item,
					title: details.title || item.title,
					thumbnail_url: details.thumbnail_url || item.thumbnail_url,
					artist: details.artist || item.artist,
					author: details.author || item.author,
					description: details.description || item.description,
					genre: details.genre || item.genre,
					status: details.status || item.status,
					imported_library_id: details.imported_library_id ?? item.imported_library_id
				};
			} catch {
				// Keep explore payload as fallback if details endpoint fails.
			} finally {
				if (requestId === detailsRequestId) {
					detailsLoading = false;
				}
			}
		})();
	});

	async function handleImport() {
		if (!item || !item.links[0]) return;

		const link = item.links[0];
		importing = true;
		error = null;

		try {
			const result = await importLibraryTitle({
				source_id: link.source.id,
				title_url: link.title_url
			});
			// Clear preview store and navigate to title
			previewItemStore.set(null);
			await goto(buildTitlePath(result.library_title_id, item.title));
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to import title';
		} finally {
			importing = false;
		}
	}

	function handleBack() {
		previewItemStore.set(null);
		goto('/explore');
	}
</script>

<svelte:head>
	<title>{item?.title ?? $_('preview.title')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<!-- Header -->
	<div class="flex items-center gap-3">
		<Button variant="ghost" size="icon-sm" onclick={handleBack}>
			<Icon name="chevron-left" size={20} />
		</Button>
		<h1 class="text-display line-clamp-1 flex-1 text-xl text-[var(--text)]">
			{item?.title ?? $_('preview.title')}
		</h1>
	</div>

	{#if !item}
		<div class="flex flex-col items-center gap-4 py-16">
			<Icon name="loader" size={24} class="animate-spin text-[var(--text-muted)]" />
			<p class="text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
		</div>
	{:else}
		<!-- Hero section -->
		<div class="flex flex-col gap-6 md:flex-row">
			<!-- Cover -->
			<div class="shrink-0">
				<div class="card-glow mx-auto w-48 md:mx-0 md:w-56">
						{#if item.thumbnail_url}
							<LazyImage
								src={getCachedCoverUrl(item.thumbnail_url)}
								alt={item.title}
								class="aspect-[2/3] w-full border border-[var(--line)]"
								loading="eager"
							/>
					{:else}
						<div
							class="flex aspect-[2/3] w-full items-center justify-center border border-[var(--line)] bg-[var(--void-3)]"
						>
							<Icon name="image" size={48} class="text-[var(--text-ghost)]" />
						</div>
					{/if}
				</div>
			</div>

			<!-- Info -->
			<div class="flex flex-1 flex-col gap-4">
				<div>
					<h2 class="text-xl font-semibold text-[var(--text)] md:text-2xl">
						{item.title}
					</h2>
					{#if item.author}
						<p class="mt-1 text-[var(--text-muted)]">{item.author}</p>
					{/if}
				</div>

				<!-- Status -->
				<div class="flex flex-wrap items-center gap-3 text-sm">
					{#if item.status && statusLabels[item.status]}
						{@const statusKey = statusLabels[item.status]}
						<span
							class="border border-[var(--line)] bg-[var(--void-3)] px-2 py-0.5 {statusColors[
								statusKey
							]}"
						>
							{$_(`status.${statusKey}`)}
						</span>
					{/if}
					{#if item.links.length > 0}
						<span class="text-[var(--text-muted)]">
							{item.links.length}
							{item.links.length === 1 ? $_('preview.source') : $_('preview.sources')}
						</span>
					{/if}
				</div>

				<!-- Genres -->
				{#if item.genre}
					{@const genres = splitGenres(item.genre)}
					{#if genres.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each genres as genre (genre)}
								<span
									class="border border-[var(--line)] bg-[var(--void-2)] px-2 py-0.5 text-xs text-[var(--text-soft)]"
								>
									{genre}
								</span>
							{/each}
						</div>
					{/if}
				{/if}

				<!-- Error -->
				{#if error}
					<div
						class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-4 py-3 text-sm text-[var(--error)]"
					>
						{error}
					</div>
				{/if}

				<!-- Actions -->
				<div class="flex flex-wrap gap-2">
					<Button
						variant="solid"
						size="md"
						onclick={handleImport}
						disabled={importing || !item.links[0]}
						loading={importing}
					>
						<Icon name="plus" size={16} />
						{$_('preview.addToLibrary')}
					</Button>
					{#if detailsLoading}
						<div class="flex items-center gap-1 px-2 text-xs text-[var(--text-ghost)]">
							<Icon name="loader" size={12} class="animate-spin" />
							{$_('common.loading')}
						</div>
					{/if}
				</div>

				<!-- Description (desktop) -->
				<div class="hidden md:block">
					{#if item.description}
						<p class="text-sm leading-relaxed text-[var(--text-soft)]">
							{item.description}
						</p>
					{:else}
						<p class="text-sm text-[var(--text-ghost)] italic">
							{$_('preview.noDescriptionHint')}
						</p>
					{/if}
				</div>
			</div>
		</div>

		<!-- Description (mobile) -->
		<div class="md:hidden">
			{#if item.description}
				<p
					class="text-sm leading-relaxed text-[var(--text-soft)] {!showFullDescription
						? 'line-clamp-3'
						: ''}"
				>
					{item.description}
				</p>
				{#if item.description.length > 150}
					<button
						onclick={() => (showFullDescription = !showFullDescription)}
						class="mt-2 flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
					>
						{showFullDescription ? $_('common.less') : $_('common.more')}
						<Icon name={showFullDescription ? 'chevron-up' : 'chevron-down'} size={16} />
					</button>
				{/if}
			{:else}
				<p class="text-sm text-[var(--text-ghost)] italic">
					{$_('preview.noDescriptionHint')}
				</p>
			{/if}
		</div>

		<!-- Sources -->
		{#if item.links.length > 0}
			<div class="border border-[var(--line)] bg-[var(--void-2)] p-4">
				<h3 class="text-sm font-medium text-[var(--text)]">{$_('preview.availableSources')}</h3>
				<div class="mt-3 space-y-2">
					{#each item.links as link (link.title_url)}
						<div
							class="flex items-center justify-between gap-3 border border-[var(--line)] bg-[var(--void-3)] p-3"
						>
							<div class="min-w-0 flex-1">
								<p class="font-medium text-[var(--text)]">{link.source.name}</p>
								<p class="truncate text-xs text-[var(--text-ghost)]">{link.title_url}</p>
							</div>
							{#if link.source.lang}
								<span
									class="border border-[var(--line)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]"
								>
									{link.source.lang}
								</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Info section -->
		<div class="border border-[var(--line)] bg-[var(--void-2)] p-4">
			<h3 class="text-sm font-medium text-[var(--text)]">{$_('title.info')}</h3>
			<div class="mt-3 space-y-2 text-sm">
				{#if item.author}
					<div class="flex items-center justify-between">
						<span class="text-[var(--text-ghost)]">{$_('title.author')}</span>
						<span class="text-[var(--text)]">{item.author}</span>
					</div>
				{/if}
				{#if item.artist && item.artist !== item.author}
					<div class="flex items-center justify-between">
						<span class="text-[var(--text-ghost)]">{$_('title.artist')}</span>
						<span class="text-[var(--text)]">{item.artist}</span>
					</div>
				{/if}
				{#if item.status && statusLabels[item.status]}
					<div class="flex items-center justify-between">
						<span class="text-[var(--text-ghost)]">{$_('title.status')}</span>
						<span class="text-[var(--text)]">{$_(`status.${statusLabels[item.status]}`)}</span>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
