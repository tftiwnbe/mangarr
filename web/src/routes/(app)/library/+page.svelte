<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';

	import {
		listLibraryCollections,
		listLibraryTitles,
		type LibraryCollectionResource,
		type LibraryTitleSummary
	} from '$lib/api/library';
	import { getCachedCoverUrl } from '$lib/api/covers';
	import { Button } from '$lib/elements/button';
	import { Input } from '$lib/elements/input';
	import {
		FunnelIcon,
		MagnifyingGlassIcon,
		XIcon,
		BookIcon,
		ImageIcon,
		CaretDownIcon,
		CaretUpIcon
	} from 'phosphor-svelte';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { _ } from '$lib/i18n';
	import { panelOverlayOpen } from '$lib/stores/ui';
	import { buildTitlePath } from '$lib/utils/routes';
	import { DebouncedValue } from '$lib/hooks/use-debounced-value.svelte';
	import { TITLE_STATUS } from '$lib/utils/title-status';

	let titles = $state<LibraryTitleSummary[]>([]);
	let collections = $state<LibraryCollectionResource[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let searchQuery = $state('');
	let selectedCollectionId = $state<number | null>(null);
	let filterPanelOpen = $state(false);

	$effect(() => {
		panelOverlayOpen.set(filterPanelOpen);
		return () => panelOverlayOpen.set(false);
	});

	// --- sort ---
	type SortMode = 'updated' | 'added' | 'reading' | 'alpha' | 'status';
	let sortMode = $state<SortMode>('updated');
	let sortDesc = $state(true);

	const SORT_MODES: { value: SortMode; label: string }[] = [
		{ value: 'updated', label: 'updated' },
		{ value: 'added', label: 'added' },
		{ value: 'reading', label: 'reading' },
		{ value: 'alpha', label: 'a–z' },
		{ value: 'status', label: 'status' }
	];

	// --- filters ---
	let activeReadingStatusIds = $state<number[]>([]);
	let activeSourceStatusKeys = $state<string[]>([]);
	let activeGenres = $state<string[]>([]);

	const SOURCE_STATUS_FILTERS: { key: string; label: string; values: number[] }[] = [
		{ key: 'ongoing', label: 'ongoing', values: [TITLE_STATUS.ONGOING] },
		{
			key: 'completed',
			label: 'completed',
			values: [TITLE_STATUS.COMPLETED, TITLE_STATUS.COMPLETED_ALT]
		},
		{ key: 'hiatus', label: 'hiatus', values: [TITLE_STATUS.HIATUS] }
	];

	const debouncedSearch = new DebouncedValue(() => searchQuery, 150);

	// Unique reading statuses present in the library
	const allUserStatuses = $derived.by(() => {
		const seen = new SvelteMap<number, { id: number; label: string }>();
		for (const title of titles) {
			if (title.user_status && !seen.has(title.user_status.id)) {
				seen.set(title.user_status.id, {
					id: title.user_status.id,
					label: title.user_status.label
				});
			}
		}
		return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
	});

	// Source status filter keys that have at least one title in the library
	const presentSourceStatusKeys = $derived.by(() => {
		const presentValues = new SvelteSet(titles.map((t) => t.status).filter((s) => s > 0));
		return SOURCE_STATUS_FILTERS.filter((f) => f.values.some((v) => presentValues.has(v))).map(
			(f) => f.key
		);
	});

	// All genre tags parsed from titles
	const allGenres = $derived.by(() => {
		const genres = new SvelteSet<string>();
		for (const title of titles) {
			if (title.genre) {
				for (const g of title.genre.split(',')) {
					const tag = g.trim();
					if (tag) genres.add(tag);
				}
			}
		}
		return [...genres].sort();
	});

	const hasActiveFilters = $derived(
		activeReadingStatusIds.length > 0 ||
			activeSourceStatusKeys.length > 0 ||
			activeGenres.length > 0
	);

	const hasActiveControls = $derived(hasActiveFilters || sortMode !== 'updated' || !sortDesc);

	const filteredTitles = $derived.by(() => {
		const query = (debouncedSearch.value ?? '').trim().toLowerCase();
		const activeSourceValues = SOURCE_STATUS_FILTERS.filter((f) =>
			activeSourceStatusKeys.includes(f.key)
		).flatMap((f) => f.values);

		let result = titles.filter((title) => {
			// Collection filter (unchanged)
			if (selectedCollectionId !== null) {
				const inCollection = title.collections?.some(
					(collection) => collection.id === selectedCollectionId
				);
				if (!inCollection) return false;
			}
			// Search filter (unchanged)
			if (query && !title.title.toLowerCase().includes(query)) return false;
			// Reading status filter
			if (activeReadingStatusIds.length > 0) {
				if (!title.user_status || !activeReadingStatusIds.includes(title.user_status.id))
					return false;
			}
			// Source status filter
			if (activeSourceValues.length > 0) {
				if (!activeSourceValues.includes(title.status)) return false;
			}
			// Genre filter
			if (activeGenres.length > 0) {
				if (!title.genre) return false;
				const titleGenres = title.genre.split(',').map((g) => g.trim());
				if (!titleGenres.some((g) => activeGenres.includes(g))) return false;
			}
			return true;
		});

		// Sort
		result = [...result].sort((a, b) => {
			let cmp = 0;
			if (sortMode === 'updated') {
				cmp = new Date(a.updated_at ?? 0).getTime() - new Date(b.updated_at ?? 0).getTime();
			} else if (sortMode === 'added') {
				cmp = new Date(a.added_at ?? 0).getTime() - new Date(b.added_at ?? 0).getTime();
			} else if (sortMode === 'reading') {
				const ra = a.last_read_at ? new Date(a.last_read_at).getTime() : 0;
				const rb = b.last_read_at ? new Date(b.last_read_at).getTime() : 0;
				cmp = ra - rb;
			} else if (sortMode === 'alpha') {
				cmp = a.title.localeCompare(b.title);
			} else if (sortMode === 'status') {
				const sa = a.user_status?.label ?? '';
				const sb = b.user_status?.label ?? '';
				cmp = sa.localeCompare(sb);
			}
			return sortDesc ? -cmp : cmp;
		});

		return result;
	});

	const isEmpty = $derived(titles.length === 0 && !loading);

	onMount(async () => {
		await refreshLibrary();
	});

	async function refreshLibrary() {
		loading = true;
		error = null;
		try {
			const [titlesResult, collectionsResult] = await Promise.allSettled([
				listLibraryTitles({ limit: 100 }),
				listLibraryCollections()
			]);

			if (titlesResult.status === 'fulfilled') {
				titles = titlesResult.value;
			} else {
				error =
					titlesResult.reason instanceof Error
						? titlesResult.reason.message
						: 'Failed to load library';
			}

			if (collectionsResult.status === 'fulfilled') {
				collections = collectionsResult.value;
				if (
					selectedCollectionId !== null &&
					!collectionsResult.value.some((collection) => collection.id === selectedCollectionId)
				) {
					selectedCollectionId = null;
				}
			}
			// Collections failure is non-fatal — filters simply won't be available.
		} finally {
			loading = false;
		}
	}

	function getStatusText(status: number): string {
		switch (status) {
			case TITLE_STATUS.ONGOING:
				return $_('status.ongoing');
			case TITLE_STATUS.COMPLETED:
			case TITLE_STATUS.COMPLETED_ALT:
				return $_('status.completed');
			case TITLE_STATUS.HIATUS:
				return $_('status.hiatus');
			default:
				return '';
		}
	}

	function getDisplayStatus(title: LibraryTitleSummary): string | null {
		if (title.user_status) return title.user_status.label;
		if (!title.status) return null;
		return getStatusText(title.status);
	}

	function collectionCount(collectionId: number): number {
		return titles.filter((title) =>
			title.collections?.some((collection) => collection.id === collectionId)
		).length;
	}

	function toggleReadingStatus(id: number) {
		activeReadingStatusIds = activeReadingStatusIds.includes(id)
			? activeReadingStatusIds.filter((x) => x !== id)
			: [...activeReadingStatusIds, id];
	}

	function toggleSourceStatus(key: string) {
		activeSourceStatusKeys = activeSourceStatusKeys.includes(key)
			? activeSourceStatusKeys.filter((x) => x !== key)
			: [...activeSourceStatusKeys, key];
	}

	function toggleGenre(genre: string) {
		activeGenres = activeGenres.includes(genre)
			? activeGenres.filter((x) => x !== genre)
			: [...activeGenres, genre];
	}

	function clearFilters() {
		activeReadingStatusIds = [];
		activeSourceStatusKeys = [];
		activeGenres = [];
	}
</script>

<svelte:head>
	<title>{$_('nav.library')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-3">
	<!-- Header row -->
	<div class="flex items-center gap-3">
		<h1 class="text-display flex-1 text-xl text-[var(--text)]">
			{$_('nav.library').toLowerCase()}
		</h1>
		{#if !loading}
			<span class="text-label text-[var(--text-ghost)]">{titles.length}</span>
			<button
				type="button"
				class="relative flex h-8 w-8 items-center justify-center transition-colors {hasActiveControls
					? 'text-[var(--text)]'
					: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
				onclick={() => (filterPanelOpen = true)}
				aria-label="Sort and filter"
			>
				<FunnelIcon size={14} />
				{#if hasActiveControls}
					<span class="absolute top-1 right-1 h-1.5 w-1.5 bg-[var(--text-muted)]"></span>
				{/if}
			</button>
		{/if}
	</div>

	<!-- Search -->
	<div class="relative">
		<MagnifyingGlassIcon
			size={14}
			class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-ghost)]"
		/>
		<Input
			type="search"
			placeholder={$_('library.searchPlaceholder')}
			bind:value={searchQuery}
			class="h-9 pl-9 text-sm"
		/>
		{#if searchQuery}
			<button
				type="button"
				class="absolute top-1/2 right-3 -translate-y-1/2 text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
				onclick={() => (searchQuery = '')}
			>
				<XIcon size={14} />
			</button>
		{/if}
	</div>

	<!-- Collection filters — only shown when collections exist (UNCHANGED) -->
	{#if collections.length > 0}
		<div class="no-scrollbar flex items-center gap-1 overflow-x-auto pb-0.5">
			<button
				type="button"
				class="shrink-0 px-2.5 py-1 text-xs transition-colors {selectedCollectionId === null
					? 'border border-[var(--line)] bg-[var(--void-3)] text-[var(--text)]'
					: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
				onclick={() => (selectedCollectionId = null)}
			>
				{$_('common.all')} · {titles.length}
			</button>
			{#each collections as collection (collection.id)}
				<button
					type="button"
					class="shrink-0 px-2.5 py-1 text-xs transition-colors {selectedCollectionId ===
					collection.id
						? 'border border-[var(--line)] bg-[var(--void-3)] text-[var(--text)]'
						: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
					onclick={() => (selectedCollectionId = collection.id)}
				>
					{collection.name} · {collectionCount(collection.id)}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Error -->
	{#if error}
		<div
			class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-4 py-3 text-sm text-[var(--error)]"
		>
			{error}
		</div>
	{/if}

	<!-- Skeleton grid -->
	{#if loading}
		<div class="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
			{#each Array(18) as _, i (i)}
				<div class="flex flex-col overflow-hidden border border-[var(--line)] bg-[var(--void-2)]">
					<div
						class="aspect-[2/3] animate-pulse bg-[var(--void-6)]"
						style="animation-delay: {i * 40}ms"
					></div>
					<div class="flex flex-col gap-1.5 p-2">
						<div
							class="h-2 w-full animate-pulse bg-[var(--void-4)]"
							style="animation-delay: {i * 40}ms"
						></div>
						<div
							class="h-2 w-3/5 animate-pulse bg-[var(--void-5)]"
							style="animation-delay: {i * 40 + 20}ms"
						></div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Empty state -->
	{:else if isEmpty}
		<div class="flex flex-col items-center gap-4 py-16 text-center">
			<div
				class="flex h-16 w-16 items-center justify-center border border-[var(--line)] bg-[var(--void-3)]"
			>
				<BookIcon size={24} class="text-[var(--text-ghost)]" />
			</div>
			<div>
				<p class="text-[var(--text)]">{$_('library.empty')}</p>
				<p class="mt-1 text-sm text-[var(--text-ghost)]">{$_('library.emptyDescription')}</p>
			</div>
			<Button variant="outline" onclick={() => goto('/explore')}>
				{$_('library.addFirst')}
			</Button>
		</div>

		<!-- Title grid -->
	{:else}
		<div class="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
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
							<div class="flex h-full w-full items-center justify-center bg-[var(--void-5)]">
								<ImageIcon size={20} class="text-[var(--text-ghost)]" />
							</div>
						{/if}

						{#if title.chapters_count > 0}
							<div
								class="absolute right-1 bottom-1 bg-[var(--void-0)]/80 px-1.5 py-0.5 text-[10px] text-[var(--text)]"
							>
								{title.chapters_count}
							</div>
						{/if}
					</div>

					<div class="flex flex-1 flex-col gap-1 p-2">
						<p class="line-clamp-2 text-xs leading-tight text-[var(--text)]">{title.title}</p>
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

		{#if filteredTitles.length === 0 && !loading}
			<div class="flex flex-col items-center gap-2 py-8 text-center">
				<p class="text-sm text-[var(--text-muted)]">{$_('common.noResults')}</p>
			</div>
		{/if}
	{/if}
</div>

<!-- Sort & filter panel -->
<SlidePanel open={filterPanelOpen} title="sort & filter" onclose={() => (filterPanelOpen = false)}>
	<!-- Sort section -->
	<div class="flex flex-col gap-3 border-b border-[var(--void-3)] pt-1 pb-5">
		<div class="flex items-center justify-between">
			<span class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase">sort</span>
			<button
				type="button"
				class="flex items-center gap-1.5 text-xs text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
				onclick={() => (sortDesc = !sortDesc)}
			>
				{#if sortDesc}<CaretDownIcon size={12} />{:else}<CaretUpIcon size={12} />{/if}
				<span>{sortDesc ? 'desc' : 'asc'}</span>
			</button>
		</div>
		<div class="flex flex-wrap gap-1.5">
			{#each SORT_MODES as mode (mode.value)}
				<button
					type="button"
					class="px-2.5 py-1 text-xs transition-colors {sortMode === mode.value
						? 'border border-[var(--line)] bg-[var(--void-3)] text-[var(--text)]'
						: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
					onclick={() => (sortMode = mode.value)}
				>
					{mode.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Reading status section -->
	{#if allUserStatuses.length > 0}
		<div class="flex flex-col gap-3 border-b border-[var(--void-3)] py-5">
			<span class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase"
				>reading status</span
			>
			<div class="flex flex-wrap gap-1.5">
				{#each allUserStatuses as status (status.id)}
					{@const active = activeReadingStatusIds.includes(status.id)}
					<button
						type="button"
						class="px-2.5 py-1 text-xs transition-colors {active
							? 'border border-[var(--line)] bg-[var(--void-3)] text-[var(--text)]'
							: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
						onclick={() => toggleReadingStatus(status.id)}
					>
						{status.label}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Source status section -->
	{#if presentSourceStatusKeys.length > 0}
		<div
			class="flex flex-col gap-3 py-5 {allGenres.length > 0
				? 'border-b border-[var(--void-3)]'
				: ''}"
		>
			<span class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase"
				>source status</span
			>
			<div class="flex flex-wrap gap-1.5">
				{#each SOURCE_STATUS_FILTERS.filter( (f) => presentSourceStatusKeys.includes(f.key) ) as sf (sf.key)}
					{@const active = activeSourceStatusKeys.includes(sf.key)}
					<button
						type="button"
						class="px-2.5 py-1 text-xs transition-colors {active
							? 'border border-[var(--line)] bg-[var(--void-3)] text-[var(--text)]'
							: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
						onclick={() => toggleSourceStatus(sf.key)}
					>
						{sf.label}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Genre section -->
	{#if allGenres.length > 0}
		<div class="flex flex-col gap-3 py-5">
			<span class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase">genre</span>
			<div class="flex flex-wrap gap-1.5">
				{#each allGenres as genre (genre)}
					{@const active = activeGenres.includes(genre)}
					<button
						type="button"
						class="px-2.5 py-1 text-xs transition-colors {active
							? 'border border-[var(--line)] bg-[var(--void-3)] text-[var(--text)]'
							: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
						onclick={() => toggleGenre(genre)}
					>
						{genre}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Clear filters -->
	{#if hasActiveFilters}
		<div class="border-t border-[var(--void-3)] pt-4">
			<button
				type="button"
				onclick={clearFilters}
				class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase transition-colors hover:text-[var(--text-muted)]"
			>
				clear filters
			</button>
		</div>
	{/if}
</SlidePanel>
