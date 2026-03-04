<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import {
		getPopularFeed,
		getLatestFeed,
		getCategoryFeed,
		searchFeed,
		getSearchFilters,
		listCategories,
		listSources,
		type ExploreCategory,
		type ExploreFeed,
		type ExploreSearchFilters,
		type SourceSummary
	} from '$lib/api/explore';
	import { getCachedCoverUrl } from '$lib/api/covers';
	import { importLibraryTitle, listLibraryTitles } from '$lib/api/library';
	import { Button } from '$lib/elements/button';
	import { Input } from '$lib/elements/input';
	import { Icon } from '$lib/elements/icon';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { previewItemStore } from '$lib/stores/explore';
	import { panelOverlayOpen } from '$lib/stores/ui';
	import { _ } from '$lib/i18n';
	import { buildTitlePath } from '$lib/utils/routes';

	type TabValue = 'popular' | 'latest' | 'search';
	type ExtensionFilter = {
		pkg: string;
		name: string;
		sourceCount: number;
	};

	const tabs: TabValue[] = ['popular', 'latest', 'search'];
	const FEED_LIMIT = 24;
	const EXTENSION_FILTER_PARAM = 'extension_pkg';
	const CATEGORY_FILTER_PARAM = 'category';
	const SOURCE_FILTER_PARAM = 'source_id';
	const EXPLORE_STATE_STORAGE_PREFIX = 'mangarr:explore:state:';
	const EXPLORE_STATE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

	type ExploreStoredState = {
		savedAt: number;
		feed: ExploreFeed | null;
		searchQuery: string;
		appliedSearchFiltersBySource: Record<string, Record<string, unknown>>;
		scrollY: number;
		hasScrollIntent: boolean;
	};

	const UUID_SEGMENT_RE =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	const LONG_HEX_SEGMENT_RE = /^[0-9a-f]{12,}$/i;
	const NUMERIC_SEGMENT_RE = /^\d{4,}$/;
	const STABLE_PATH_PREFIXES = new Set([
		'title',
		'titles',
		'manga',
		'comic',
		'series',
		'book',
		'work',
		'detail',
		'details'
	]);

	function normalizeExtensionPkgs(values: string[]): string[] {
		return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
	}

	function getSelectedExtensionPkgs(url: URL): string[] {
		return normalizeExtensionPkgs(url.searchParams.getAll(EXTENSION_FILTER_PARAM));
	}

	function getExtensionFilters(sourceList: SourceSummary[]): ExtensionFilter[] {
		const grouped = new SvelteMap<string, ExtensionFilter>();

		for (const source of sourceList) {
			const existing = grouped.get(source.extension_pkg);
			if (existing) {
				existing.sourceCount += 1;
			} else {
				grouped.set(source.extension_pkg, {
					pkg: source.extension_pkg,
					name: source.extension_name,
					sourceCount: 1
				});
			}
		}

		return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	function normalizeSignatureToken(value: string | null | undefined): string {
		return (value ?? '').trim().toLowerCase();
	}

	function safeDecodeUriPart(value: string): string {
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}

	function isStableIdSegment(value: string): boolean {
		const segment = normalizeSignatureToken(value);
		return (
			UUID_SEGMENT_RE.test(segment) ||
			LONG_HEX_SEGMENT_RE.test(segment) ||
			NUMERIC_SEGMENT_RE.test(segment)
		);
	}

	function titleUrlSignature(titleUrl: string | null | undefined): string {
		let raw = (titleUrl ?? '').trim();
		if (!raw) return '';

		try {
			const parsed = new URL(raw);
			raw = `${parsed.pathname}${parsed.search}`;
		} catch {
			raw = raw.replace(/^https?:\/\//i, '/');
		}

		const withoutHash = raw.split('#', 1)[0] ?? raw;
		const pathOnly = withoutHash.split('?', 1)[0] ?? withoutHash;
		const normalizedPath = pathOnly.replace(/\\/g, '/').replace(/^\/+/, '');
		const segments = normalizedPath
			.split('/')
			.map((part) => normalizeSignatureToken(safeDecodeUriPart(part)))
			.filter((part) => part.length > 0);

		if (!segments.length) return normalizeSignatureToken(raw);

		for (let i = 0; i < segments.length - 1; i += 1) {
			const prefix = segments[i];
			if (!STABLE_PATH_PREFIXES.has(prefix)) continue;
			const candidate = segments[i + 1];
			if (!candidate) continue;
			if (isStableIdSegment(candidate) || candidate.length >= 8) {
				return `${prefix}/${candidate}`;
			}
		}

		const idSegment = segments.find((segment) => isStableIdSegment(segment));
		if (idSegment) return `id:${idSegment}`;

		return segments.join('/');
	}

	function linkMergeKey(link: ExploreFeed['items'][number]['links'][number]): string {
		const extensionPkg = normalizeSignatureToken(link.source.extension_pkg);
		const sourceId = normalizeSignatureToken(link.source.id);
		const urlSig = titleUrlSignature(link.title_url);
		if (extensionPkg && urlSig) {
			return `ext:${extensionPkg}|${urlSig}`;
		}
		if (sourceId && urlSig) {
			return `src:${sourceId}|${urlSig}`;
		}
		return `raw:${sourceId}|${normalizeSignatureToken(link.title_url)}`;
	}

	function itemMergeSignatures(item: ExploreFeed['items'][number]): string[] {
		const signatures = new SvelteSet<string>();
		for (const link of item.links) {
			const extensionPkg = normalizeSignatureToken(link.source.extension_pkg);
			const sourceId = normalizeSignatureToken(link.source.id);
			const urlSig = titleUrlSignature(link.title_url);
			if (urlSig) {
				if (extensionPkg) signatures.add(`ext:${extensionPkg}|${urlSig}`);
				if (sourceId) signatures.add(`src:${sourceId}|${urlSig}`);
			}
		}

		const dedupeSig = normalizeSignatureToken(item.dedupe_key);
		if (dedupeSig) signatures.add(`dedupe:${dedupeSig}`);

		const titleSig = normalizeSignatureToken(item.title);
		const thumbSig = titleUrlSignature(item.thumbnail_url);
		if (titleSig && thumbSig) signatures.add(`title-thumb:${titleSig}|${thumbSig}`);

		return [...signatures];
	}

	function mergeItemLinks(
		existing: ExploreFeed['items'][number]['links'],
		incoming: ExploreFeed['items'][number]['links']
	): ExploreFeed['items'][number]['links'] {
		const merged = [...existing];
		const seen = new SvelteSet(existing.map((link) => linkMergeKey(link)));
		for (const link of incoming) {
			const key = linkMergeKey(link);
			if (seen.has(key)) continue;
			seen.add(key);
			merged.push(link);
		}
		return merged;
	}

	function mergeExploreItem(
		existing: ExploreFeed['items'][number],
		incoming: ExploreFeed['items'][number]
	): ExploreFeed['items'][number] {
		return {
			...existing,
			title: existing.title || incoming.title,
			thumbnail_url: existing.thumbnail_url || incoming.thumbnail_url,
			artist: existing.artist ?? incoming.artist,
			author: existing.author ?? incoming.author,
			description: existing.description ?? incoming.description,
			genre: existing.genre ?? incoming.genre,
			status: existing.status || incoming.status,
			links: mergeItemLinks(existing.links, incoming.links),
			imported_library_id: existing.imported_library_id ?? incoming.imported_library_id ?? null
		};
	}

	function dedupeFeedItems(items: ExploreFeed['items']): ExploreFeed['items'] {
		const merged: ExploreFeed['items'] = [];
		const signatureToIndex = new SvelteMap<string, number>();
		for (const item of items) {
			const signatures = itemMergeSignatures(item);
			let existingIndex: number | undefined;
			for (const signature of signatures) {
				const idx = signatureToIndex.get(signature);
				if (idx === undefined) continue;
				existingIndex = idx;
				break;
			}

			if (existingIndex === undefined) {
				const nextIndex = merged.length;
				merged.push(item);
				for (const signature of signatures) {
					signatureToIndex.set(signature, nextIndex);
				}
				continue;
			}

			const mergedItem = mergeExploreItem(merged[existingIndex], item);
			merged[existingIndex] = mergedItem;
			for (const signature of itemMergeSignatures(mergedItem)) {
				signatureToIndex.set(signature, existingIndex);
			}
		}
		return merged;
	}

	let sources = $state<SourceSummary[]>([]);
	let categories = $state<ExploreCategory[]>([]);
	let feed = $state<ExploreFeed | null>(null);
	let loading = $state(true);
	let loadingMore = $state(false);
	let infiniteSentinelVisible = $state(false);
	let hasScrollIntent = $state(false);
	let error = $state<string | null>(null);
	let searchQuery = $state('');
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	let searchFiltersOpen = $state(false);
	$effect(() => {
		panelOverlayOpen.set(searchFiltersOpen);
		return () => panelOverlayOpen.set(false);
	});
	let searchFiltersLoading = $state(false);
	let searchFiltersData = $state<ExploreSearchFilters | null>(null);
	let searchFiltersError = $state<string | null>(null);
	let pendingSearchFilterChanges = $state<Map<string, unknown>>(new Map());
	let appliedSearchFiltersBySource = $state<Map<string, Record<string, unknown>>>(new Map());
	let openingTitleKey = $state<string | null>(null);
	let assignedLibraryTitleIds = $state<Set<number>>(new Set());
	let skipInitialFeedLoad = $state(false);
	let skipInitialSearchLoad = $state(false);
	let pendingRestoreScrollY = $state<number | null>(null);

	const activeTab = $derived.by<TabValue>(() => {
		const tab = page.url.searchParams.get('tab');
		if (tab === 'latest' || tab === 'search' || tab === 'popular') {
			return tab;
		}
		return 'popular';
	});
	const isSearchTab = $derived(activeTab === 'search');
	const selectedExtensionPkgs = $derived(getSelectedExtensionPkgs(page.url));
	const extensionFilters = $derived(getExtensionFilters(sources));
	const selectedExtensionKey = $derived(selectedExtensionPkgs.join('|'));
	const hasExtensionFiltersSelected = $derived(selectedExtensionPkgs.length > 0);
	const selectedSourceId = $derived(page.url.searchParams.get(SOURCE_FILTER_PARAM)?.trim() || '');
	const selectedSource = $derived(sources.find((source) => source.id === selectedSourceId) ?? null);
	const hasSourceFilterSelected = $derived(Boolean(selectedSourceId));
	const selectedSourceAppliedFilters = $derived(
		selectedSourceId ? (appliedSearchFiltersBySource.get(selectedSourceId) ?? {}) : {}
	);
	const appliedSearchFilterCount = $derived(Object.keys(selectedSourceAppliedFilters).length);
	const hasAppliedSearchFilters = $derived(appliedSearchFilterCount > 0);
	const selectedSourceFiltersKey = $derived(JSON.stringify(selectedSourceAppliedFilters));
	const selectedCategory = $derived(page.url.searchParams.get(CATEGORY_FILTER_PARAM)?.trim() || '');
	const hasCategoryFilterSelected = $derived(Boolean(selectedCategory));
	const searchFilterKey = $derived(`${selectedSourceId}::${selectedSourceFiltersKey}`);

	const trimmedQuery = $derived(searchQuery.trim());
	const hasSearchQuery = $derived(trimmedQuery.length > 0);
	const isSearching = $derived(isSearchTab && hasSearchQuery);
	const showSearchPrompt = $derived(isSearchTab && !hasSearchQuery);
	const canInfiniteScroll = $derived(
		!isSearchTab && !hasCategoryFilterSelected && (activeTab === 'latest' || activeTab === 'popular')
	);

	let activeFeedRequestId = 0;
	const LIBRARY_STATUS_BATCH_SIZE = 100;

	function exploreStateKey(url: URL): string {
		return `${EXPLORE_STATE_STORAGE_PREFIX}${url.pathname}?${url.searchParams.toString()}`;
	}

	function persistExploreState(): void {
		if (typeof window === 'undefined') return;
		try {
			const appliedFilters = Object.fromEntries(appliedSearchFiltersBySource.entries());
			const payload: ExploreStoredState = {
				savedAt: Date.now(),
				feed,
				searchQuery,
				appliedSearchFiltersBySource: appliedFilters,
				scrollY: window.scrollY,
				hasScrollIntent
			};
			window.sessionStorage.setItem(exploreStateKey(page.url), JSON.stringify(payload));
		} catch {
			// best-effort state cache
		}
	}

	function restoreExploreState(): void {
		if (typeof window === 'undefined') return;
		try {
			const raw = window.sessionStorage.getItem(exploreStateKey(page.url));
			if (!raw) return;
			const parsed = JSON.parse(raw) as ExploreStoredState;
			if (!parsed || typeof parsed !== 'object') return;
			if (!Number.isFinite(parsed.savedAt)) return;
			if (Date.now() - parsed.savedAt > EXPLORE_STATE_MAX_AGE_MS) return;

			searchQuery = typeof parsed.searchQuery === 'string' ? parsed.searchQuery : '';
			appliedSearchFiltersBySource = new SvelteMap(
				Object.entries(parsed.appliedSearchFiltersBySource ?? {})
			);
			hasScrollIntent = Boolean(parsed.hasScrollIntent);

			if (parsed.feed) {
				feed = {
					...parsed.feed,
					items: dedupeFeedItems(parsed.feed.items)
				};
				loading = false;
				error = null;
				const restoredSearching = (parsed.searchQuery ?? '').trim().length > 0;
				skipInitialFeedLoad = !restoredSearching;
				skipInitialSearchLoad = restoredSearching;
			}

			if (Number.isFinite(parsed.scrollY)) {
				pendingRestoreScrollY = Math.max(0, Number(parsed.scrollY));
			}
		} catch {
			// ignore malformed cache
		}
	}

	async function loadAssignedLibraryTitleIds() {
		const nextIds = new SvelteSet<number>();
		let offset = 0;

		try {
			for (;;) {
				const page = await listLibraryTitles({
					offset,
					limit: LIBRARY_STATUS_BATCH_SIZE,
					assigned_only: true
				});
				for (const title of page) {
					nextIds.add(title.id);
				}
				if (page.length < LIBRARY_STATUS_BATCH_SIZE) {
					break;
				}
				offset += page.length;
			}
			assignedLibraryTitleIds = nextIds;
		} catch {
			// Keep existing set on transient errors; badge is best-effort.
		}
	}

	function setTab(tab: TabValue) {
		const url = new URL(page.url.href);
		url.searchParams.set('tab', tab);
		goto(url.toString(), { replaceState: true, noScroll: true });
	}

	function tabLabel(tab: TabValue): string {
		if (tab === 'latest') return $_('explore.latestUpdates');
		if (tab === 'search') return $_('common.search');
		return $_('explore.popular');
	}

	function setExtensionFilters(nextPkgs: string[]) {
		const normalizedNext = normalizeExtensionPkgs(nextPkgs);
		const normalizedCurrent = normalizeExtensionPkgs(selectedExtensionPkgs);
		if (
			normalizedNext.length === normalizedCurrent.length &&
			normalizedNext.every((pkg, index) => pkg === normalizedCurrent[index])
		) {
			return;
		}

		const url = new URL(page.url.href);
		url.searchParams.delete(EXTENSION_FILTER_PARAM);
		for (const pkg of normalizedNext) {
			url.searchParams.append(EXTENSION_FILTER_PARAM, pkg);
		}
		goto(url.toString(), { replaceState: true, noScroll: true });
	}

	function toggleExtensionFilter(pkg: string) {
		if (selectedExtensionPkgs.includes(pkg)) {
			setExtensionFilters(selectedExtensionPkgs.filter((item) => item !== pkg));
			return;
		}
		setExtensionFilters([...selectedExtensionPkgs, pkg]);
	}

	function clearExtensionFilters() {
		setExtensionFilters([]);
	}

	function setSourceFilter(sourceId: string | null) {
		const nextSourceId = sourceId?.trim() ?? '';
		if (nextSourceId === selectedSourceId) {
			return;
		}

		const url = new URL(page.url.href);
		if (nextSourceId) {
			url.searchParams.set(SOURCE_FILTER_PARAM, nextSourceId);
		} else {
			url.searchParams.delete(SOURCE_FILTER_PARAM);
		}
		goto(url.toString(), { replaceState: true, noScroll: true });
	}

	function clearSourceFilter() {
		setSourceFilter(null);
	}

	function setCategoryFilter(categoryName: string | null) {
		const nextCategory = categoryName?.trim() ?? '';
		if (nextCategory === selectedCategory) {
			return;
		}

		const url = new URL(page.url.href);
		if (nextCategory) {
			url.searchParams.set(CATEGORY_FILTER_PARAM, nextCategory);
		} else {
			url.searchParams.delete(CATEGORY_FILTER_PARAM);
		}
		goto(url.toString(), { replaceState: true, noScroll: true });
	}

	function clearCategoryFilter() {
		setCategoryFilter(null);
	}

	function selectedExtensionQuery(): string[] | undefined {
		if (activeTab === 'search') {
			return undefined;
		}
		return selectedExtensionPkgs.length > 0 ? selectedExtensionPkgs : undefined;
	}

	async function openSearchFilters(sourceId: string) {
		searchFiltersOpen = true;
		searchFiltersLoading = true;
		searchFiltersError = null;
		searchFiltersData = null;
		pendingSearchFilterChanges = new SvelteMap();

		try {
			searchFiltersData = await getSearchFilters({ source_id: sourceId });
			const applied = appliedSearchFiltersBySource.get(sourceId);
			if (applied) {
				pendingSearchFilterChanges = new SvelteMap(Object.entries(applied));
			}
		} catch (e) {
			searchFiltersError = e instanceof Error ? e.message : 'Failed to load search filters';
		} finally {
			searchFiltersLoading = false;
		}
	}

	function closeSearchFilters() {
		searchFiltersOpen = false;
		searchFiltersData = null;
		searchFiltersError = null;
		pendingSearchFilterChanges = new SvelteMap();
	}

	function handleSearchFilterChange(key: string, value: unknown) {
		pendingSearchFilterChanges.set(key, value);
		pendingSearchFilterChanges = new SvelteMap(pendingSearchFilterChanges);
	}

	function clearAppliedSearchFilters() {
		if (!selectedSourceId) return;
		appliedSearchFiltersBySource.delete(selectedSourceId);
		appliedSearchFiltersBySource = new SvelteMap(appliedSearchFiltersBySource);
	}

	function getCurrentSearchFilterValue(
		filter: NonNullable<typeof searchFiltersData>['preferences'][number]
	) {
		if (pendingSearchFilterChanges.has(filter.key)) {
			return pendingSearchFilterChanges.get(filter.key);
		}
		if (selectedSourceId) {
			const applied = appliedSearchFiltersBySource.get(selectedSourceId);
			if (applied && filter.key in applied) {
				return applied[filter.key];
			}
		}
		return filter.current_value ?? filter.default_value;
	}

	async function applySearchFilters() {
		if (!selectedSourceId) {
			closeSearchFilters();
			return;
		}

		if (pendingSearchFilterChanges.size === 0) {
			appliedSearchFiltersBySource.delete(selectedSourceId);
		} else {
			appliedSearchFiltersBySource.set(
				selectedSourceId,
				Object.fromEntries(pendingSearchFilterChanges.entries())
			);
		}
		appliedSearchFiltersBySource = new SvelteMap(appliedSearchFiltersBySource);
		closeSearchFilters();

		if (isSearching) {
			await handleSearch(searchQuery);
		}
	}

	function mergeFeedItems(
		existing: ExploreFeed['items'],
		incoming: ExploreFeed['items']
	): ExploreFeed['items'] {
		return dedupeFeedItems([...existing, ...incoming]);
	}

	async function fetchFeedPage(pageNumber: number): Promise<ExploreFeed> {
		const query = {
			page: pageNumber,
			limit: FEED_LIMIT,
			source_id: selectedSourceId || undefined,
			extension_pkg: selectedExtensionQuery()
		};
		if (selectedCategory) {
			return getCategoryFeed({
				name: selectedCategory,
				...query
			});
		}
		if (activeTab === 'latest') {
			return getLatestFeed(query);
		}
		return getPopularFeed(query);
	}

	async function loadFeed() {
		const requestId = ++activeFeedRequestId;
		loading = true;
		loadingMore = false;
		error = null;
		try {
			const firstPage = await fetchFeedPage(1);
			if (requestId !== activeFeedRequestId) return;
			feed = {
				...firstPage,
				items: dedupeFeedItems(firstPage.items)
			};
		} catch (e) {
			if (requestId !== activeFeedRequestId) return;
			error = e instanceof Error ? e.message : 'Failed to load feed';
		} finally {
			if (requestId === activeFeedRequestId) {
				loading = false;
			}
		}
	}

	async function loadMoreFeed() {
		if (!canInfiniteScroll || !feed?.has_next_page || loading || loadingMore) {
			return;
		}

		const nextPage = feed.page + 1;
		const requestId = ++activeFeedRequestId;
		loadingMore = true;
		error = null;
		try {
			const nextFeed = await fetchFeedPage(nextPage);
			if (requestId !== activeFeedRequestId) return;
			if (!feed) {
				feed = nextFeed;
				return;
			}
			feed = {
				...nextFeed,
				items: mergeFeedItems(feed.items, nextFeed.items)
			};
		} catch (e) {
			if (requestId !== activeFeedRequestId) return;
			error = e instanceof Error ? e.message : 'Failed to load more titles';
		} finally {
			if (requestId === activeFeedRequestId) {
				loadingMore = false;
			}
		}
	}

	async function handleSearch(query: string) {
		if (!query.trim()) {
			feed = null;
			loading = false;
			loadingMore = false;
			error = null;
			return;
		}
		if (!isSearchTab) return;
		const requestId = ++activeFeedRequestId;
		loading = true;
		loadingMore = false;
		error = null;
		try {
			const searchFiltersPayload =
				Object.keys(selectedSourceAppliedFilters).length > 0
					? JSON.stringify(selectedSourceAppliedFilters)
					: undefined;
			const searchResults = await searchFeed({
				query: query.trim(),
				limit: 42,
				source_id: selectedSourceId || undefined,
				extension_pkg: selectedExtensionQuery(),
				search_filters_json: searchFiltersPayload
			});
			if (requestId !== activeFeedRequestId) return;
			feed = {
				...searchResults,
				items: dedupeFeedItems(searchResults.items)
			};
		} catch (e) {
			if (requestId !== activeFeedRequestId) return;
			error = e instanceof Error ? e.message : 'Search failed';
		} finally {
			if (requestId === activeFeedRequestId) {
				loading = false;
			}
		}
	}

	function onSearchInput() {
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			if (!isSearchTab) return;
			void handleSearch(searchQuery);
		}, 350);
	}

	function observeInfiniteScroll(node: HTMLElement) {
		if (typeof IntersectionObserver === 'undefined') {
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				infiniteSentinelVisible = entries.some((entry) => entry.isIntersecting);
			},
			{ rootMargin: '640px 0px' }
		);
		observer.observe(node);

		return {
			destroy() {
				observer.disconnect();
				infiniteSentinelVisible = false;
			}
		};
	}

	function patchImportedLibraryId(dedupeKey: string, libraryId: number): void {
		if (!feed) return;
		feed = {
			...feed,
			items: feed.items.map((item) =>
				item.dedupe_key === dedupeKey ? { ...item, imported_library_id: libraryId } : item
			)
		};
	}

	async function openPreview(item: ExploreFeed['items'][number]) {
		if (openingTitleKey) {
			return;
		}

		// If already in library, go to title page
		if (item.imported_library_id != null) {
			persistExploreState();
			goto(`${buildTitlePath(item.imported_library_id, item.title)}?from=explore`);
			return;
		}

		const primaryLink = item.links[0];
		if (!primaryLink) {
			error = 'No source link available for this title';
			return;
		}

		openingTitleKey = item.dedupe_key;
		error = null;
		try {
			const imported = await importLibraryTitle({
				source_id: primaryLink.source.id,
				title_url: primaryLink.title_url
			});
			patchImportedLibraryId(item.dedupe_key, imported.library_title_id);
			previewItemStore.set(null);
			persistExploreState();
			await goto(`${buildTitlePath(imported.library_title_id, item.title)}?from=explore`);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to open title';
		} finally {
			openingTitleKey = null;
		}
	}

	onMount(async () => {
		restoreExploreState();
		const [loadedSources, loadedCategories] = await Promise.all([
			listSources({ enabled: true }).catch(() => [] as SourceSummary[]),
			listCategories(30).catch(() => [] as ExploreCategory[])
		]);
		sources = loadedSources;
		categories = loadedCategories;
		void loadAssignedLibraryTitleIds();
	});

	onMount(() => {
		const markScrollIntent = () => {
			hasScrollIntent = true;
		};
		window.addEventListener('wheel', markScrollIntent, { passive: true });
		window.addEventListener('touchmove', markScrollIntent, { passive: true });
		window.addEventListener('scroll', markScrollIntent, { passive: true });
		return () => {
			persistExploreState();
			window.removeEventListener('wheel', markScrollIntent);
			window.removeEventListener('touchmove', markScrollIntent);
			window.removeEventListener('scroll', markScrollIntent);
		};
	});

	$effect(() => {
		const tab = activeTab;
		const extensionKey = selectedExtensionKey;
		const category = selectedCategory;
		const sourceId = selectedSourceId;
		void tab;
		void extensionKey;
		void category;
		void sourceId;

		if (!isSearchTab) {
			if (skipInitialFeedLoad) {
				skipInitialFeedLoad = false;
				return;
			}
			loadFeed();
		}
	});

	$effect(() => {
		if (!sources.length || !selectedExtensionPkgs.length) {
			return;
		}

		const validPkgs = new Set(extensionFilters.map((item) => item.pkg));
		const validSelection = selectedExtensionPkgs.filter((pkg) => validPkgs.has(pkg));
		if (validSelection.length !== selectedExtensionPkgs.length) {
			setExtensionFilters(validSelection);
		}
	});

	$effect(() => {
		if (!sources.length || !selectedSourceId) {
			return;
		}

		const hasSource = sources.some((source) => source.id === selectedSourceId);
		if (!hasSource) {
			clearSourceFilter();
		}
	});

	$effect(() => {
		if (!categories.length || !selectedCategory) {
			return;
		}

		const hasCategory = categories.some((category) => category.name === selectedCategory);
		if (!hasCategory) {
			clearCategoryFilter();
		}
	});

	let lastSearchFilterKey = $state('');
	$effect(() => {
		const currentSearchFilterKey = searchFilterKey;
		if (!isSearchTab) {
			lastSearchFilterKey = currentSearchFilterKey;
			return;
		}
		if (!hasSearchQuery) {
			lastSearchFilterKey = currentSearchFilterKey;
			feed = null;
			loading = false;
			loadingMore = false;
			error = null;
			return;
		}
		if (currentSearchFilterKey === lastSearchFilterKey) {
			return;
		}
		lastSearchFilterKey = currentSearchFilterKey;
		if (skipInitialSearchLoad) {
			skipInitialSearchLoad = false;
			return;
		}
		void handleSearch(searchQuery);
	});

	$effect(() => {
		const shouldLoadMore =
			canInfiniteScroll &&
			hasScrollIntent &&
			infiniteSentinelVisible &&
			!!feed?.has_next_page &&
			!loading &&
			!loadingMore;
		if (!shouldLoadMore) {
			return;
		}
		void loadMoreFeed();
	});

	$effect(() => {
		if (pendingRestoreScrollY === null) return;
		if (loading) return;
		const y = pendingRestoreScrollY;
		pendingRestoreScrollY = null;
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				window.scrollTo({ top: y, left: 0, behavior: 'auto' });
			});
		});
	});
