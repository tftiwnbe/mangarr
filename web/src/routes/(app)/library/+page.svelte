<script lang="ts">
	import { goto } from '$app/navigation';
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

	type SortMode = 'updated' | 'added' | 'reading' | 'alpha' | 'status';

	const client = useConvexClient();
	const library = useQuery(convexApi.library.listMine, () => ({}));

	let searchQuery = $state('');
	let selectedCollectionId = $state<string | null>(null);
	let filterPanelOpen = $state(false);
	let sortMode = $state<SortMode>('updated');
	let sortDesc = $state(true);
	let activeReadingStatusIds = $state<string[]>([]);
	let activeSourceStatusKeys = $state<string[]>([]);
	let activeGenres = $state<string[]>([]);
	let requestedMetadataKeys = $state<string[]>([]);
	let metadataQueue = $state<string[]>([]);
	let metadataFetchCount = $state(0);
	let fetchedMetadataByTitleKey = $state<Record<string, { status?: number; genre?: string | null }>>({});

	const debouncedSearch = new DebouncedValue(() => searchQuery, 150);

	$effect(() => {
		panelOverlayOpen.set(filterPanelOpen);
		return () => panelOverlayOpen.set(false);
	});

	async function pollCommand(commandId: string, timeoutMs = 15000) {
		const startedAt = Date.now();
		while (Date.now() - startedAt < timeoutMs) {
			const command = await client.query(convexApi.commands.getMineById, {
				commandId: commandId as Id<'commands'>
			});
			if (!command) {
				throw new Error('Command not found');
			}
			if (command.status === 'succeeded') {
				return command;
			}
			if (command.status === 'failed' || command.status === 'cancelled' || command.status === 'dead_letter') {
				throw new Error(command.lastErrorMessage ?? 'Command failed');
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		throw new Error('Command timed out');
	}

	const SORT_MODES: { value: SortMode; label: string }[] = [
		{ value: 'updated', label: 'updated' },
		{ value: 'added', label: 'added' },
		{ value: 'reading', label: 'reading' },
		{ value: 'alpha', label: 'a-z' },
		{ value: 'status', label: 'status' }
	];

	const SOURCE_STATUS_FILTERS: { key: string; label: string; values: number[] }[] = [
		{ key: 'ongoing', label: 'ongoing', values: [TITLE_STATUS.ONGOING] },
		{
			key: 'completed',
			label: 'completed',
			values: [TITLE_STATUS.COMPLETED, TITLE_STATUS.COMPLETED_ALT]
		},
		{ key: 'hiatus', label: 'hiatus', values: [TITLE_STATUS.HIATUS] }
	];

	const metadataTargets = $derived.by(() => {
		const targets = new SvelteMap<string, { sourceId: string; titleUrl: string }>();
		for (const title of (library.data ?? []) as TitleItem[]) {
			targets.set(`${title.sourceId}::${title.titleUrl}`, {
				sourceId: title.sourceId,
				titleUrl: title.titleUrl
			});
		}
		return targets;
	});

	const titles = $derived(
		((library.data ?? []) as TitleItem[]).map((title) =>
			mapTitleToSummary(title, fetchedMetadataByTitleKey[`${title.sourceId}::${title.titleUrl}`])
		)
	);
	const loading = $derived(library.isLoading);
	const error = $derived(library.error instanceof Error ? library.error.message : null);

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

	$effect(() => {
		const nextRequested: string[] = [];
		for (const title of (library.data ?? []) as TitleItem[]) {
			if ((title.status ?? 0) > 0 && (title.genre ?? '').trim()) continue;
			const key = `${title.sourceId}::${title.titleUrl}`;
			if (requestedMetadataKeys.includes(key)) continue;
			if (fetchedMetadataByTitleKey[key] !== undefined) continue;
			nextRequested.push(key);
		}
		if (nextRequested.length === 0) return;
		requestedMetadataKeys = [...requestedMetadataKeys, ...nextRequested];
		metadataQueue = [...metadataQueue, ...nextRequested];
	});

	$effect(() => {
		if (metadataFetchCount >= 2 || metadataQueue.length === 0) return;
		const [nextKey, ...rest] = metadataQueue;
		const target = metadataTargets.get(nextKey);
		metadataQueue = rest;
		if (!target) return;
		metadataFetchCount += 1;
		void (async () => {
			try {
				const { commandId } = await client.mutation(convexApi.commands.enqueue, {
					commandType: 'explore.title.fetch',
					payload: {
						sourceId: target.sourceId,
						titleUrl: target.titleUrl
					}
				});
				const command = await pollCommand(String(commandId));
				const resultTitle = (command.result?.title as Record<string, unknown> | null) ?? null;
				fetchedMetadataByTitleKey = {
					...fetchedMetadataByTitleKey,
					[nextKey]: {
						status: typeof resultTitle?.status === 'number' ? resultTitle.status : 0,
						genre: typeof resultTitle?.genre === 'string' ? resultTitle.genre : null
					}
				};
			} catch {
				fetchedMetadataByTitleKey = {
					...fetchedMetadataByTitleKey,
					[nextKey]: {}
				};
			} finally {
				metadataFetchCount -= 1;
			}
		})();
	});

	function mapTitleToSummary(
		title: TitleItem,
		metadata?: { status?: number; genre?: string | null }
	): LibraryTitleSummary {
		return {
			id: title._id,
			title: title.title,
			thumbnail_url: coverSrc(title),
			chapters_count: title.chapterStats.total,
			updated_at: title.updatedAt,
			added_at: title.createdAt,
			last_read_at: title.lastReadAt ?? null,
			user_status: title.user_status ?? title.userStatus ?? null,
			status: metadata?.status ?? title.status ?? 0,
			genre: metadata?.genre ?? title.genre ?? null,
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
		return title.coverUrl ?? null;
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
</script>

<svelte:head>
	<title>{$_('nav.library')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-3">
	<div class="flex items-center gap-3">
		<h1 class="text-display flex-1 text-xl text-[var(--text)]">
			{$_('nav.library').toLowerCase()}
		</h1>
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
			</div>
			<Button variant="outline" onclick={() => goto('/explore')}>
				{$_('library.addFirst')}
			</Button>
		</div>
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

		{#if filteredTitles.length === 0}
			<div class="flex flex-col items-center gap-2 py-8 text-center">
				<p class="text-sm text-[var(--text-muted)]">{$_('common.noResults')}</p>
			</div>
		{/if}
	{/if}
</div>

<SlidePanel open={filterPanelOpen} title="sort & filter" onclose={() => (filterPanelOpen = false)}>
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
				{#each SOURCE_STATUS_FILTERS.filter((filter) => presentSourceStatusKeys.includes(filter.key)) as sourceFilter (sourceFilter.key)}
					{@const active = activeSourceStatusKeys.includes(sourceFilter.key)}
					<button
						type="button"
						class="px-2.5 py-1 text-xs transition-colors {active
							? 'border border-[var(--line)] bg-[var(--void-3)] text-[var(--text)]'
							: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
						onclick={() => toggleSourceStatus(sourceFilter.key)}
					>
						{sourceFilter.label}
					</button>
				{/each}
			</div>
		</div>
	{/if}

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
