<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	import {
		listLibraryCollections,
		listLibraryTitles,
		type LibraryCollectionResource,
		type LibraryTitleSummary
	} from '$lib/api/library';
	import { getCachedCoverUrl } from '$lib/api/covers';
	import { Button } from '$lib/elements/button';
	import { Icon } from '$lib/elements/icon';
	import { Input } from '$lib/elements/input';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { _ } from '$lib/i18n';
	import { buildTitlePath } from '$lib/utils/routes';

	let titles = $state<LibraryTitleSummary[]>([]);
	let collections = $state<LibraryCollectionResource[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let searchQuery = $state('');
	let selectedCollectionId = $state<number | null>(null);

	const filteredTitles = $derived.by(() => {
		const query = searchQuery.trim().toLowerCase();
		return titles.filter((title) => {
			if (selectedCollectionId !== null) {
				const inCollection = title.collections?.some((collection) => collection.id === selectedCollectionId);
				if (!inCollection) {
					return false;
				}
			}
			if (!query) {
				return true;
			}
			return title.title.toLowerCase().includes(query);
		});
	});

	const isEmpty = $derived(titles.length === 0 && !loading);

	onMount(async () => {
		await refreshLibrary();
	});

	async function refreshLibrary() {
		loading = true;
		error = null;
		try {
			const [loadedTitles, loadedCollections] = await Promise.all([
				listLibraryTitles({ limit: 100 }),
				listLibraryCollections()
			]);
			titles = loadedTitles;
			collections = loadedCollections;

			if (
				selectedCollectionId !== null &&
				!loadedCollections.some((collection) => collection.id === selectedCollectionId)
			) {
				selectedCollectionId = null;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load library';
		} finally {
			loading = false;
		}
	}

	function getStatusText(status: number): string {
		switch (status) {
			case 1:
				return $_('status.ongoing');
			case 2:
			case 4:
				return $_('status.completed');
			case 6:
				return $_('status.hiatus');
			default:
				return '';
		}
	}

	function getDisplayStatus(title: LibraryTitleSummary): string | null {
		if (title.user_status) {
			return title.user_status.label;
		}
		if (!title.status) {
			return null;
		}
		return getStatusText(title.status);
	}

	function collectionCount(collectionId: number): number {
		return titles.filter((title) =>
			title.collections?.some((collection) => collection.id === collectionId)
		).length;
	}

</script>

<svelte:head>
	<title>{$_('nav.library')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex items-center justify-between">
		<h1 class="text-display text-xl text-[var(--text)]">{$_('nav.library').toLowerCase()}</h1>
	</div>

	<div class="relative">
		<Icon
			name="search"
			size={16}
			class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-ghost)]"
		/>
		<Input type="search" placeholder={$_('library.searchPlaceholder')} bind:value={searchQuery} class="pl-10" />
	</div>

	<div class="flex items-center gap-1 overflow-x-auto border-b border-[var(--line)] pb-1">
		<button
			type="button"
			class="shrink-0 px-3 py-1.5 text-sm transition-colors {selectedCollectionId === null
				? 'border border-[var(--line)] bg-[var(--void-3)] text-[var(--text)]'
				: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
			onclick={() => (selectedCollectionId = null)}
		>
			{$_('common.all')} ({titles.length})
		</button>
		{#each collections as collection (collection.id)}
			<button
				type="button"
				class="shrink-0 px-3 py-1.5 text-sm transition-colors {selectedCollectionId === collection.id
					? 'border border-[var(--line)] bg-[var(--void-3)] text-[var(--text)]'
					: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
				onclick={() => (selectedCollectionId = collection.id)}
			>
				{collection.name} ({collectionCount(collection.id)})
			</button>
		{/each}
	</div>

	{#if error}
		<div class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-4 py-3 text-sm text-[var(--error)]">
			{error}
		</div>
	{/if}

	{#if loading}
		<div class="flex flex-col items-center gap-4 py-16">
			<Icon name="loader" size={24} class="animate-spin text-[var(--text-muted)]" />
			<p class="text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
		</div>
	{:else if isEmpty}
		<div class="flex flex-col items-center gap-4 py-16 text-center">
			<div class="flex h-16 w-16 items-center justify-center border border-[var(--line)] bg-[var(--void-3)]">
				<Icon name="book" size={24} class="text-[var(--text-ghost)]" />
			</div>
			<div>
				<p class="text-[var(--text)]">{$_('library.empty')}</p>
				<p class="mt-1 text-sm text-[var(--text-ghost)]">{$_('library.emptyDescription')}</p>
			</div>
			<Button variant="outline" onclick={() => goto('/explore')}>
				{$_('library.addFirst')}
			</Button>
		</div>
	{:else}
		<div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
			{#each filteredTitles as title (title.id)}
				{@const displayStatus = getDisplayStatus(title)}
				<a
					href={buildTitlePath(title.id, title.title)}
					class="group card-glow relative flex flex-col overflow-hidden border border-[var(--line)] bg-[var(--void-2)]"
				>
					<div class="relative aspect-[2/3] overflow-hidden bg-[var(--void-3)]">
						{#if title.thumbnail_url}
							<LazyImage
								src={getCachedCoverUrl(title.thumbnail_url)}
								alt={title.title}
								class="h-full w-full"
								imgClass="transition-transform group-hover:scale-105"
							/>
						{:else}
							<div class="flex h-full w-full items-center justify-center">
								<Icon name="image" size={24} class="text-[var(--text-ghost)]" />
							</div>
						{/if}

						{#if title.chapters_count > 0}
							<div class="absolute right-1 bottom-1 bg-[var(--void-0)]/80 px-1.5 py-0.5 text-[10px] text-[var(--text)]">
								{title.chapters_count}
							</div>
						{/if}
					</div>

					<div class="flex flex-1 flex-col gap-1 p-2">
						<p class="line-clamp-2 text-xs text-[var(--text)]">{title.title}</p>
						{#if displayStatus}
							<p class="text-[10px] text-[var(--text-muted)]">{displayStatus}</p>
						{/if}
						{#if title.user_rating != null}
							<p class="text-[10px] text-[var(--text-muted)]">★ {title.user_rating.toFixed(1)}</p>
						{/if}
					</div>
				</a>
			{/each}
		</div>

		{#if filteredTitles.length === 0}
			<div class="flex flex-col items-center gap-2 py-8 text-center">
				<p class="text-[var(--text-muted)]">{$_('common.noResults')}</p>
			</div>
		{/if}
	{/if}
</div>
