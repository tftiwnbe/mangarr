<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';

	import { Dialog } from 'bits-ui';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import {
		BellIcon,
		BookIcon,
		BookOpenIcon,
		CaretDownIcon,
		CaretUpIcon,
		FunnelIcon,
		ImageIcon,
		PlusIcon,
		PencilSimpleIcon,
		TrashIcon
	} from 'phosphor-svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import { convexApi } from '$lib/convex/api';
	import { Alert } from '$lib/elements/alert';
	import { Button } from '$lib/elements/button';
	import { ConfirmDialog } from '$lib/elements/confirm-dialog';
	import { EmptyState } from '$lib/elements/empty-state';
	import { Input } from '$lib/elements/input';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { PanelSection } from '$lib/elements/panel-section';
	import { SearchInput } from '$lib/elements/search-input';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { DebouncedValue } from '$lib/hooks/use-debounced-value.svelte';
	import { _ } from '$lib/i18n';
	import { buildReaderPath, buildTitlePath } from '$lib/utils/routes';
	import { usePaginatedQuery } from '$lib/hooks/use-paginated-query.svelte';
	import { TITLE_STATUS } from '$lib/utils/title-status';

	type RawUserStatus = {
		id: string;
		label: string;
	};

	type TitleItem = Awaited<(typeof convexApi.library.listMinePage)['_returnType']>['page'][number];

	type LibraryCollectionResource = {
		id: string;
		name: string;
		position?: number;
		isDefault?: boolean;
		titlesCount?: number;
	};

	type DynamicCollectionFilters = {
		readingStatusIds: string[];
		excludedReadingStatusIds?: string[];
		updateStateKeys?: string[];
		sourceIds?: string[];
		excludedSourceIds?: string[];
		sourceStatusKeys: string[];
		excludedSourceStatusKeys?: string[];
		genres: string[];
		excludedGenres?: string[];
		genreMatchMode?: 'and' | 'or';
	};

	type DynamicCollectionResource = Awaited<
		(typeof convexApi.library.listDynamicCollections)['_returnType']
	>[number];

	type CollectionListItem =
		| {
				kind: 'manual';
				id: string;
				name: string;
				titlesCount: number;
				position: number;
				isDefault: boolean;
				notifyOnNewChapters: boolean;
		  }
		| {
				kind: 'dynamic';
				id: string;
				name: string;
				titlesCount: number;
				position: number;
				filters: DynamicCollectionFilters;
		  };

	type LibraryTitleSummary = {
		id: string;
		route_segment?: string | null;
		title: string;
		author: string | null;
		artist: string | null;
		thumbnail_url: string | null;
		chapters_count: number;
		updated_at: number;
		added_at: number;
		last_read_at: number | null;
		current_source_id: string;
		current_source_label: string;
		user_status: RawUserStatus | null;
		status: number;
		genre: string | null;
		collections: LibraryCollectionResource[];
		download_profile: {
			enabled: boolean;
			paused: boolean;
		} | null;
		user_rating: number | null;
		offline_readiness: TitleItem['offlineReadiness'];
	};

	type HiddenTitleSummary = Awaited<
		(typeof convexApi.library.listHiddenMine)['_returnType']
	>[number];

	type SortMode = 'updated' | 'added' | 'reading' | 'alpha' | 'status';
	type ReadingRailMode = 'continue' | 'updates';
	const INITIAL_LIBRARY_RENDER_LIMIT = 60;
	const LIBRARY_RENDER_PAGE_SIZE = 48;
	const LIBRARY_DATA_PAGE_SIZE = 96;

	const client = useConvexClient();
	const library = usePaginatedQuery(convexApi.library.listMinePage, () => ({}), {
		initialNumItems: LIBRARY_DATA_PAGE_SIZE
	});
	const CONTINUE_READING_FETCH_LIMIT = 24;
	const continueReading = useQuery(convexApi.library.listContinueReading, () => ({
		limit: CONTINUE_READING_FETCH_LIMIT
	}));
	const continueReadingUpdates = useQuery(convexApi.library.listContinueReadingUpdates, () => ({
		limit: CONTINUE_READING_FETCH_LIMIT
	}));
	const hiddenLibraryTitles = useQuery(convexApi.library.listHiddenMine, () => ({}));
	const collectionsQuery = useQuery(convexApi.library.listCollections, () => ({
		includeTitleCounts: false
	}));
	const dynamicCollectionsQuery = useQuery(convexApi.library.listDynamicCollections, () => ({}));

	let searchQuery = $state('');
	let selectedCollectionId = $state<string | null>(null);
	let selectedDynamicCollectionId = $state<string | null>(null);
	let filterPanelOpen = $state(false);
	let collectionsPanelOpen = $state(false);
	let hiddenPanelOpen = $state(false);
	let sortMode = $state<SortMode>('added');
	let sortDesc = $state(true);
	let readingRailMode = $state<ReadingRailMode>('continue');
	let activeReadingStatusIds = $state<string[]>([]);
	let excludedReadingStatusIds = $state<string[]>([]);
	let activeUpdateStateKeys = $state<string[]>([]);
	let activeSourceIds = $state<string[]>([]);
	let excludedSourceIds = $state<string[]>([]);
	let activeSourceStatusKeys = $state<string[]>([]);
	let excludedSourceStatusKeys = $state<string[]>([]);
	let activeGenres = $state<string[]>([]);
	let excludedGenres = $state<string[]>([]);
	let genreMatchMode = $state<'and' | 'or'>('and');
	let requestedMetadataTitleIds = $state<string[]>([]);
	let requestedCoverTitleIds = $state<string[]>([]);
	let revealTitleId = $state<string | null>(null);
	let libraryRenderLimit = $state(INITIAL_LIBRARY_RENDER_LIMIT);
	let libraryRenderSentinel = $state<HTMLDivElement | null>(null);
	let libraryRenderObserver: IntersectionObserver | null = null;
	let browserOnline = $state(true);
	let collectionDialogOpen = $state(false);
	let collectionDialogMode = $state<'create' | 'rename'>('create');
	let collectionDialogKind = $state<'manual' | 'dynamic'>('manual');
	let collectionDialogName = $state('');
	let collectionDialogSaving = $state(false);
	let collectionDialogError = $state<string | null>(null);
	let collectionDialogTargetId = $state<string | null>(null);
	let collectionDialogDraftFilters = $state<DynamicCollectionFilters | null>(null);
	let collectionsError = $state<string | null>(null);
	let pendingDelete = $state<{ kind: 'manual' | 'dynamic'; id: string; name: string } | null>(null);
	let deletingCollectionId = $state<string | null>(null);
	let defaultCollectionBootstrapped = $state(false);
	let initializedFromUrl = $state(false);

	onMount(() => {
		if (!initializedFromUrl) {
			const person = page.url.searchParams.get('person')?.trim() ?? '';
			if (person) {
				searchQuery = person;
			}
			initializedFromUrl = true;
		}
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

	const SORT_MODES: Array<{ value: SortMode; labelKey: string }> = [
		{ value: 'added', labelKey: 'library.sortModes.added' },
		{ value: 'updated', labelKey: 'library.sortModes.updated' },
		{ value: 'reading', labelKey: 'library.sortModes.reading' },
		{ value: 'alpha', labelKey: 'library.sortModes.alpha' },
		{ value: 'status', labelKey: 'library.sortModes.status' }
	];

	const UPDATE_STATE_FILTERS = [
		{ key: 'enabled', label: () => $_('downloads.enabled') },
		{ key: 'disabled', label: () => $_('downloads.disabled') }
	] as const;

	const SOURCE_STATUS_FILTERS: Array<{ key: string; labelKey: string; values: number[] }> = [
		{ key: 'ongoing', labelKey: 'status.ongoing', values: [TITLE_STATUS.ONGOING] },
		{
			key: 'completed',
			labelKey: 'status.completed',
			values: [TITLE_STATUS.COMPLETED, TITLE_STATUS.COMPLETED_ALT]
		},
		{ key: 'hiatus', labelKey: 'status.hiatus', values: [TITLE_STATUS.HIATUS] }
	];

	$effect(() => {
		if (library.status === 'CanLoadMore') {
			library.loadMore(LIBRARY_DATA_PAGE_SIZE);
		}
	});

	const titles = $derived(library.data.map((title) => mapTitleToSummary(title)));
	const loading = $derived(library.isLoading);
	const error = $derived(library.error instanceof Error ? library.error.message : null);
	const hiddenTitles = $derived((hiddenLibraryTitles.data ?? []).slice());
	const continueReadingItems = $derived(
		(continueReading.data?.items ?? []).map((item) => ({
			...item,
			coverSrc: continueCoverSrc(item)
		}))
	);
	const continueReadingUpdateItems = $derived(
		(continueReadingUpdates.data?.items ?? []).map((item) => ({
			...item,
			coverSrc: continueCoverSrc(item)
		}))
	);
	const continueReadingLoading = $derived(continueReading.isLoading);
	const continueReadingUpdatesLoading = $derived(continueReadingUpdates.isLoading);
	const activeReadingRailItems = $derived(
		readingRailMode === 'updates' ? continueReadingUpdateItems : continueReadingItems
	);
	const activeReadingRailLoading = $derived(
		readingRailMode === 'updates' ? continueReadingUpdatesLoading : continueReadingLoading
	);
	const activeReadingRailLabel = $derived(
		readingRailMode === 'updates'
			? $_('library.continueReadingUpdates')
			: $_('library.continueReading')
	);
	const inactiveReadingRailLabel = $derived(
		readingRailMode === 'updates' ? $_('library.continueReading') : $_('library.updates')
	);
	const hiddenImportsCount = $derived(hiddenTitles.length);
	const renderContextKey = $derived(
		JSON.stringify({
			query: debouncedSearch.value?.trim().toLowerCase() ?? '',
			selectedCollectionId,
			selectedDynamicCollectionId,
			sortMode,
			sortDesc,
			activeReadingStatusIds: [...activeReadingStatusIds].sort(),
			excludedReadingStatusIds: [...excludedReadingStatusIds].sort(),
			activeUpdateStateKeys: [...activeUpdateStateKeys].sort(),
			activeSourceIds: [...activeSourceIds].sort(),
			excludedSourceIds: [...excludedSourceIds].sort(),
			activeSourceStatusKeys: [...activeSourceStatusKeys].sort(),
			excludedSourceStatusKeys: [...excludedSourceStatusKeys].sort(),
			activeGenres: [...activeGenres].sort(),
			excludedGenres: [...excludedGenres].sort(),
			genreMatchMode
		})
	);

	const dynamicCollections = $derived.by(() =>
		((dynamicCollectionsQuery.data ?? []) as DynamicCollectionResource[]).map((collection) => ({
			...collection,
			id: String(collection.id),
			titlesCount: titles.filter((title) =>
				matchesDynamicCollectionFilters(title, collection.filters)
			).length
		}))
	);

	const selectedDynamicCollection = $derived.by(
		() =>
			dynamicCollections.find((collection) => collection.id === selectedDynamicCollectionId) ?? null
	);

	const collectionTitleCounts = $derived.by(() => {
		const counts = new SvelteMap<string, number>();
		for (const title of titles) {
			for (const collection of title.collections) {
				counts.set(collection.id, (counts.get(collection.id) ?? 0) + 1);
			}
		}
		return counts;
	});

	const collections = $derived.by(() =>
		(
			(collectionsQuery.data ?? []) as Array<{
				id: Id<'libraryCollections'>;
				name: string;
				position: number;
				isDefault: boolean;
				notifyOnNewChapters: boolean;
				titlesCount: number;
			}>
		).map((collection) => ({
			id: String(collection.id),
			name: collection.name,
			position: collection.position,
			isDefault: collection.isDefault,
			notifyOnNewChapters: collection.notifyOnNewChapters,
			titlesCount: collectionTitleCounts.get(String(collection.id)) ?? 0
		}))
	);

	const combinedCollections = $derived.by(() => {
		const manual = collections.map(
			(collection): CollectionListItem => ({
				kind: 'manual',
				id: collection.id,
				name: collection.name,
				titlesCount: collection.titlesCount ?? 0,
				position: collection.position ?? 0,
				isDefault: collection.isDefault ?? false,
				notifyOnNewChapters: collection.notifyOnNewChapters ?? false
			})
		);
		const dynamic = dynamicCollections.map(
			(collection): CollectionListItem => ({
				kind: 'dynamic',
				id: collection.id,
				name: collection.name,
				titlesCount: collection.titlesCount,
				position: collection.position,
				filters: collection.filters
			})
		);
		return [...manual, ...dynamic].sort((a, b) => a.position - b.position);
	});
	const manualCollections = $derived.by(
		() =>
			combinedCollections.filter((collection) => collection.kind === 'manual') as Extract<
				CollectionListItem,
				{ kind: 'manual' }
			>[]
	);
	const dynamicCollectionsList = $derived.by(
		() =>
			combinedCollections.filter((collection) => collection.kind === 'dynamic') as Extract<
				CollectionListItem,
				{ kind: 'dynamic' }
			>[]
	);
	const defaultManualCollection = $derived.by(
		() => manualCollections.find((collection) => collection.isDefault) ?? null
	);

	const listedTitlesCount = $derived(titles.length);

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
		const presentValues = new SvelteSet(
			titles.map((title) => title.status).filter((value) => value > 0)
		);
		return SOURCE_STATUS_FILTERS.filter((filter) =>
			filter.values.some((value) => presentValues.has(value))
		).map((filter) => filter.key);
	});

	const availableCurrentSources = $derived.by(() => {
		const seen = new SvelteMap<string, string>();
		for (const title of titles) {
			if (!seen.has(title.current_source_id)) {
				seen.set(title.current_source_id, title.current_source_label);
			}
		}
		return [...seen.entries()]
			.map(([id, label]) => ({ id, label }))
			.sort((left, right) => left.label.localeCompare(right.label));
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
			excludedReadingStatusIds.length > 0 ||
			activeUpdateStateKeys.length > 0 ||
			activeSourceIds.length > 0 ||
			excludedSourceIds.length > 0 ||
			activeSourceStatusKeys.length > 0 ||
			excludedSourceStatusKeys.length > 0 ||
			activeGenres.length > 0 ||
			excludedGenres.length > 0
	);

	const currentFilterSnapshot = $derived.by(() =>
		normalizeDynamicCollectionFilters(snapshotActiveFilters())
	);
	const selectedDynamicCollectionDirty = $derived.by(() => {
		if (!selectedDynamicCollection) return false;
		return !sameDynamicCollectionFilters(selectedDynamicCollection.filters, currentFilterSnapshot);
	});

	const hasActiveControls = $derived(hasActiveFilters || sortMode !== 'added' || !sortDesc);

	let genreSearch = $state('');
	const filteredGenreOptions = $derived.by(() => {
		const q = genreSearch.trim().toLowerCase();
		if (!q) return allGenres;
		return allGenres.filter((g) => g.toLowerCase().includes(q));
	});
	const isEmpty = $derived(!loading && titles.length === 0);

	const filteredTitles = $derived.by(() => {
		const query = (debouncedSearch.value ?? '').trim().toLowerCase();
		const activeSourceValues = SOURCE_STATUS_FILTERS.filter((filter) =>
			activeSourceStatusKeys.includes(filter.key)
		).flatMap((filter) => filter.values);
		const excludedSourceValues = SOURCE_STATUS_FILTERS.filter((filter) =>
			excludedSourceStatusKeys.includes(filter.key)
		).flatMap((filter) => filter.values);

		let result = titles.filter((title) => {
			const updateState = monitorStateKey(title);
			if (selectedCollectionId !== null) {
				const inCollection = title.collections.some(
					(collection) => collection.id === selectedCollectionId
				);
				if (!inCollection) return false;
			}

			if (query) {
				const people = [title.author ?? '', title.artist ?? '']
					.map((value) => value.trim().toLowerCase())
					.filter(Boolean);
				const matchesQuery =
					title.title.toLowerCase().includes(query) ||
					people.some((value) => value.includes(query));
				if (!matchesQuery) return false;
			}

			if (
				activeReadingStatusIds.length > 0 &&
				(!title.user_status || !activeReadingStatusIds.includes(title.user_status.id))
			) {
				return false;
			}

			if (title.user_status && excludedReadingStatusIds.includes(title.user_status.id)) {
				return false;
			}

			if (activeUpdateStateKeys.length > 0 && !activeUpdateStateKeys.includes(updateState)) {
				return false;
			}

			if (activeSourceIds.length > 0 && !activeSourceIds.includes(title.current_source_id)) {
				return false;
			}

			if (excludedSourceIds.length > 0 && excludedSourceIds.includes(title.current_source_id)) {
				return false;
			}

			if (activeSourceValues.length > 0 && !activeSourceValues.includes(title.status)) {
				return false;
			}

			if (excludedSourceValues.length > 0 && excludedSourceValues.includes(title.status)) {
				return false;
			}

			if (activeGenres.length > 0) {
				if (!title.genre) return false;
				const titleGenres = title.genre.split(',').map((genre) => genre.trim());
				if (!titleGenres.some((genre) => activeGenres.includes(genre))) return false;
			}

			if (excludedGenres.length > 0 && title.genre) {
				const titleGenres = title.genre.split(',').map((genre) => genre.trim());
				if (titleGenres.some((genre) => excludedGenres.includes(genre))) return false;
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
		for (const title of visibleFilteredTitles as LibraryTitleSummary[]) {
			const key = String(title.id);
			if (requestedMetadataTitleIds.includes(key) || requestedCoverTitleIds.includes(key)) continue;
			if (
				title.offline_readiness.titlePageReady &&
				(!title.offline_readiness.missingCoverCache || title.offline_readiness.cachedCover)
			) {
				continue;
			}
			nextRequested.push(key);
		}
		if (nextRequested.length === 0) return;
		requestedMetadataTitleIds = [...requestedMetadataTitleIds, ...nextRequested];
		requestedCoverTitleIds = [...requestedCoverTitleIds, ...nextRequested];
		void (async () => {
			try {
				await client.mutation(convexApi.library.ensureTitlesOfflineReady, {
					titleIds: nextRequested as Id<'libraryTitles'>[],
					limit: 24
				});
			} catch {
				// Keep the session markers to avoid prewarm loops.
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
		if (collectionsQuery.isLoading || defaultCollectionBootstrapped) return;
		defaultCollectionBootstrapped = true;
		if (
			selectedCollectionId !== null ||
			selectedDynamicCollectionId !== null ||
			activeReadingStatusIds.length > 0 ||
			activeSourceStatusKeys.length > 0 ||
			excludedReadingStatusIds.length > 0 ||
			activeUpdateStateKeys.length > 0 ||
			excludedSourceStatusKeys.length > 0 ||
			activeGenres.length > 0 ||
			excludedGenres.length > 0
		) {
			return;
		}
		if (defaultManualCollection) {
			selectManualCollection(defaultManualCollection.id);
		}
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
			route_segment: title.routeSegment ?? null,
			title: title.title,
			author: title.author ?? null,
			artist: title.artist ?? null,
			thumbnail_url: coverSrc(title),
			chapters_count: title.chapterStats.total,
			updated_at: title.updatedAt,
			added_at: title.createdAt,
			last_read_at: title.lastReadAt ?? null,
			current_source_id: title.currentSourceId,
			current_source_label: title.currentSourceLabel,
			user_status: title.userStatus ?? null,
			status: title.status ?? 0,
			genre: title.genre ?? null,
			collections:
				title.collections?.map((collection) => ({
					id: String(collection.id),
					name: collection.name
				})) ?? [],
			download_profile: title.downloadProfile ?? null,
			user_rating: title.userRating ?? null,
			offline_readiness: title.offlineReadiness
		};
	}

	function continueCoverSrc(item: {
		titleId: Id<'libraryTitles'>;
		localCoverPath: string | null;
		coverUrl: string | null;
	}) {
		if (item.localCoverPath) {
			const params = new URLSearchParams({ titleId: String(item.titleId) });
			return `/api/internal/bridge/library/cover?${params.toString()}`;
		}
		if (!browserOnline) return null;
		return item.coverUrl ?? null;
	}

	function continueProgressPercent(item: {
		chapter: { totalPages: number | null; pageIndex: number; hasProgress: boolean };
		chaptersTotal: number;
		chaptersRead: number;
	}): number {
		const { chapter, chaptersTotal, chaptersRead } = item;
		if (
			chapter.hasProgress &&
			chapter.totalPages !== null &&
			chapter.totalPages > 0 &&
			chapter.pageIndex >= 0
		) {
			const ratio = (chapter.pageIndex + 1) / chapter.totalPages;
			return Math.max(2, Math.min(100, Math.round(ratio * 100)));
		}
		if (chaptersTotal > 0) {
			return Math.max(0, Math.min(100, Math.round((chaptersRead / chaptersTotal) * 100)));
		}
		return 0;
	}

	function toggleReadingRailMode() {
		readingRailMode = readingRailMode === 'updates' ? 'continue' : 'updates';
	}

	function coverSrc(title: Pick<TitleItem, '_id' | 'localCoverPath' | 'coverUrl'>) {
		if (title.localCoverPath) {
			const params = new URLSearchParams({ titleId: String(title._id) });
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

	function snapshotActiveFilters(): DynamicCollectionFilters {
		return {
			readingStatusIds: [...activeReadingStatusIds],
			excludedReadingStatusIds: [...excludedReadingStatusIds],
			updateStateKeys: [...activeUpdateStateKeys],
			sourceIds: [...activeSourceIds],
			excludedSourceIds: [...excludedSourceIds],
			sourceStatusKeys: [...activeSourceStatusKeys],
			excludedSourceStatusKeys: [...excludedSourceStatusKeys],
			genres: [...activeGenres],
			excludedGenres: [...excludedGenres],
			genreMatchMode
		};
	}

	function normalizeDynamicCollectionFilters(
		filters: DynamicCollectionFilters
	): DynamicCollectionFilters {
		return {
			readingStatusIds: [...new Set(filters.readingStatusIds)],
			excludedReadingStatusIds: [...new Set(filters.excludedReadingStatusIds ?? [])],
			updateStateKeys: [...new Set(filters.updateStateKeys ?? [])],
			sourceIds: [...new Set(filters.sourceIds ?? [])],
			excludedSourceIds: [...new Set(filters.excludedSourceIds ?? [])],
			sourceStatusKeys: [...new Set(filters.sourceStatusKeys)],
			excludedSourceStatusKeys: [...new Set(filters.excludedSourceStatusKeys ?? [])],
			genres: [...new Set(filters.genres)],
			excludedGenres: [...new Set(filters.excludedGenres ?? [])],
			genreMatchMode: filters.genreMatchMode === 'or' ? 'or' : 'and'
		};
	}

	function sameDynamicCollectionFilters(
		left: DynamicCollectionFilters,
		right: DynamicCollectionFilters
	): boolean {
		const normalizedLeft = normalizeDynamicCollectionFilters(left);
		const normalizedRight = normalizeDynamicCollectionFilters(right);
		return (
			normalizedLeft.readingStatusIds.join('\u0000') ===
				normalizedRight.readingStatusIds.join('\u0000') &&
			(normalizedLeft.excludedReadingStatusIds ?? []).join('\u0000') ===
				(normalizedRight.excludedReadingStatusIds ?? []).join('\u0000') &&
			(normalizedLeft.updateStateKeys ?? []).join('\u0000') ===
				(normalizedRight.updateStateKeys ?? []).join('\u0000') &&
			(normalizedLeft.sourceIds ?? []).join('\u0000') ===
				(normalizedRight.sourceIds ?? []).join('\u0000') &&
			(normalizedLeft.excludedSourceIds ?? []).join('\u0000') ===
				(normalizedRight.excludedSourceIds ?? []).join('\u0000') &&
			normalizedLeft.sourceStatusKeys.join('\u0000') ===
				normalizedRight.sourceStatusKeys.join('\u0000') &&
			(normalizedLeft.excludedSourceStatusKeys ?? []).join('\u0000') ===
				(normalizedRight.excludedSourceStatusKeys ?? []).join('\u0000') &&
			normalizedLeft.genres.join('\u0000') === normalizedRight.genres.join('\u0000') &&
			(normalizedLeft.excludedGenres ?? []).join('\u0000') ===
				(normalizedRight.excludedGenres ?? []).join('\u0000') &&
			normalizedLeft.genreMatchMode === normalizedRight.genreMatchMode
		);
	}

	function matchesDynamicCollectionFilters(
		title: LibraryTitleSummary,
		filters: DynamicCollectionFilters
	): boolean {
		const updateState = monitorStateKey(title);
		const activeSourceValues = SOURCE_STATUS_FILTERS.filter((filter) =>
			filters.sourceStatusKeys.includes(filter.key)
		).flatMap((filter) => filter.values);
		const excludedSourceValues = SOURCE_STATUS_FILTERS.filter((filter) =>
			(filters.excludedSourceStatusKeys ?? []).includes(filter.key)
		).flatMap((filter) => filter.values);

		if (
			filters.readingStatusIds.length > 0 &&
			(!title.user_status || !filters.readingStatusIds.includes(title.user_status.id))
		) {
			return false;
		}

		if (
			title.user_status &&
			(filters.excludedReadingStatusIds ?? []).includes(title.user_status.id)
		) {
			return false;
		}

		if (
			(filters.updateStateKeys ?? []).length > 0 &&
			!(filters.updateStateKeys ?? []).includes(updateState)
		) {
			return false;
		}

		if (
			(filters.sourceIds ?? []).length > 0 &&
			!(filters.sourceIds ?? []).includes(title.current_source_id)
		) {
			return false;
		}

		if (
			(filters.excludedSourceIds ?? []).length > 0 &&
			(filters.excludedSourceIds ?? []).includes(title.current_source_id)
		) {
			return false;
		}

		if (activeSourceValues.length > 0 && !activeSourceValues.includes(title.status)) {
			return false;
		}

		if (excludedSourceValues.length > 0 && excludedSourceValues.includes(title.status)) {
			return false;
		}

		if (filters.genres.length > 0) {
			if (!title.genre) return false;
			const titleGenres = title.genre.split(',').map((genre) => genre.trim());
			const matchesGenres =
				(filters.genreMatchMode ?? 'and') === 'or'
					? filters.genres.some((genre) => titleGenres.includes(genre))
					: filters.genres.every((genre) => titleGenres.includes(genre));
			if (!matchesGenres) {
				return false;
			}
		}

		if ((filters.excludedGenres ?? []).length > 0 && title.genre) {
			const titleGenres = title.genre.split(',').map((genre) => genre.trim());
			if ((filters.excludedGenres ?? []).some((genre) => titleGenres.includes(genre))) {
				return false;
			}
		}

		return true;
	}

	function applyDynamicCollectionFilters(
		filters: DynamicCollectionFilters,
		collectionId: string | null
	) {
		activeReadingStatusIds = [...filters.readingStatusIds];
		excludedReadingStatusIds = [...(filters.excludedReadingStatusIds ?? [])];
		activeUpdateStateKeys = [...(filters.updateStateKeys ?? [])];
		activeSourceIds = [...(filters.sourceIds ?? [])];
		excludedSourceIds = [...(filters.excludedSourceIds ?? [])];
		activeSourceStatusKeys = [...filters.sourceStatusKeys];
		excludedSourceStatusKeys = [...(filters.excludedSourceStatusKeys ?? [])];
		activeGenres = [...filters.genres];
		excludedGenres = [...(filters.excludedGenres ?? [])];
		genreMatchMode = filters.genreMatchMode === 'or' ? 'or' : 'and';
		selectedDynamicCollectionId = collectionId;
	}

	function closeCollectionsPanel() {
		collectionsPanelOpen = false;
		collectionsError = null;
	}

	function dynamicCollectionSummary(filters: DynamicCollectionFilters) {
		const parts: string[] = [];
		const readingStatusCount =
			filters.readingStatusIds.length + (filters.excludedReadingStatusIds?.length ?? 0);
		if (readingStatusCount > 0) {
			parts.push(`${readingStatusCount} ${$_('library.readingStatus').toLowerCase()}`);
		}
		const sourceStatusCount =
			filters.sourceStatusKeys.length + (filters.excludedSourceStatusKeys?.length ?? 0);
		if (sourceStatusCount > 0) {
			parts.push(`${sourceStatusCount} ${$_('library.sourceStatus').toLowerCase()}`);
		}
		const sourceCount = (filters.sourceIds?.length ?? 0) + (filters.excludedSourceIds?.length ?? 0);
		if (sourceCount > 0) {
			parts.push(`${sourceCount} ${$_('settings.sources').toLowerCase()}`);
		}
		const updateStateCount = filters.updateStateKeys?.length ?? 0;
		if (updateStateCount > 0) {
			parts.push(`${updateStateCount} ${$_('downloads.monitor').toLowerCase()}`);
		}
		const genreCount = filters.genres.length + (filters.excludedGenres?.length ?? 0);
		if (genreCount > 0) {
			parts.push(
				`${genreCount} ${$_('library.genres').toLowerCase()} (${$_(`library.genreMode.${filters.genreMatchMode ?? 'and'}`)})`
			);
		}
		return parts.join(' · ');
	}

	async function updateSelectedDynamicCollectionFilters() {
		if (!selectedDynamicCollection) return;
		collectionsError = null;
		try {
			await client.mutation(convexApi.library.updateDynamicCollection, {
				collectionId: selectedDynamicCollection.id as Id<'libraryDynamicCollections'>,
				filters: currentFilterSnapshot
			});
			filterPanelOpen = false;
		} catch (cause) {
			collectionsError =
				cause instanceof Error ? cause.message : 'Failed to update dynamic collection';
		}
	}

	function selectManualCollection(collectionId: string | null) {
		selectedCollectionId = collectionId;
		selectedDynamicCollectionId = null;
		activeReadingStatusIds = [];
		excludedReadingStatusIds = [];
		activeUpdateStateKeys = [];
		activeSourceIds = [];
		excludedSourceIds = [];
		activeSourceStatusKeys = [];
		excludedSourceStatusKeys = [];
		activeGenres = [];
		excludedGenres = [];
		genreMatchMode = 'and';
	}

	function selectDynamicCollection(collection: Extract<CollectionListItem, { kind: 'dynamic' }>) {
		selectedCollectionId = null;
		applyDynamicCollectionFilters(collection.filters, collection.id);
	}

	function openCreateCollectionDialog() {
		collectionDialogMode = 'create';
		collectionDialogKind = 'manual';
		collectionDialogName = '';
		collectionDialogSaving = false;
		collectionDialogError = null;
		collectionDialogTargetId = null;
		collectionDialogDraftFilters = null;
		collectionDialogOpen = true;
	}

	function openCreateDynamicCollectionDialog() {
		collectionDialogMode = 'create';
		collectionDialogKind = 'dynamic';
		collectionDialogName = '';
		collectionDialogSaving = false;
		collectionDialogError = null;
		collectionDialogTargetId = null;
		collectionDialogDraftFilters = snapshotActiveFilters();
		filterPanelOpen = false;
		collectionDialogOpen = true;
	}

	function openRenameCollectionDialog(collection: CollectionListItem) {
		collectionDialogMode = 'rename';
		collectionDialogKind = collection.kind;
		collectionDialogName = collection.name;
		collectionDialogSaving = false;
		collectionDialogError = null;
		collectionDialogTargetId = collection.id;
		collectionDialogDraftFilters = collection.kind === 'dynamic' ? collection.filters : null;
		collectionDialogOpen = true;
	}

	async function toggleManualCollectionNotifications(
		collection: Extract<CollectionListItem, { kind: 'manual' }>
	) {
		collectionsError = null;
		try {
			await client.mutation(convexApi.library.updateCollection, {
				collectionId: collection.id as Id<'libraryCollections'>,
				name: collection.name,
				notifyOnNewChapters: !collection.notifyOnNewChapters
			});
		} catch (cause) {
			collectionsError =
				cause instanceof Error ? cause.message : 'Failed to update collection notifications';
		}
	}

	async function setLibraryDefaultCollection(collectionId: string | null) {
		collectionsError = null;
		try {
			await client.mutation(convexApi.library.setDefaultCollection, {
				collectionId: collectionId ? (collectionId as Id<'libraryCollections'>) : null
			});
		} catch (cause) {
			collectionsError =
				cause instanceof Error ? cause.message : 'Failed to update default collection';
		}
	}

	function closeCollectionDialog() {
		collectionDialogOpen = false;
		collectionDialogError = null;
		collectionDialogSaving = false;
		collectionDialogTargetId = null;
		collectionDialogDraftFilters = null;
	}

	async function submitCollectionDialog() {
		const name = collectionDialogName.trim();
		if (!name) return;
		collectionDialogSaving = true;
		collectionDialogError = null;
		try {
			if (collectionDialogMode === 'create' && collectionDialogKind === 'manual') {
				const created = await client.mutation(convexApi.library.createCollection, { name });
				selectManualCollection(String(created.id));
			} else if (collectionDialogMode === 'create' && collectionDialogKind === 'dynamic') {
				if (!collectionDialogDraftFilters) return;
				const created = await client.mutation(convexApi.library.createDynamicCollection, {
					name,
					filters: collectionDialogDraftFilters
				});
				selectDynamicCollection({
					kind: 'dynamic',
					id: String(created.id),
					name: created.name,
					position: created.position,
					titlesCount: 0,
					filters: created.filters
				});
			} else if (
				collectionDialogMode === 'rename' &&
				collectionDialogKind === 'manual' &&
				collectionDialogTargetId
			) {
				await client.mutation(convexApi.library.updateCollection, {
					collectionId: collectionDialogTargetId as Id<'libraryCollections'>,
					name
				});
			} else if (
				collectionDialogMode === 'rename' &&
				collectionDialogKind === 'dynamic' &&
				collectionDialogTargetId
			) {
				await client.mutation(convexApi.library.updateDynamicCollection, {
					collectionId: collectionDialogTargetId as Id<'libraryDynamicCollections'>,
					name
				});
			}
			closeCollectionDialog();
			closeCollectionsPanel();
		} catch (cause) {
			collectionDialogError = cause instanceof Error ? cause.message : 'Failed to save collection';
		} finally {
			collectionDialogSaving = false;
		}
	}

	async function confirmDeleteCollection() {
		if (!pendingDelete || deletingCollectionId) return;
		deletingCollectionId = pendingDelete.id;
		collectionsError = null;
		try {
			if (pendingDelete.kind === 'manual') {
				await client.mutation(convexApi.library.deleteCollection, {
					collectionId: pendingDelete.id as Id<'libraryCollections'>
				});
				if (selectedCollectionId === pendingDelete.id) {
					selectedCollectionId = null;
				}
			} else {
				await client.mutation(convexApi.library.deleteDynamicCollection, {
					collectionId: pendingDelete.id as Id<'libraryDynamicCollections'>
				});
				if (selectedDynamicCollectionId === pendingDelete.id) {
					selectedDynamicCollectionId = null;
				}
			}
			pendingDelete = null;
		} catch (cause) {
			collectionsError = cause instanceof Error ? cause.message : 'Failed to delete collection';
		} finally {
			deletingCollectionId = null;
		}
	}

	function toggleReadingStatus(id: string) {
		if (activeReadingStatusIds.includes(id)) {
			activeReadingStatusIds = activeReadingStatusIds.filter((value) => value !== id);
			excludedReadingStatusIds = [...new Set([...excludedReadingStatusIds, id])];
			return;
		}
		if (excludedReadingStatusIds.includes(id)) {
			excludedReadingStatusIds = excludedReadingStatusIds.filter((value) => value !== id);
			return;
		}
		activeReadingStatusIds = [...new Set([...activeReadingStatusIds, id])];
	}

	function toggleSourceStatus(key: string) {
		if (activeSourceStatusKeys.includes(key)) {
			activeSourceStatusKeys = activeSourceStatusKeys.filter((value) => value !== key);
			excludedSourceStatusKeys = [...new Set([...excludedSourceStatusKeys, key])];
			return;
		}
		if (excludedSourceStatusKeys.includes(key)) {
			excludedSourceStatusKeys = excludedSourceStatusKeys.filter((value) => value !== key);
			return;
		}
		activeSourceStatusKeys = [...new Set([...activeSourceStatusKeys, key])];
	}

	function toggleCurrentSource(id: string) {
		if (activeSourceIds.includes(id)) {
			activeSourceIds = activeSourceIds.filter((value) => value !== id);
			excludedSourceIds = [...new Set([...excludedSourceIds, id])];
			return;
		}
		if (excludedSourceIds.includes(id)) {
			excludedSourceIds = excludedSourceIds.filter((value) => value !== id);
			return;
		}
		activeSourceIds = [...new Set([...activeSourceIds, id])];
	}

	function toggleUpdateState(key: string) {
		if (activeUpdateStateKeys.includes(key)) {
			activeUpdateStateKeys = activeUpdateStateKeys.filter((value) => value !== key);
			return;
		}
		activeUpdateStateKeys = [key];
	}

	function toggleGenre(genre: string) {
		if (activeGenres.includes(genre)) {
			activeGenres = activeGenres.filter((value) => value !== genre);
			excludedGenres = [...new Set([...excludedGenres, genre])];
			return;
		}
		if (excludedGenres.includes(genre)) {
			excludedGenres = excludedGenres.filter((value) => value !== genre);
			return;
		}
		activeGenres = [...new Set([...activeGenres, genre])];
	}

	function clearFilters() {
		activeReadingStatusIds = [];
		excludedReadingStatusIds = [];
		activeUpdateStateKeys = [];
		activeSourceStatusKeys = [];
		excludedSourceStatusKeys = [];
		activeGenres = [];
		excludedGenres = [];
		genreMatchMode = 'and';
	}

	function filterChipClass(state: 'off' | 'include' | 'exclude') {
		if (state === 'include') {
			return 'border-[var(--cosmic-halo)] bg-[var(--cosmic-soft)] text-[var(--text)]';
		}
		if (state === 'exclude') {
			return 'border-[var(--danger)] bg-[rgba(255,143,143,0.16)] text-[#ffb3b3] shadow-[inset_0_0_0_1px_rgba(255,143,143,0.22)]';
		}
		return 'border-[var(--void-3)] bg-[var(--void-2)] text-[var(--text-ghost)] hover:border-[var(--void-5)] hover:text-[var(--text-muted)]';
	}

	function monitorStateKey(title: LibraryTitleSummary): 'enabled' | 'disabled' {
		return title.download_profile?.enabled && !title.download_profile.paused
			? 'enabled'
			: 'disabled';
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
			<Button
				variant="ghost"
				size="sm"
				onclick={() => {
					collectionsError = null;
					collectionsPanelOpen = true;
				}}
			>
				{$_('library.collections')}
			</Button>
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
					<span
						class="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-[var(--cosmic)] shadow-[0_0_4px_var(--cosmic-glow)]"
					></span>
				{/if}
			</button>
		{/if}
	</div>

	{#if activeReadingRailLoading && activeReadingRailItems.length === 0}
		<div class="flex flex-col gap-3">
			<div class="flex items-center gap-2">
				<div class="flex min-w-0 items-center gap-1.5">
					<BookOpenIcon size={11} class="text-[var(--text-ghost)]" />
					<span class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase">
						{activeReadingRailLabel.toLowerCase()}
					</span>
				</div>
				<span class="ml-1 h-px flex-1 bg-[var(--void-3)]"></span>
				<button
					type="button"
					class="shrink-0 text-[10px] tracking-[0.22em] text-[var(--text-ghost)] uppercase transition-colors hover:text-[var(--text)]"
					aria-label={`Switch to ${inactiveReadingRailLabel}`}
					onclick={toggleReadingRailMode}
				>
					{inactiveReadingRailLabel}
				</button>
			</div>
			<div class="no-scrollbar flex gap-2 overflow-x-auto pb-1">
				{#each Array(8) as _, i (i)}
					<div
						class="aspect-[2/3] w-[calc((100%-0.5rem)/2)] shrink-0 animate-pulse bg-[var(--void-3)] sm:w-[calc((100%-1rem)/3)] md:w-[calc((100%-1.5rem)/4)] lg:w-[calc((100%-2.5rem)/6)] 2xl:w-[calc((100%-3.5rem)/8)]"
					></div>
				{/each}
			</div>
		</div>
	{:else if activeReadingRailItems.length > 0 || readingRailMode === 'updates'}
		<section class="flex flex-col gap-3" aria-label={activeReadingRailLabel}>
			<div class="flex items-center gap-2">
				<div class="flex min-w-0 items-center gap-1.5">
					<BookOpenIcon size={11} class="text-[var(--text-ghost)]" />
					<span class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase">
						{activeReadingRailLabel.toLowerCase()}
					</span>
				</div>
				<span class="ml-1 h-px flex-1 bg-[var(--void-3)]"></span>
				<button
					type="button"
					class="shrink-0 text-[10px] tracking-[0.22em] text-[var(--text-ghost)] uppercase transition-colors hover:text-[var(--text)]"
					aria-label={`Switch to ${inactiveReadingRailLabel}`}
					onclick={toggleReadingRailMode}
				>
					{inactiveReadingRailLabel}
				</button>
			</div>
			{#if activeReadingRailItems.length > 0}
				<div class="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1">
					{#each activeReadingRailItems as item (item.titleId)}
						{@const tPct = continueProgressPercent(item)}
						<a
							href={buildReaderPath({
								titleId: String(item.titleId),
								titleRouteSegment: item.routeSegment,
								chapterId: String(item.chapter.id),
								chapterName: item.chapter.name,
								chapterNumber: item.chapter.number,
								chapterRouteSegment: item.chapter.routeSegment
							})}
							class="group relative block aspect-[2/3] w-[calc((100%-0.5rem)/2)] shrink-0 snap-start overflow-hidden bg-[var(--void-3)] ring-1 ring-[var(--void-1)] transition-all duration-300 hover:shadow-[0_0_28px_-6px_var(--cosmic-glow)] hover:ring-[var(--cosmic-halo)] sm:w-[calc((100%-1rem)/3)] md:w-[calc((100%-1.5rem)/4)] lg:w-[calc((100%-2.5rem)/6)] 2xl:w-[calc((100%-3.5rem)/8)]"
							aria-label={item.title}
						>
							{#if item.coverSrc}
								<LazyImage
									src={item.coverSrc}
									alt={item.title}
									class="h-full w-full"
									imgClass="transition-transform duration-500 group-hover:scale-[1.05]"
								/>
							{:else}
								<div class="flex h-full w-full items-center justify-center bg-[var(--void-4)]">
									<ImageIcon size={28} class="text-[var(--text-ghost)]" />
								</div>
							{/if}

							<div
								class="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/95 via-black/65 to-transparent"
							></div>

							<div
								class="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 p-2.5"
							>
								<p
									class="line-clamp-2 text-[13px] leading-tight font-medium text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]"
								>
									{item.title}
								</p>

								<div class="relative h-[3px] w-full overflow-hidden bg-white/15">
									<div
										class="h-full bg-[var(--cosmic)] shadow-[0_0_8px_var(--cosmic-glow)]"
										style:width="{tPct}%"
									></div>
								</div>
							</div>

							<div
								class="pointer-events-none absolute top-0 left-0 h-3 w-3 border-t border-l border-[var(--cosmic)] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
							></div>
							<div
								class="pointer-events-none absolute right-0 bottom-0 h-3 w-3 border-r border-b border-[var(--cosmic)] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
							></div>
						</a>
					{/each}
				</div>
			{:else}
				<div
					class="border border-[var(--line)] bg-[var(--void-3)] px-3 py-4 text-sm text-[var(--text-ghost)]"
				>
					{$_('library.noRecentUpdates')}
				</div>
			{/if}
		</section>
	{/if}

	<SearchInput
		bind:value={searchQuery}
		placeholder={$_('library.searchPlaceholder')}
		inputSize="sm"
	/>

	{#if combinedCollections.length > 0}
		<div class="no-scrollbar flex items-center gap-1 overflow-x-auto pb-0.5">
			<button
				type="button"
				class="shrink-0 px-2.5 py-1 text-xs transition-colors {selectedCollectionId === null &&
				selectedDynamicCollectionId === null
					? 'border border-[var(--line)] bg-[var(--void-3)] text-[var(--text)]'
					: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
				onclick={() => {
					selectedCollectionId = null;
					selectedDynamicCollectionId = null;
				}}
			>
				{$_('common.all')} · {listedTitlesCount}
			</button>
			{#each combinedCollections.filter((collection) => collection.titlesCount > 0) as collection (`${collection.kind}:${collection.id}`)}
				<button
					type="button"
					class="shrink-0 px-2.5 py-1 text-xs transition-colors {(
						collection.kind === 'manual'
							? selectedCollectionId === collection.id
							: selectedDynamicCollectionId === collection.id
					)
						? 'border border-[var(--line)] bg-[var(--void-3)] text-[var(--text)]'
						: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
					onclick={() =>
						collection.kind === 'manual'
							? selectManualCollection(collection.id)
							: selectDynamicCollection(collection)}
				>
					{collection.name} · {collection.titlesCount}
				</button>
			{/each}
		</div>
	{/if}

	{#if error}
		<Alert variant="error">{error}</Alert>
	{/if}

	{#if loading}
		<div
			class="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 2xl:grid-cols-8"
		>
			{#each Array(18) as _, i (i)}
				<div class="flex flex-col overflow-hidden border border-[var(--line)] bg-[var(--void-2)]">
					<div
						class="aspect-[2/3] animate-pulse bg-[var(--void-5)]"
						style="animation-delay: {i * 40}ms"
					></div>
					<div class="flex flex-col gap-1.5 p-2">
						<div
							class="h-2 w-full animate-pulse bg-[var(--void-4)]"
							style="animation-delay: {i * 40}ms"
						></div>
						<div
							class="h-2 w-3/5 animate-pulse bg-[var(--void-3)]"
							style="animation-delay: {i * 40 + 20}ms"
						></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if isEmpty}
		<EmptyState
			icon={BookIcon}
			title={$_('library.empty')}
			description={$_('library.emptyDescription')}
		>
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
		</EmptyState>
	{:else}
		<div
			class="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 2xl:grid-cols-8"
		>
			{#each visibleFilteredTitles as title (title.id)}
				{@const displayStatus = getDisplayStatus(title)}
				<a
					href={buildTitlePath(title.id, title.title, title.route_segment ?? null)}
					class="group flex flex-col gap-2"
				>
					<div
						class="relative aspect-[2/3] overflow-hidden bg-[var(--void-3)] ring-1 ring-[var(--void-1)] transition-all duration-200 group-hover:shadow-[0_8px_28px_-8px_rgba(0,0,0,0.6)] group-hover:ring-[var(--void-6)]"
					>
						{#if title.thumbnail_url}
							<LazyImage
								src={title.thumbnail_url}
								alt={title.title}
								class="h-full w-full"
								imgClass="transition-transform duration-300 group-hover:scale-[1.03]"
							/>
						{:else}
							<div class="flex h-full w-full items-center justify-center bg-[var(--void-5)]">
								<ImageIcon size={20} class="text-[var(--text-ghost)]" />
							</div>
						{/if}

						{#if title.user_rating != null}
							<div
								class="absolute top-1 right-1 flex items-center gap-1 bg-[var(--void-0)]/80 px-1.5 py-0.5 text-[11px] leading-none text-[var(--text)] backdrop-blur-sm"
							>
								<span class="text-sm leading-none text-[var(--warning)]">★</span>
								<span class="tabular-nums">{Math.round(title.user_rating)}</span>
							</div>
						{/if}
					</div>

					<div class="flex flex-col gap-0.5 px-0.5">
						<p
							class="line-clamp-2 min-h-[2lh] text-xs leading-snug text-[var(--text-muted)] transition-colors group-hover:text-[var(--text)]"
						>
							{title.title}
						</p>
						{#if displayStatus}
							<p class="truncate text-[10px] text-[var(--text-ghost)]">{displayStatus}</p>
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
	open={collectionsPanelOpen}
	title={$_('library.collections')}
	onclose={closeCollectionsPanel}
>
	<div class="flex flex-col gap-4 pt-1">
		{#if collectionsError}
			<Alert variant="error">{collectionsError}</Alert>
		{/if}

		<div class="flex flex-col">
			<button
				type="button"
				class="flex items-center justify-between gap-3 py-3 text-left transition-colors hover:text-[var(--text)]"
				onclick={() => void setLibraryDefaultCollection(null)}
			>
				<div class="min-w-0">
					<div class="flex items-center gap-2">
						<p class="text-sm text-[var(--text)]">{$_('library.allTitles')}</p>
						{#if defaultManualCollection === null}
							<span
								class="shrink-0 text-[10px] tracking-[0.18em] text-[var(--text-ghost)] uppercase"
							>
								default
							</span>
						{/if}
					</div>
					<p class="mt-0.5 text-xs text-[var(--text-ghost)] tabular-nums">{listedTitlesCount}</p>
				</div>
			</button>

			{#if dynamicCollectionsQuery.isLoading || collectionsQuery.isLoading}
				<p class="py-3 text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
			{:else if combinedCollections.length === 0}
				<p class="py-3 text-sm text-[var(--text-ghost)]">{$_('library.noCollections')}</p>
			{:else}
				<div class="mt-2 border-t border-[var(--void-3)]/30 pt-2">
					<div class="flex flex-col gap-1">
						{#each manualCollections as collection (collection.id)}
							<div class="flex items-center gap-2 py-2.5">
								<button
									type="button"
									class="flex min-w-0 flex-1 items-center justify-between gap-3 text-left transition-colors hover:text-[var(--text)] {collection.isDefault
										? 'text-[var(--text)]'
										: ''}"
									onclick={() => void setLibraryDefaultCollection(collection.id)}
								>
									<div class="min-w-0">
										<p class="truncate text-sm text-[var(--text)]">{collection.name}</p>
										<p class="mt-0.5 text-xs text-[var(--text-ghost)] tabular-nums">
											{collection.titlesCount}
										</p>
									</div>
									{#if collection.isDefault}
										<span
											class="shrink-0 text-[10px] tracking-[0.18em] text-[var(--text-ghost)] uppercase"
										>
											default
										</span>
									{/if}
								</button>
								<button
									type="button"
									class="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:bg-[var(--void-2)] hover:text-[var(--text)]"
									onclick={() => void toggleManualCollectionNotifications(collection)}
									aria-label={collection.notifyOnNewChapters
										? 'Disable notifications for collection'
										: 'Enable notifications for collection'}
									title={collection.notifyOnNewChapters
										? 'Disable notifications'
										: 'Enable notifications'}
								>
									<BellIcon
										size={14}
										weight={collection.notifyOnNewChapters ? 'fill' : 'regular'}
									/>
								</button>
								<button
									type="button"
									class="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text)]"
									onclick={() => openRenameCollectionDialog(collection)}
									aria-label={$_('common.edit')}
								>
									<PencilSimpleIcon size={14} />
								</button>
								<button
									type="button"
									class="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--error)]"
									onclick={() =>
										(pendingDelete = {
											kind: collection.kind,
											id: collection.id,
											name: collection.name
										})}
									aria-label={$_('common.delete')}
								>
									<TrashIcon size={14} />
								</button>
							</div>
						{/each}
					</div>
				</div>

				{#if dynamicCollectionsList.length > 0}
					<div class="mt-3 border-t border-[var(--void-3)]/30 pt-3">
						<p class="mb-1 text-[11px] tracking-[0.18em] text-[var(--text-ghost)] uppercase">
							Dynamic collections
						</p>
						<div class="flex flex-col gap-1">
							{#each dynamicCollectionsList as collection (collection.id)}
								<div class="flex items-center gap-2 py-2.5">
									<button
										type="button"
										class="flex min-w-0 flex-1 items-center justify-between gap-3 text-left transition-colors hover:text-[var(--text)]"
										onclick={() => {
											selectDynamicCollection(collection);
											closeCollectionsPanel();
										}}
									>
										<div class="min-w-0">
											<p class="truncate text-sm text-[var(--text)]">{collection.name}</p>
											<p class="mt-0.5 truncate text-xs text-[var(--text-ghost)]">
												{collection.titlesCount} · {dynamicCollectionSummary(collection.filters)}
											</p>
										</div>
									</button>
									<button
										type="button"
										class="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text)]"
										onclick={() => openRenameCollectionDialog(collection)}
										aria-label={$_('common.edit')}
									>
										<PencilSimpleIcon size={14} />
									</button>
									<button
										type="button"
										class="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--error)]"
										onclick={() =>
											(pendingDelete = {
												kind: collection.kind,
												id: collection.id,
												name: collection.name
											})}
										aria-label={$_('common.delete')}
									>
										<TrashIcon size={14} />
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{/if}
		</div>

		<div class="border-t border-[var(--void-3)]/30 pt-3">
			<Button variant="ghost" size="sm" onclick={openCreateCollectionDialog} class="w-full">
				<PlusIcon size={12} />
				{$_('library.createCollection')}
			</Button>
		</div>
	</div>
</SlidePanel>

<Dialog.Root
	bind:open={collectionDialogOpen}
	onOpenChange={(open) => !open && closeCollectionDialog()}
>
	<Dialog.Portal>
		<Dialog.Overlay
			class="animate-fade-in fixed inset-0 z-[70] bg-[var(--void-0)]/85 backdrop-blur-sm"
		/>
		<Dialog.Content
			class="animate-scale-in fixed top-1/2 left-1/2 z-[70] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 border border-[var(--line)] bg-[var(--void-1)] shadow-[0_20px_60px_-24px_rgba(0,0,0,0.75)] focus:outline-none"
		>
			<div class="border-b border-[var(--line)] px-4 py-4">
				<Dialog.Title class="text-sm text-[var(--text)]">
					{collectionDialogMode === 'create'
						? collectionDialogKind === 'dynamic'
							? $_('library.saveAsDynamicCollection')
							: $_('library.createCollection')
						: $_('library.renameCollection')}
				</Dialog.Title>
			</div>
			<div class="flex flex-col gap-3 px-4 py-4">
				{#if collectionDialogKind === 'dynamic' && collectionDialogDraftFilters}
					<p class="rounded-sm bg-[var(--void-2)] px-3 py-2 text-xs text-[var(--text-ghost)]">
						{dynamicCollectionSummary(collectionDialogDraftFilters)}
					</p>
				{/if}
				<Input
					label={$_('library.collectionNameLabel')}
					bind:value={collectionDialogName}
					placeholder={$_('library.collectionNamePlaceholder')}
				/>
				{#if collectionDialogError}
					<Alert variant="error">{collectionDialogError}</Alert>
				{/if}
			</div>
			<div class="flex items-center justify-end gap-2 border-t border-[var(--line)] px-4 py-3">
				<Button
					variant="ghost"
					size="sm"
					onclick={closeCollectionDialog}
					disabled={collectionDialogSaving}
				>
					{$_('common.cancel')}
				</Button>
				<Button
					size="sm"
					onclick={() => void submitCollectionDialog()}
					loading={collectionDialogSaving}
					disabled={!collectionDialogName.trim() || collectionDialogSaving}
				>
					{collectionDialogMode === 'create' ? $_('common.add') : $_('common.save')}
				</Button>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<ConfirmDialog
	open={pendingDelete !== null}
	title={$_('library.deleteCollectionTitle')}
	description={pendingDelete
		? $_('library.deleteCollectionDescription', { values: { name: pendingDelete.name } })
		: ''}
	confirmLabel={$_('common.delete')}
	cancelLabel={$_('common.cancel')}
	variant="danger"
	loading={deletingCollectionId !== null}
	onConfirm={() => void confirmDeleteCollection()}
	onCancel={() => {
		if (!deletingCollectionId) pendingDelete = null;
	}}
/>

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
								onclick={() =>
									goto(buildTitlePath(String(title._id), title.title, title.routeSegment ?? null))}
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
	{#snippet footer()}
		<div class="flex flex-col gap-2">
			{#if selectedDynamicCollection && selectedDynamicCollectionDirty}
				<Button variant="outline" onclick={() => void updateSelectedDynamicCollectionFilters()}>
					{$_('library.updateDynamicCollection')}
				</Button>
			{/if}
			{#if hasActiveFilters}
				<Button variant="outline" onclick={openCreateDynamicCollectionDialog}>
					{$_('library.saveAsDynamicCollection')}
				</Button>
			{/if}
			<div class="flex items-center gap-2">
				<Button variant="ghost" class="flex-1" onclick={() => (filterPanelOpen = false)}>
					{$_('common.close')}
				</Button>
				<Button
					variant="outline"
					class="flex-1"
					onclick={clearFilters}
					disabled={!hasActiveControls}
				>
					{$_('library.clearFilters')}
				</Button>
			</div>
		</div>
	{/snippet}

	<PanelSection label={$_('library.sort')}>
		{#snippet actions()}
			<button
				type="button"
				class="flex items-center gap-1.5 border border-[var(--void-4)] bg-[var(--void-2)] px-2 py-0.5 font-mono text-[10px] tracking-[0.16em] text-[var(--text-ghost)] uppercase transition-colors hover:border-[var(--cosmic-halo)] hover:text-[var(--text)]"
				onclick={() => (sortDesc = !sortDesc)}
			>
				{#if sortDesc}<CaretDownIcon size={10} />{:else}<CaretUpIcon size={10} />{/if}
				<span>{sortDesc ? $_('library.desc') : $_('library.asc')}</span>
			</button>
		{/snippet}
		<div class="flex flex-wrap gap-1.5">
			{#each SORT_MODES as mode (mode.value)}
				<button
					type="button"
					class="border px-2.5 py-1 text-xs transition-colors {sortMode === mode.value
						? 'border-[var(--cosmic-halo)] bg-[var(--cosmic-soft)] text-[var(--text)]'
						: 'border-[var(--void-3)] bg-[var(--void-2)] text-[var(--text-ghost)] hover:border-[var(--void-5)] hover:text-[var(--text-muted)]'}"
					onclick={() => (sortMode = mode.value)}
				>
					{sortModeLabel(mode.labelKey)}
				</button>
			{/each}
		</div>
	</PanelSection>

	{#if allUserStatuses.length > 0}
		<PanelSection label={$_('library.readingStatus')}>
			<div class="flex flex-wrap gap-1.5">
				{#each allUserStatuses as status (status.id)}
					{@const state = activeReadingStatusIds.includes(status.id)
						? 'include'
						: excludedReadingStatusIds.includes(status.id)
							? 'exclude'
							: 'off'}
					<button
						type="button"
						class="border px-2.5 py-1 text-xs transition-colors {filterChipClass(state)}"
						onclick={() => toggleReadingStatus(status.id)}
					>
						{status.label}
					</button>
				{/each}
			</div>
		</PanelSection>
	{/if}

	{#if presentSourceStatusKeys.length > 0}
		<PanelSection label={$_('library.sourceStatus')}>
			<div class="flex flex-wrap gap-1.5">
				{#each SOURCE_STATUS_FILTERS.filter( (filter) => presentSourceStatusKeys.includes(filter.key) ) as sourceFilter (sourceFilter.key)}
					{@const state = activeSourceStatusKeys.includes(sourceFilter.key)
						? 'include'
						: excludedSourceStatusKeys.includes(sourceFilter.key)
							? 'exclude'
							: 'off'}
					<button
						type="button"
						class="border px-2.5 py-1 text-xs transition-colors {filterChipClass(state)}"
						onclick={() => toggleSourceStatus(sourceFilter.key)}
					>
						{sourceStatusLabel(sourceFilter.labelKey)}
					</button>
				{/each}
			</div>
		</PanelSection>
	{/if}

	{#if availableCurrentSources.length > 0}
		<PanelSection label={$_('settings.sources')}>
			<div class="flex flex-wrap gap-1.5">
				{#each availableCurrentSources as source (source.id)}
					{@const state = activeSourceIds.includes(source.id)
						? 'include'
						: excludedSourceIds.includes(source.id)
							? 'exclude'
							: 'off'}
					<button
						type="button"
						class="border px-2.5 py-1 text-xs transition-colors {filterChipClass(state)}"
						onclick={() => toggleCurrentSource(source.id)}
					>
						{source.label}
					</button>
				{/each}
			</div>
		</PanelSection>
	{/if}

	<PanelSection label={$_('downloads.monitor')}>
		<div class="flex flex-wrap gap-1.5">
			{#each UPDATE_STATE_FILTERS as updateFilter (updateFilter.key)}
				{@const state = activeUpdateStateKeys.includes(updateFilter.key) ? 'include' : 'off'}
				<button
					type="button"
					class="border px-2.5 py-1 text-xs transition-colors {filterChipClass(state)}"
					onclick={() => toggleUpdateState(updateFilter.key)}
				>
					{updateFilter.label()}
				</button>
			{/each}
		</div>
	</PanelSection>

	{#if allGenres.length > 0}
		<PanelSection label={$_('library.genres')} divider={false}>
			{#snippet actions()}
				<div class="flex items-center gap-1">
					{#each ['and', 'or'] as mode (mode)}
						<button
							type="button"
							class="border px-2 py-0.5 text-[10px] tracking-[0.16em] uppercase transition-colors {genreMatchMode ===
							mode
								? 'border-[var(--cosmic-halo)] bg-[var(--cosmic-soft)] text-[var(--text)]'
								: 'border-[var(--void-3)] bg-[var(--void-2)] text-[var(--text-ghost)] hover:border-[var(--void-5)] hover:text-[var(--text-muted)]'}"
							onclick={() => (genreMatchMode = mode as 'and' | 'or')}
						>
							{$_(`library.genreMode.${mode}`)}
						</button>
					{/each}
				</div>
			{/snippet}
			{#if allGenres.length > 12}
				<SearchInput
					bind:value={genreSearch}
					inputSize="sm"
					placeholder={$_('library.searchGenres')}
				/>
			{/if}
			<div class="flex flex-wrap gap-1.5">
				{#each filteredGenreOptions as genre (genre)}
					{@const state = activeGenres.includes(genre)
						? 'include'
						: excludedGenres.includes(genre)
							? 'exclude'
							: 'off'}
					<button
						type="button"
						class="border px-2.5 py-1 text-xs transition-colors {filterChipClass(state)}"
						onclick={() => toggleGenre(genre)}
					>
						{genre}
					</button>
				{:else}
					<span class="font-mono text-[10px] tracking-[0.16em] text-[var(--text-ghost)] uppercase">
						{$_('common.empty')}
					</span>
				{/each}
			</div>
		</PanelSection>
	{/if}
</SlidePanel>
