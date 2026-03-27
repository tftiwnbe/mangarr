	<script lang="ts">
		import { goto } from '$app/navigation';
		import { onMount } from 'svelte';
		import { SvelteMap, SvelteSet } from 'svelte/reactivity';

	import { useConvexClient, useQuery } from 'convex-svelte';
	import {
		FunnelIcon,
		MagnifyingGlassIcon,
		XIcon,
		BookIcon,
		ImageIcon,
		CaretDownIcon,
		CaretUpIcon
	} from 'phosphor-svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import { convexApi } from '$lib/convex/api';
	import { Button } from '$lib/elements/button';
	import { Input } from '$lib/elements/input';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { DebouncedValue } from '$lib/hooks/use-debounced-value.svelte';
	import { _ } from '$lib/i18n';
	import { panelOverlayOpen } from '$lib/stores/ui';
	import { buildTitlePath } from '$lib/utils/routes';
	import { TITLE_STATUS } from '$lib/utils/title-status';

	type RawCollection = {
		id: number | string;
		name: string;
	};

	type RawUserStatus = {
		id: string;
		label: string;
	};

	type TitleItem = {
		_id: Id<'libraryTitles'>;
		title: string;
		sourceId: string;
		sourcePkg: string;
		sourceLang: string;
		titleUrl: string;
		coverUrl?: string | null;
		localCoverPath?: string | null;
		chapterStats: {
			total: number;
			queued: number;
			downloading: number;
			downloaded: number;
			failed: number;
		};
		createdAt: number;
		updatedAt: number;
		lastReadAt?: number;
		status?: number | null;
		genre?: string | null;
		userStatus?: RawUserStatus | null;
		user_status?: RawUserStatus | null;
		userRating?: number | null;
		user_rating?: number | null;
		collections?: RawCollection[] | null;
	};

	type LibraryCollectionResource = {
		id: string;
		name: string;
	};

	type LibraryTitleSummary = {
		id: string;
		title: string;
		thumbnail_url: string | null;
		chapters_count: number;
		updated_at: number;
		added_at: number;
		last_read_at: number | null;
		user_status: RawUserStatus | null;
		status: number;
		genre: string | null;
		collections: LibraryCollectionResource[];
		user_rating: number | null;
	};

	type HiddenTitleSummary = {
		_id: Id<'libraryTitles'>;
		title: string;
		sourceId: string;
		sourcePkg: string;
		sourceLang: string;
		titleUrl: string;
		coverUrl?: string | null;
		localCoverPath?: string | null;
		createdAt: number;
		updatedAt: number;
	};

	type SortMode = 'updated' | 'added' | 'reading' | 'alpha' | 'status';
	const INITIAL_LIBRARY_RENDER_LIMIT = 60;
	const LIBRARY_RENDER_PAGE_SIZE = 48;

	const client = useConvexClient();
	const library = useQuery(convexApi.library.listMine, () => ({}));
	const hiddenLibraryTitles = useQuery(convexApi.library.listHiddenMine, () => ({}));

	let searchQuery = $state('');
	let selectedCollectionId = $state<string | null>(null);
	let filterPanelOpen = $state(false);
	let hiddenPanelOpen = $state(false);
	let sortMode = $state<SortMode>('updated');
	let sortDesc = $state(true);
	let activeReadingStatusIds = $state<string[]>([]);
	let activeSourceStatusKeys = $state<string[]>([]);
		let activeGenres = $state<string[]>([]);
		let requestedMetadataTitleIds = $state<string[]>([]);
		let requestedCoverTitleIds = $state<string[]>([]);
		let revealTitleId = $state<string | null>(null);
		let libraryRenderLimit = $state(INITIAL_LIBRARY_RENDER_LIMIT);
		let libraryRenderSentinel = $state<HTMLDivElement | null>(null);
		let libraryRenderObserver: IntersectionObserver | null = null;
		let browserOnline = $state(true);

		onMount(() => {
			if (typeof navigator !== 'undefined') {
				browserOnline = navigator.onLine;
			}
			const handleOnline = () => {
				browserOnline = true;
			};
			const handleOffline = () => {
				browserOnline = false;
			};
			window.addEventListener('online', handleOnline);
			window.addEventListener('offline', handleOffline);
			return () => {
				window.removeEventListener('online', handleOnline);
				window.removeEventListener('offline', handleOffline);
			};
		});

	const debouncedSearch = new DebouncedValue(() => searchQuery, 150);

	$effect(() => {
		panelOverlayOpen.set(filterPanelOpen || hiddenPanelOpen);
		return () => panelOverlayOpen.set(false);
	});

	const SORT_MODES: Array<{ value: SortMode; labelKey: string }> = [
		{ value: 'updated', labelKey: 'library.sortModes.updated' },
		{ value: 'added', labelKey: 'library.sortModes.added' },
		{ value: 'reading', labelKey: 'library.sortModes.reading' },
		{ value: 'alpha', labelKey: 'library.sortModes.alpha' },
		{ value: 'status', labelKey: 'library.sortModes.status' }
	];

	const SOURCE_STATUS_FILTERS: Array<{ key: string; labelKey: string; values: number[] }> = [
		{ key: 'ongoing', labelKey: 'status.ongoing', values: [TITLE_STATUS.ONGOING] },
		{
			key: 'completed',
			labelKey: 'status.completed',
			values: [TITLE_STATUS.COMPLETED, TITLE_STATUS.COMPLETED_ALT]
		},
		{ key: 'hiatus', labelKey: 'status.hiatus', values: [TITLE_STATUS.HIATUS] }
	];

	const titles = $derived(((library.data ?? []) as TitleItem[]).map((title) => mapTitleToSummary(title)));
	const loading = $derived(library.isLoading);
	const error = $derived(library.error instanceof Error ? library.error.message : null);
	const hiddenTitles = $derived(((hiddenLibraryTitles.data ?? []) as HiddenTitleSummary[]).slice());
	const hiddenImportsCount = $derived(hiddenTitles.length);
	const renderContextKey = $derived(
		JSON.stringify({
			query: debouncedSearch.value?.trim().toLowerCase() ?? '',
			selectedCollectionId,
			sortMode,
			sortDesc,
			activeReadingStatusIds: [...activeReadingStatusIds].sort(),
			activeSourceStatusKeys: [...activeSourceStatusKeys].sort(),
			activeGenres: [...activeGenres].sort()
		})
	);

	const collections = $derived.by(() => {
		const seen = new SvelteMap<string, LibraryCollectionResource>();
		for (const title of titles) {
			for (const collection of title.collections) {
				if (!seen.has(collection.id)) {
					seen.set(collection.id, collection);
				}
			}
		}
		return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
	});

	const allUserStatuses = $derived.by(() => {
		const seen = new SvelteMap<string, RawUserStatus>();
		for (const title of titles) {
			if (title.user_status && !seen.has(title.user_status.id)) {
				seen.set(title.user_status.id, title.user_status);
			}
		}
		return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
	});

	const presentSourceStatusKeys = $derived.by(() => {
		const presentValues = new SvelteSet(titles.map((title) => title.status).filter((value) => value > 0));
		return SOURCE_STATUS_FILTERS.filter((filter) =>
			filter.values.some((value) => presentValues.has(value))
		).map((filter) => filter.key);
	});

	const allGenres = $derived.by(() => {
		const genres = new SvelteSet<string>();
		for (const title of titles) {
			if (!title.genre) continue;
			for (const genre of title.genre.split(',')) {
				const normalized = genre.trim();
				if (normalized) genres.add(normalized);
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
	const isEmpty = $derived(!loading && titles.length === 0);

	const filteredTitles = $derived.by(() => {
		const query = (debouncedSearch.value ?? '').trim().toLowerCase();
		const activeSourceValues = SOURCE_STATUS_FILTERS.filter((filter) =>
			activeSourceStatusKeys.includes(filter.key)
		).flatMap((filter) => filter.values);

		let result = titles.filter((title) => {
			if (selectedCollectionId !== null) {
				const inCollection = title.collections.some(
					(collection) => collection.id === selectedCollectionId
				);
				if (!inCollection) return false;
			}

			if (query && !title.title.toLowerCase().includes(query)) return false;

			if (
				activeReadingStatusIds.length > 0 &&
				(!title.user_status || !activeReadingStatusIds.includes(title.user_status.id))
			) {
				return false;
			}

			if (activeSourceValues.length > 0 && !activeSourceValues.includes(title.status)) {
				return false;
			}

			if (activeGenres.length > 0) {
				if (!title.genre) return false;
				const titleGenres = title.genre.split(',').map((genre) => genre.trim());
				if (!titleGenres.some((genre) => activeGenres.includes(genre))) return false;
			}

			return true;
		});

		result = [...result].sort((a, b) => {
			let cmp = 0;
			if (sortMode === 'updated') {
				cmp = a.updated_at - b.updated_at;
			} else if (sortMode === 'added') {
				cmp = a.added_at - b.added_at;
			} else if (sortMode === 'reading') {
				cmp = (a.last_read_at ?? 0) - (b.last_read_at ?? 0);
			} else if (sortMode === 'alpha') {
				cmp = a.title.localeCompare(b.title);
			} else if (sortMode === 'status') {
				cmp = (a.user_status?.label ?? '').localeCompare(b.user_status?.label ?? '');
			}
			return sortDesc ? -cmp : cmp;
		});

		return result;
	});
	const visibleFilteredTitles = $derived(filteredTitles.slice(0, libraryRenderLimit));

		$effect(() => {
			if (!browserOnline) return;
			const nextRequested: string[] = [];
			for (const title of (library.data ?? []) as TitleItem[]) {
				if ((title.status ?? 0) > 0 && (title.genre ?? '').trim()) continue;
			const key = String(title._id);
			if (requestedMetadataTitleIds.includes(key)) continue;
			nextRequested.push(key);
		}
		if (nextRequested.length === 0) return;
		requestedMetadataTitleIds = [...requestedMetadataTitleIds, ...nextRequested];
		void (async () => {
			try {
				await client.mutation(convexApi.library.ensureTitlesMetadata, {
					titleIds: nextRequested as Id<'libraryTitles'>[],
					limit: 20
				});
			} catch {
				// Keep the key marked as requested for this session to avoid a fetch loop.
				}
			})();
		});

		$effect(() => {
			if (!browserOnline) return;
			const nextRequested: string[] = [];
			for (const title of visibleFilteredTitles as LibraryTitleSummary[]) {
				const rawTitle = ((library.data ?? []) as TitleItem[]).find((item) => item._id === title.id);
				if (!rawTitle) continue;
				if (rawTitle.localCoverPath || !(rawTitle.coverUrl ?? '').trim()) continue;
				const key = String(rawTitle._id);
				if (requestedCoverTitleIds.includes(key)) continue;
				nextRequested.push(key);
			}
			if (nextRequested.length === 0) return;
			requestedCoverTitleIds = [...requestedCoverTitleIds, ...nextRequested];
			void (async () => {
				try {
					await client.mutation(convexApi.library.ensureTitlesCoverCache, {
						titleIds: nextRequested as Id<'libraryTitles'>[],
						limit: 24
					});
				} catch {
					// Keep the session markers to avoid cover-cache request loops.
				}
			})();
		});

	function resetLibraryRenderObserver() {
		libraryRenderObserver?.disconnect();
		libraryRenderObserver = null;
	}

	function maybeLoadMoreLibraryTitles() {
		if (visibleFilteredTitles.length >= filteredTitles.length) return;
		libraryRenderLimit = Math.min(
			libraryRenderLimit + LIBRARY_RENDER_PAGE_SIZE,
			filteredTitles.length
		);
	}

	$effect(() => {
		void renderContextKey;
		libraryRenderLimit = INITIAL_LIBRARY_RENDER_LIMIT;
	});

	$effect(() => {
		if (typeof window === 'undefined' || !libraryRenderSentinel) return;
		if (visibleFilteredTitles.length >= filteredTitles.length) {
			resetLibraryRenderObserver();
			return;
		}
		resetLibraryRenderObserver();
		libraryRenderObserver = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					maybeLoadMoreLibraryTitles();
				}
			},
			{
				root: null,
				rootMargin: '960px 0px 960px 0px',
				threshold: 0
			}
		);
		libraryRenderObserver.observe(libraryRenderSentinel);
		return () => {
			resetLibraryRenderObserver();
		};
	});

	function mapTitleToSummary(title: TitleItem): LibraryTitleSummary {
		return {
			id: title._id,
			title: title.title,
			thumbnail_url: coverSrc(title),
			chapters_count: title.chapterStats.total,
			updated_at: title.updatedAt,
			added_at: title.createdAt,
			last_read_at: title.lastReadAt ?? null,
			user_status: title.user_status ?? title.userStatus ?? null,
			status: title.status ?? 0,
			genre: title.genre ?? null,
			collections:
				title.collections?.map((collection) => ({
					id: String(collection.id),
					name: collection.name
				})) ?? [],
			user_rating: title.user_rating ?? title.userRating ?? null
		};
	}

		function coverSrc(title: Pick<TitleItem, 'localCoverPath' | 'coverUrl'>) {
			if (title.localCoverPath) {
				const params = new URLSearchParams({ path: title.localCoverPath });
				return `/api/internal/bridge/library/cover?${params.toString()}`;
			}
			if (!browserOnline) return null;
			return title.coverUrl ?? null;
		}

	function hiddenSourceLabel(title: HiddenTitleSummary) {
		return title.sourceLang ? `${title.sourcePkg} [${title.sourceLang}]` : title.sourcePkg;
	}

	async function revealInLibrary(titleId: string) {
		if (revealTitleId) return;
		revealTitleId = titleId;
		try {
			await client.mutation(convexApi.library.setTitleListedInLibrary, {
				titleId: titleId as Id<'libraryTitles'>,
				listed: true
			});
		} finally {
			revealTitleId = null;
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

	function collectionCount(collectionId: string): number {
		return titles.filter((title) =>
			title.collections.some((collection) => collection.id === collectionId)
		).length;
	}

	function toggleReadingStatus(id: string) {
		activeReadingStatusIds = activeReadingStatusIds.includes(id)
			? activeReadingStatusIds.filter((value) => value !== id)
			: [...activeReadingStatusIds, id];
	}

	function toggleSourceStatus(key: string) {
		activeSourceStatusKeys = activeSourceStatusKeys.includes(key)
			? activeSourceStatusKeys.filter((value) => value !== key)
			: [...activeSourceStatusKeys, key];
	}

	function toggleGenre(genre: string) {
		activeGenres = activeGenres.includes(genre)
			? activeGenres.filter((value) => value !== genre)
			: [...activeGenres, genre];
	}

	function clearFilters() {
		activeReadingStatusIds = [];
		activeSourceStatusKeys = [];
		activeGenres = [];
	}

	function sortModeLabel(labelKey: string) {
		return $_(labelKey);
	}

	function sourceStatusLabel(labelKey: string) {
		return $_(labelKey);
	}
</script>

<svelte:head>
	<title>{$_('nav.library')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-3">
	<div class="flex items-center gap-2">
		<h1 class="text-display flex-1 text-xl text-[var(--text)]">
			{$_('nav.library').toLowerCase()}
		</h1>
		{#if hiddenImportsCount > 0 && !loading}
			<Button variant="ghost" size="sm" onclick={() => (hiddenPanelOpen = true)}>
				{$_('library.hiddenButton', { values: { count: hiddenImportsCount } })}
			</Button>
		{/if}
		{#if !loading}
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

	{#if error}
		<div
			class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-4 py-3 text-sm text-[var(--error)]"
		>
			{error}
		</div>
	{/if}

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
				{#if hiddenImportsCount > 0}
					<p class="mt-2 max-w-xl text-sm text-[var(--text-ghost)]">
						{$_('library.hiddenImports', { values: { count: hiddenImportsCount } })}
					</p>
				{/if}
			</div>
			<div class="flex flex-wrap items-center justify-center gap-2">
				{#if hiddenImportsCount > 0}
					<Button variant="ghost" onclick={() => (hiddenPanelOpen = true)}>
						{$_('library.manageHidden')}
					</Button>
				{/if}
				<Button variant="outline" onclick={() => goto('/explore')}>
					{$_('library.addFirst')}
				</Button>
			</div>
		</div>
	{:else}
		<div class="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
			{#each visibleFilteredTitles as title (title.id)}
				{@const displayStatus = getDisplayStatus(title)}
				<a
					href={buildTitlePath(title.id, title.title)}
					class="group card-glow relative flex flex-col overflow-hidden border border-[var(--line)] bg-[var(--void-2)]"
				>
					<div class="relative aspect-[2/3] overflow-hidden bg-[var(--void-3)]">
						{#if title.thumbnail_url}
							<LazyImage
								src={title.thumbnail_url}
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
		{#if visibleFilteredTitles.length < filteredTitles.length}
			<div bind:this={libraryRenderSentinel} class="h-px w-full" aria-hidden="true"></div>
		{/if}

		{#if filteredTitles.length === 0}
			<div class="flex flex-col items-center gap-2 py-8 text-center">
				<p class="text-sm text-[var(--text-muted)]">{$_('common.noResults')}</p>
			</div>
		{/if}
	{/if}
</div>

<SlidePanel
	open={hiddenPanelOpen}
	title={$_('library.manageHidden')}
	onclose={() => (hiddenPanelOpen = false)}
>
	<div class="flex flex-col gap-4 pt-1">
		<p class="text-sm text-[var(--text-ghost)]">
			{$_('library.hiddenImports', { values: { count: hiddenImportsCount } })}
		</p>

		{#if hiddenLibraryTitles.isLoading}
			<p class="text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
		{:else if hiddenTitles.length === 0}
			<p class="text-sm text-[var(--text-ghost)]">{$_('common.empty')}</p>
		{:else}
			<div class="flex flex-col gap-3">
				{#each hiddenTitles as title (title._id)}
					<div class="flex items-center gap-3 border border-[var(--line)] bg-[var(--void-2)] p-3">
						<div class="h-18 w-12 shrink-0 overflow-hidden bg-[var(--void-4)]">
							{#if coverSrc(title)}
								<LazyImage
									src={coverSrc(title) ?? undefined}
									alt={title.title}
									class="h-full w-full"
									imgClass="object-cover"
								/>
							{:else}
								<div class="flex h-full w-full items-center justify-center">
									<ImageIcon size={16} class="text-[var(--text-ghost)]" />
								</div>
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm text-[var(--text)]">{title.title}</p>
							<p class="mt-1 text-[11px] text-[var(--text-ghost)]">{hiddenSourceLabel(title)}</p>
							<p class="mt-1 text-[11px] text-[var(--text-muted)]">
								{$_('library.hiddenUpdated', {
									values: { time: new Date(title.updatedAt).toLocaleString() }
								})}
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-2">
							<Button
								variant="ghost"
								size="sm"
								onclick={() => goto(buildTitlePath(String(title._id), title.title))}
							>
								{$_('common.open')}
							</Button>
							<Button
								variant="outline"
								size="sm"
								onclick={() => void revealInLibrary(String(title._id))}
								disabled={revealTitleId === String(title._id)}
							>
								{revealTitleId === String(title._id)
									? $_('common.loading')
									: $_('library.showInLibrary')}
							</Button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</SlidePanel>

<SlidePanel
	open={filterPanelOpen}
	title={$_('library.sortAndFilter')}
	onclose={() => (filterPanelOpen = false)}
>
	<div class="flex flex-col gap-3 border-b border-[var(--void-3)] pt-1 pb-5">
		<div class="flex items-center justify-between">
			<span class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase">
				{$_('library.sort')}
			</span>
			<button
				type="button"
				class="flex items-center gap-1.5 text-xs text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
				onclick={() => (sortDesc = !sortDesc)}
			>
				{#if sortDesc}<CaretDownIcon size={12} />{:else}<CaretUpIcon size={12} />{/if}
				<span>{sortDesc ? $_('library.desc') : $_('library.asc')}</span>
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
					{sortModeLabel(mode.labelKey)}
				</button>
			{/each}
		</div>
	</div>

	{#if allUserStatuses.length > 0}
		<div class="flex flex-col gap-3 border-b border-[var(--void-3)] py-5">
			<span class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase"
				>{$_('library.readingStatus')}</span
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

	{#if presentSourceStatusKeys.length > 0}
		<div
			class="flex flex-col gap-3 py-5 {allGenres.length > 0
				? 'border-b border-[var(--void-3)]'
				: ''}"
		>
			<span class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase"
				>{$_('library.sourceStatus')}</span
			>
			<div class="flex flex-wrap gap-1.5">
				{#each SOURCE_STATUS_FILTERS.filter((filter) => presentSourceStatusKeys.includes(filter.key)) as sourceFilter (sourceFilter.key)}
					{@const active = activeSourceStatusKeys.includes(sourceFilter.key)}
					<button
						type="button"
						class="px-2.5 py-1 text-xs transition-colors {active
							? 'border border-[var(--line)] bg-[var(--void-3)] text-[var(--text)]'
							: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
						onclick={() => toggleSourceStatus(sourceFilter.key)}
					>
						{sourceStatusLabel(sourceFilter.labelKey)}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	{#if allGenres.length > 0}
		<div class="flex flex-col gap-3 py-5">
			<span class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase">
				{$_('library.genres')}
			</span>
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

	{#if hasActiveFilters}
		<div class="border-t border-[var(--void-3)] pt-4">
			<button
				type="button"
				onclick={clearFilters}
				class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase transition-colors hover:text-[var(--text-muted)]"
			>
				{$_('library.clearFilters')}
			</button>
		</div>
	{/if}
</SlidePanel>