</script>

<svelte:head>
	<title>{$_('nav.explore')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h1 class="text-display text-xl text-[var(--text)]">{$_('nav.explore').toLowerCase()}</h1>
	</div>

	<!-- Tabs -->
	<div class="flex gap-1">
		{#each tabs as tab (tab)}
			<button
				type="button"
				class="px-3 py-1.5 text-xs font-medium transition-colors {activeTab === tab
					? 'bg-[var(--void-4)] text-[var(--text)]'
					: 'text-[var(--text-ghost)] hover:bg-[var(--void-3)] hover:text-[var(--text-muted)]'}"
				onclick={() => setTab(tab)}
			>
				{tabLabel(tab)}
			</button>
		{/each}
	</div>

	<!-- Search tab controls -->
	{#if activeTab === 'search'}
		<div class="flex flex-col gap-4">
			<!-- Search input -->
			<div class="relative">
				<div class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-ghost)]">
					<Icon name="search" size={14} />
				</div>
				<input
					type="search"
					placeholder={$_('explore.searchPlaceholder')}
					bind:value={searchQuery}
					oninput={onSearchInput}
					class="h-11 w-full bg-[var(--void-2)] border border-[var(--void-4)] pl-9 pr-9 text-sm text-[var(--text)] placeholder:text-[var(--text-ghost)] transition-colors hover:border-[var(--void-5)] focus:border-[var(--void-6)] focus:outline-none"
				/>
				{#if searchQuery.trim()}
					<button
						type="button"
						class="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-ghost)] hover:text-[var(--text-muted)] transition-colors"
						onclick={() => {
							searchQuery = '';
							void handleSearch('');
						}}
					>
						<Icon name="x" size={14} />
					</button>
				{/if}
			</div>

			<!-- Source strip -->
			{#if sources.length > 0}
				<div class="flex flex-col gap-2.5">
					<!-- Label row with filter action -->
					<div class="flex items-center justify-between">
						<span class="text-[10px] uppercase tracking-widest text-[var(--text-ghost)]">
							{$_('explore.selectSource')}
						</span>
						{#if hasSourceFilterSelected}
							<button
								type="button"
								class="flex items-center gap-1.5 text-[10px] text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
								onclick={() => selectedSource && openSearchFilters(selectedSource.id)}
							>
								<Icon name="filter" size={10} />
								{$_('explore.advancedFilters')}
								{#if hasAppliedSearchFilters}
									<span class="text-[var(--text-muted)]">· {appliedSearchFilterCount}</span>
								{/if}
							</button>
						{/if}
					</div>

					<!-- Horizontal chip row -->
					<div class="flex gap-1.5 overflow-x-auto no-scrollbar">
						<button
							type="button"
							class="shrink-0 h-7 px-3 text-[10px] uppercase tracking-wider transition-colors {!hasSourceFilterSelected
								? 'bg-[var(--void-4)] text-[var(--text)]'
								: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)] hover:bg-[var(--void-2)]'}"
							onclick={clearSourceFilter}
						>
							{$_('explore.allSources')}
						</button>
						{#each sources as source (source.id)}
							<button
								type="button"
								class="shrink-0 h-7 px-3 text-[10px] uppercase tracking-wider transition-colors {selectedSourceId === source.id
									? 'bg-[var(--void-4)] text-[var(--text)]'
									: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)] hover:bg-[var(--void-2)]'}"
								onclick={() => setSourceFilter(source.id)}
							>
								{source.name}{source.lang ? ` [${source.lang}]` : ''}
							</button>
						{/each}
					</div>

					<!-- Applied filters clear -->
					{#if hasAppliedSearchFilters}
						<div class="flex items-center gap-2">
							<div class="h-px flex-1 bg-[var(--void-3)]"></div>
							<button
								type="button"
								class="flex items-center gap-1 text-[10px] text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
								onclick={clearAppliedSearchFilters}
							>
								<Icon name="x" size={10} />
								{$_('common.clear')} {appliedSearchFilterCount} {appliedSearchFilterCount === 1 ? 'filter' : 'filters'}
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Extension filters -->
	{#if extensionFilters.length > 0 && activeTab !== 'search'}
		<div class="flex flex-col gap-2">
			<div class="flex items-center justify-between">
				<p class="text-xs text-[var(--text-ghost)]">{$_('explore.filterByExtension')}</p>
				{#if hasExtensionFiltersSelected}
					<button
						type="button"
						class="text-xs text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
						onclick={clearExtensionFilters}
					>
						{$_('common.clear')}
					</button>
				{/if}
			</div>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="inline-flex items-center gap-1 border px-2.5 py-1 text-xs transition-colors {hasExtensionFiltersSelected
						? 'border-[var(--line)] text-[var(--text-ghost)] hover:border-[var(--text-ghost)] hover:text-[var(--text-muted)]'
						: 'border-[var(--text)] bg-[var(--void-2)] text-[var(--text)]'}"
					onclick={clearExtensionFilters}
				>
					{$_('explore.allExtensions')}
				</button>
				{#each extensionFilters as extension (extension.pkg)}
					<button
						type="button"
						class="inline-flex items-center gap-1 border px-2.5 py-1 text-xs transition-colors {selectedExtensionPkgs.includes(
							extension.pkg
						)
							? 'border-[var(--text)] bg-[var(--void-2)] text-[var(--text)]'
							: 'border-[var(--line)] text-[var(--text-ghost)] hover:border-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
						onclick={() => toggleExtensionFilter(extension.pkg)}
					>
						<span>{extension.name}</span>
						<span class="text-[10px] text-[var(--text-ghost)]">{extension.sourceCount}</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Category filters -->
	{#if categories.length > 0 && activeTab !== 'search'}
		<div class="flex flex-col gap-2">
			<div class="flex items-center justify-between">
				<p class="text-xs text-[var(--text-ghost)]">{$_('explore.filterByCategory')}</p>
				{#if hasCategoryFilterSelected}
					<button
						type="button"
						class="text-xs text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
						onclick={clearCategoryFilter}
					>
						{$_('common.clear')}
					</button>
				{/if}
			</div>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="inline-flex items-center gap-1 border px-2.5 py-1 text-xs transition-colors {hasCategoryFilterSelected
						? 'border-[var(--line)] text-[var(--text-ghost)] hover:border-[var(--text-ghost)] hover:text-[var(--text-muted)]'
						: 'border-[var(--text)] bg-[var(--void-2)] text-[var(--text)]'}"
					onclick={clearCategoryFilter}
				>
					{$_('explore.allCategories')}
				</button>
				{#each categories as category, i (`${category.name}:${i}`)}
					<button
						type="button"
						class="inline-flex items-center gap-1 border px-2.5 py-1 text-xs transition-colors {selectedCategory ===
						category.name
							? 'border-[var(--text)] bg-[var(--void-2)] text-[var(--text)]'
							: 'border-[var(--line)] text-[var(--text-ghost)] hover:border-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
						onclick={() => setCategoryFilter(category.name)}
					>
						<span>{category.name}</span>
						<span class="text-[10px] text-[var(--text-ghost)]">{category.count}</span>
					</button>
				{/each}
			</div>
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

	<!-- Status bar -->
	<div class="flex items-center justify-between text-sm text-[var(--text-ghost)]">
		<p>
			{#if isSearching}
				{feed?.items.length ?? 0} result{(feed?.items.length ?? 0) === 1 ? '' : 's'}
			{:else if showSearchPrompt}
				{$_('common.search')}
			{:else if hasCategoryFilterSelected}
				{selectedCategory}
			{:else}
				{tabLabel(activeTab)}
			{/if}
		</p>
		{#if loading || loadingMore}
			<p class="flex items-center gap-1">
				<Icon name="loader" size={14} class="animate-spin" />
				{$_('common.loading')}
			</p>
		{/if}
	</div>

	<!-- Grid -->
	{#if loading && !feed}
		<div class="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
			{#each Array(18) as _, i (i)}
				<div class="flex flex-col overflow-hidden border border-[var(--line)] bg-[var(--void-2)]">
					<div
						class="aspect-[2/3] animate-pulse bg-[var(--void-4)]"
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
	{:else if feed && feed.items.length > 0}
		<div class="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
			{#each feed.items as item (item.dedupe_key)}
				{@const importedLibraryId = item.imported_library_id ?? null}
				{@const isInLibrary = importedLibraryId !== null && assignedLibraryTitleIds.has(importedLibraryId)}
				<button
					type="button"
					class="group card-glow relative flex flex-col overflow-hidden border border-[var(--line)] bg-[var(--void-2)] text-left"
					onclick={() => openPreview(item)}
					disabled={openingTitleKey !== null}
				>
					<!-- Cover -->
					<div class="relative aspect-[2/3] overflow-hidden bg-[var(--void-3)]">
							{#if item.thumbnail_url}
								<LazyImage
									src={getCachedCoverUrl(item.thumbnail_url)}
									alt={item.title}
									class="h-full w-full"
									imgClass="transition-transform group-hover:scale-105"
								/>
						{:else}
							<div class="flex h-full w-full items-center justify-center">
								<Icon name="image" size={24} class="text-[var(--text-ghost)]" />
							</div>
						{/if}

						<!-- In library badge -->
						{#if isInLibrary}
							<div
								class="absolute top-1 right-1 bg-[var(--success)]/80 px-1.5 py-0.5 text-[10px] text-[var(--void-0)]"
							>
								{$_('title.inLibrary')}
							</div>
						{/if}

						<!-- Source badge -->
						{#if item.links[0]}
							<div
								class="absolute bottom-1 left-1 bg-[var(--void-0)]/80 px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]"
							>
								{item.links[0].source.name}
							</div>
						{/if}

						{#if openingTitleKey === item.dedupe_key}
							<div
								class="absolute inset-0 flex items-center justify-center bg-[var(--void-0)]/60 backdrop-blur-[1px]"
							>
								<Icon name="loader" size={18} class="animate-spin text-[var(--text)]" />
							</div>
						{/if}
					</div>

					<!-- Info -->
					<div class="flex flex-1 flex-col gap-1 p-2">
						<p class="line-clamp-2 text-xs text-[var(--text)]">{item.title}</p>
					</div>
				</button>
			{/each}
		</div>
		{#if canInfiniteScroll && feed.has_next_page}
			<div class="flex items-center justify-center py-4" use:observeInfiniteScroll>
				{#if loadingMore}
					<p class="flex items-center gap-2 text-sm text-[var(--text-ghost)]">
						<Icon name="loader" size={14} class="animate-spin" />
						{$_('common.loading')}
					</p>
				{/if}
			</div>
		{/if}
	{:else if !loading}
		<!-- Empty state -->
		<div class="flex flex-col items-center gap-4 py-16 text-center">
			<div
				class="flex h-16 w-16 items-center justify-center border border-[var(--line)] bg-[var(--void-3)]"
			>
				<Icon
					name={isSearchTab ? 'search' : 'compass'}
					size={24}
					class="text-[var(--text-ghost)]"
				/>
			</div>
			<div>
				<p class="text-[var(--text)]">
					{showSearchPrompt
						? $_('common.search')
						: isSearching
							? $_('common.noResults')
							: $_('common.empty')}
				</p>
				<p class="mt-1 text-sm text-[var(--text-ghost)]">
					{showSearchPrompt
						? $_('explore.typeToSearch')
						: isSearching
							? $_('explore.tryDifferentSearch')
							: $_('explore.noSourcesEnabled')}
				</p>
			</div>
			{#if !isSearching && !isSearchTab}
				<Button variant="outline" onclick={() => goto('/extensions')}>
					{$_('explore.goToExtensions')}
				</Button>
			{/if}
		</div>
	{/if}
</div>

<!-- Advanced Search Filters -->
<SlidePanel
	open={searchFiltersOpen}
	title={selectedSource
		? `${selectedSource.name} ${$_('explore.advancedFilters')}`
		: $_('explore.advancedFilters')}
	onclose={closeSearchFilters}
>
	{#if searchFiltersLoading}
		<div class="flex flex-col items-center gap-4 py-12">
			<Icon name="loader" size={24} class="animate-spin text-[var(--text-muted)]" />
			<p class="text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
		</div>
	{:else if searchFiltersError}
		<div
			class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-4 py-3 text-sm text-[var(--error)]"
		>
			{searchFiltersError}
		</div>
	{:else if searchFiltersData}
		{#if searchFiltersData.preferences.length === 0}
			<div class="flex flex-col items-center gap-4 py-12 text-center">
				<Icon name="filter" size={32} class="text-[var(--text-ghost)]" />
				<p class="text-sm text-[var(--text-ghost)]">{$_('common.empty')}</p>
			</div>
		{:else}
			<div class="flex flex-col">
				<div class="divide-y divide-[var(--line)] border border-[var(--line)]">
					{#each searchFiltersData.preferences.filter((pref) => pref.visible) as pref (pref.key)}
						<div class="px-4 py-3">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0 flex-1">
									<p class="text-sm text-[var(--text)]">{pref.title}</p>
									{#if pref.summary}
										<p class="mt-0.5 text-xs text-[var(--text-ghost)]">{pref.summary}</p>
									{/if}
								</div>
								{#if pref.type === 'toggle'}
									{@const val = getCurrentSearchFilterValue(pref) as boolean}
									<button
										type="button"
										class="flex h-6 w-10 shrink-0 items-center px-0.5 transition-colors {val
											? 'justify-end bg-[var(--success)]/20'
											: 'justify-start bg-[var(--void-4)]'}"
										onclick={() => handleSearchFilterChange(pref.key, !val)}
										disabled={!pref.enabled}
										aria-label={pref.title}
									>
										<div class="h-5 w-5 {val ? 'bg-[var(--success)]' : 'bg-[var(--void-6)]'}"></div>
									</button>
								{/if}
							</div>

							{#if pref.type === 'list' && pref.entries && pref.entry_values}
								{@const val = getCurrentSearchFilterValue(pref) as string}
								<div class="mt-2 flex flex-col">
									{#each pref.entries as entry, i (`${pref.key}:${i}`)}
										{@const entryVal = pref.entry_values?.[i] ?? entry}
										<button
											type="button"
											class="flex items-center gap-2 py-1.5 text-sm transition-colors {val ===
											entryVal
												? 'text-[var(--text)]'
												: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
											onclick={() => handleSearchFilterChange(pref.key, entryVal)}
											disabled={!pref.enabled}
										>
											<div
												class="h-3 w-3 shrink-0 border border-[var(--line)] {val === entryVal
													? 'bg-[var(--text)]'
													: ''}"
											></div>
											{entry}
										</button>
									{/each}
								</div>
							{/if}

							{#if pref.type === 'multi_select' && pref.entries && pref.entry_values}
								{@const val = (getCurrentSearchFilterValue(pref) as string[]) ?? []}
								<div class="mt-2 flex flex-wrap gap-1.5">
									{#each pref.entries as entry, i (`${pref.key}:${i}`)}
										{@const entryVal = pref.entry_values?.[i] ?? entry}
										{@const isSelected = val.includes(entryVal)}
										<button
											type="button"
											class="inline-flex items-center gap-1.5 border px-2 py-1 text-xs transition-colors {isSelected
												? 'border-[var(--text)] bg-[var(--void-4)] text-[var(--text)]'
												: 'border-[var(--line)] text-[var(--text-ghost)] hover:border-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
											onclick={() => {
												const newVal = isSelected
													? val.filter((v) => v !== entryVal)
													: [...val, entryVal];
												handleSearchFilterChange(pref.key, newVal);
											}}
											disabled={!pref.enabled}
										>
											{#if isSelected}
												<Icon name="check" size={10} />
											{/if}
											{entry}
										</button>
									{/each}
								</div>
							{/if}

							{#if pref.type === 'text'}
								{@const val = (getCurrentSearchFilterValue(pref) as string) ?? ''}
								<div class="mt-2">
									<Input
										type="text"
										value={val}
										oninput={(e) => handleSearchFilterChange(pref.key, e.currentTarget.value)}
										disabled={!pref.enabled}
									/>
								</div>
							{/if}
						</div>
					{/each}
				</div>

				<div class="sticky bottom-0 pt-4">
					<Button variant="solid" size="md" onclick={applySearchFilters} class="w-full">
						{$_('common.apply')}
					</Button>
				</div>
			</div>
		{/if}
	{/if}
</SlidePanel>
