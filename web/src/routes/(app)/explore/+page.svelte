<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import type { Id } from '$convex/_generated/dataModel';
	import {
		CheckIcon,
		CompassIcon,
		FunnelIcon,
		ImageIcon,
		MagnifyingGlassIcon,
		SpinnerIcon,
		XIcon
	} from 'phosphor-svelte';

	import { convexApi } from '$lib/convex/api';
	import { getCachedCoverUrl } from '$lib/api/covers';
	import { waitForCommand } from '$lib/client/commands';
	import { Button } from '$lib/elements/button';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { Tabs } from '$lib/elements/tabs';
	import { _ } from '$lib/i18n';
	import { contentLanguages } from '$lib/stores/content-languages';
	import { panelOverlayOpen } from '$lib/stores/ui';
	import { normalizeContentLanguageCode, toMainContentLanguages } from '$lib/utils/content-languages';
	import { buildTitlePath } from '$lib/utils/routes';

	type TabValue = 'popular' | 'latest' | 'search';

	type SourceItem = {
		id: string;
		name: string;
		lang: string;
		supportsLatest: boolean;
		enabled?: boolean;
		extensionName: string;
		extensionPkg: string;
	};

	type ExploreItem = {
		canonicalKey: string;
		sourceId: string;
		sourcePkg: string;
		sourceLang: string;
		sourceName: string;
		titleUrl: string;
		title: string;
		description?: string;
		coverUrl?: string | null;
	};

	type LibraryTitleItem = {
		_id: string;
		sourceId: string;
		titleUrl: string;
		title: string;
	};

	type ExploreCard = {
		key: string;
		title: string;
		thumbnailUrl: string | null;
		sourceName: string;
		sourceId: string;
		sourcePkg: string;
		sourceLang: string;
		titleUrl: string;
		canonicalKey: string;
		importedLibraryId: string | null;
	};

	type FilterMeta = {
		key: string;
		title: string;
		summary?: string;
		type: string;
		enabled?: boolean;
		visible?: boolean;
		default_value?: unknown;
		current_value?: unknown;
		entries?: string[];
		entry_values?: string[];
	};

	type FilterItem = {
		name: string;
		type: string;
		data: FilterMeta;
	};

	type PreferenceBundle = {
		source: { id: string; name: string; lang: string; supportsLatest: boolean };
		preferences: FilterItem[];
		searchFilters: FilterItem[];
	};

	type FeedResult = {
		items: ExploreItem[];
		page: number;
		hasNextPage: boolean;
	};

	type SearchResult = {
		items: ExploreItem[];
	};

	const FEED_LIMIT = 24;
	const FEED_SOURCE_BATCH_SIZE = 4;
	const COMMAND_CONCURRENCY = 3;
	const FEED_DUPLICATE_PAGE_TOLERANCE = 3;
	const FEED_COMMAND_IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000;
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

	const client = useConvexClient();
	const sourcesQuery = useQuery(convexApi.extensions.listSources, () => ({}));
	const libraryQuery = useQuery(convexApi.library.listMine, () => ({}));

	const tabs = [
		{ value: 'popular', label: 'Popular' },
		{ value: 'latest', label: 'Latest Updates' },
		{ value: 'search', label: 'Search' }
	];

	let activeTab = $state<TabValue>('popular');
	let searchQuery = $state('');
	let loading = $state(true);
	let loadingMore = $state(false);
	let error = $state<string | null>(null);
	let searchTimer = $state<ReturnType<typeof setTimeout> | null>(null);
	let openingTitleKey = $state<string | null>(null);
	let selectedExtensionPkgs = $state<string[]>([]);
	let selectedSourceId = $state('');
	let activeFeedSourceIds = $state<string[]>([]);
	let loadedPagesBySource = $state<Record<string, number>>({});
	let exhaustedFeedSources = $state<Record<string, boolean>>({});
	let lastFeedLoadSignature = $state('');
	let canLoadMoreFeed = $state(false);
	let autoLoadFeedPending = false;
	let feedSentinel = $state<HTMLDivElement | null>(null);
	let feedIntersectionObserver: IntersectionObserver | null = null;
	let feedLoadGeneration = 0;
	let searchRunGeneration = 0;

	let searchFiltersOpen = $state(false);
	let searchFiltersLoading = $state(false);
	let searchFiltersError = $state<string | null>(null);
	let searchFiltersData = $state<PreferenceBundle | null>(null);
	let pendingSearchFilterChanges = $state<Record<string, unknown>>({});
	let appliedSearchFiltersBySource = $state<Record<string, Record<string, unknown>>>({});

	let liveFeedResults = $state<Record<string, FeedResult>>({});
	let liveSearchResults = $state<Record<string, SearchResult>>({});
	let cards = $state<ExploreCard[]>([]);
	let stableCardOrder: string[] = [];
	let stableCardsByKey: Record<string, ExploreCard> = {};

	const sources = $derived((sourcesQuery.data ?? []) as SourceItem[]);
	const libraryTitles = $derived((libraryQuery.data ?? []) as LibraryTitleItem[]);
	const preferredContentLanguages = $derived(toMainContentLanguages($contentLanguages));

	const sourceOptions = $derived.by(() => sourcesForContentLanguage());
	const extensionFilters = $derived.by(() => {
		const grouped: Array<{ pkg: string; name: string; sourceCount: number; sourceNames: string[] }> = [];
		const indexesByPkg: Record<string, number> = {};
		for (const source of sourceOptions) {
			const existingIndex = indexesByPkg[source.extensionPkg];
			if (existingIndex !== undefined) {
				if (!grouped[existingIndex].sourceNames.includes(source.name)) {
					grouped[existingIndex].sourceNames.push(source.name);
					grouped[existingIndex].sourceCount = grouped[existingIndex].sourceNames.length;
				}
			} else {
				indexesByPkg[source.extensionPkg] = grouped.length;
				grouped.push({
					pkg: source.extensionPkg,
					name: displayExtensionName(source.extensionName),
					sourceCount: 1,
					sourceNames: [source.name]
				});
			}
		}
		return grouped
			.map(({ sourceNames: _sourceNames, ...item }) => item)
			.sort((left, right) => left.name.localeCompare(right.name));
	});

	const visibleSources = $derived.by(() => {
		const filteredByExtension =
			selectedExtensionPkgs.length === 0
				? sourceOptions
				: sourceOptions.filter((source) => selectedExtensionPkgs.includes(source.extensionPkg));
		return activeTab === 'latest'
			? filteredByExtension.filter((source) => source.supportsLatest)
			: filteredByExtension;
	});

	const searchSources = $derived(sourceOptions);
	const selectedSource = $derived(searchSources.find((source) => source.id === selectedSourceId) ?? null);
	const selectedSourceAppliedFilters = $derived(
		selectedSourceId ? (appliedSearchFiltersBySource[selectedSourceId] ?? {}) : {}
	);
	const appliedSearchFilterCount = $derived(Object.keys(selectedSourceAppliedFilters).length);
	const hasAppliedSearchFilters = $derived(appliedSearchFilterCount > 0);
	const canRunSearch = $derived(searchQuery.trim().length > 0 || (Boolean(selectedSourceId) && hasAppliedSearchFilters));

	const importedLibraryIds = $derived.by(() => {
		const bySourceKey: Record<string, string> = {};
		for (const title of libraryTitles) {
			bySourceKey[`${title.sourceId}::${title.titleUrl}`] = title._id;
		}
		return bySourceKey;
	});

	const feedCommandType = $derived(activeTab === 'latest' ? 'explore.latest' : 'explore.popular');
	const showSearchPrompt = $derived(activeTab === 'search' && !canRunSearch);
	const currentLoading = $derived(loading || loadingMore || sourcesQuery.isLoading || libraryQuery.isLoading);
	const incomingCards = $derived.by(() => {
		const sourceIds =
			activeTab === 'search'
				? selectedSourceId
					? [selectedSourceId]
					: searchSources.map((source) => source.id)
				: activeFeedSourceIds;

		const items: ExploreCard[] = [];
		const signatureToIndex: Record<string, number> = {};

		for (const sourceId of sourceIds) {
			const resultItems =
				activeTab === 'search'
					? searchItemsForSource(sourceId)
					: feedItemsForSource(feedCommandType, sourceId, loadedPagesBySource[sourceId] ?? 0);

			for (const item of resultItems) {
				const importedLibraryId = importedLibraryIds[`${item.sourceId}::${item.titleUrl}`] ?? null;
				const nextCard: ExploreCard = {
					key: cardKeyFor(item),
					title: item.title,
					thumbnailUrl: item.coverUrl ?? null,
					sourceName: item.sourceName || sourceNameFor(item.sourceId),
					sourceId: item.sourceId,
					sourcePkg: item.sourcePkg,
					sourceLang: item.sourceLang,
					titleUrl: item.titleUrl,
					canonicalKey: item.canonicalKey,
					importedLibraryId
				};

				const signatures = itemMergeSignatures(item);
				let existingIndex: number | undefined;
				for (const signature of signatures) {
					const foundIndex = signatureToIndex[signature];
					if (foundIndex !== undefined) {
						existingIndex = foundIndex;
						break;
					}
				}

				if (existingIndex === undefined) {
					const nextIndex = items.length;
					items.push(nextCard);
					for (const signature of signatures) {
						signatureToIndex[signature] = nextIndex;
					}
					continue;
				}

				const current = items[existingIndex];
				const merged = {
					...current,
					title: current.title || nextCard.title,
					thumbnailUrl: current.thumbnailUrl || nextCard.thumbnailUrl,
					sourceName: current.sourceName || nextCard.sourceName,
					importedLibraryId: current.importedLibraryId ?? nextCard.importedLibraryId
				};
				items[existingIndex] = merged;
				for (const signature of itemMergeSignatures({
					...item,
					title: merged.title,
					coverUrl: merged.thumbnailUrl,
					sourceName: merged.sourceName
				})) {
					signatureToIndex[signature] = existingIndex;
				}
			}
		}

		return items;
	});

	$effect(() => {
		const nextCardsByKey: Record<string, ExploreCard> = {};
		for (const card of incomingCards) {
			nextCardsByKey[card.key] = card;
		}

		stableCardOrder = stableCardOrder.filter((key) => nextCardsByKey[key] !== undefined);
		for (const card of incomingCards) {
			if (!(card.key in stableCardsByKey)) {
				stableCardOrder.push(card.key);
			}
		}

		stableCardsByKey = nextCardsByKey;
		cards = stableCardOrder
			.map((key) => stableCardsByKey[key])
			.filter((card): card is ExploreCard => card !== undefined);
	});

	function sourceNameFor(sourceId: string): string {
		return sources.find((source) => source.id === sourceId)?.name ?? 'Source';
	}

	function displayExtensionName(name: string): string {
		return name.replace(/^tachiyomi:\s*/i, '').trim() || name;
	}

	function sourcesForContentLanguage(): SourceItem[] {
		const enabledSources = sources.filter((source) => source.enabled !== false);
		if (preferredContentLanguages.length === 0) {
			return enabledSources;
		}
		return enabledSources.filter((source) => {
			const normalized = normalizeContentLanguageCode(source.lang);
			return normalized !== null && preferredContentLanguages.includes(normalized);
		});
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

	function itemMergeSignatures(item: ExploreItem): string[] {
		const signatures: string[] = [];
		const addSignature = (value: string) => {
			if (!signatures.includes(value)) signatures.push(value);
		};
		const canonicalSignature = normalizeSignatureToken(item.canonicalKey);
		if (canonicalSignature) addSignature(`canonical:${canonicalSignature}`);

		const urlSignature = titleUrlSignature(item.titleUrl);
		const extensionSignature = normalizeSignatureToken(item.sourcePkg);
		const sourceSignature = normalizeSignatureToken(item.sourceId);
		if (urlSignature) {
			if (extensionSignature) addSignature(`ext:${extensionSignature}|${urlSignature}`);
			if (sourceSignature) addSignature(`src:${sourceSignature}|${urlSignature}`);
		}

		const titleSignature = normalizeSignatureToken(item.title);
		const coverSignature = titleUrlSignature(item.coverUrl);
		if (titleSignature && coverSignature) {
			addSignature(`title-cover:${titleSignature}|${coverSignature}`);
		}

		return signatures;
	}

	function cardKeyFor(item: ExploreItem): string {
		const canonicalSignature = normalizeSignatureToken(item.canonicalKey);
		if (canonicalSignature) return `canonical:${canonicalSignature}`;
		const urlSignature = titleUrlSignature(item.titleUrl);
		if (urlSignature) return `source:${normalizeSignatureToken(item.sourcePkg)}|${urlSignature}`;
		return `${item.sourceId}::${item.titleUrl}`;
	}

	function feedResultKey(commandType: string, sourceId: string, page: number): string {
		return `${commandType}:${sourceId}:page:${page}`;
	}

	function feedCommandIdempotencyKey(commandType: string, sourceId: string, page: number, limit: number): string {
		const bucket = Math.floor(Date.now() / FEED_COMMAND_IDEMPOTENCY_WINDOW_MS);
		return `feed:v2:${commandType}:${sourceId}:${page}:${limit}:${bucket}`;
	}

	function searchResultKey(sourceId: string, query: string, searchFilters: Record<string, unknown>): string {
		return `explore.search:${sourceId}:${query.trim().toLowerCase()}:${JSON.stringify(searchFilters)}`;
	}

	function searchCommandIdempotencyKey(
		sourceId: string,
		query: string,
		searchFilters: Record<string, unknown>
	): string {
		return `search:${sourceId}:${query.trim().toLowerCase()}:${JSON.stringify(searchFilters)}`;
	}

	function latestFeedResult(commandType: string, sourceId: string, page: number): FeedResult | null {
		return liveFeedResults[feedResultKey(commandType, sourceId, page)] ?? null;
	}

	function latestSearchResult(
		sourceId: string,
		query: string,
		searchFilters: Record<string, unknown>
	): SearchResult | null {
		const key = searchResultKey(sourceId, query, searchFilters);
		return liveSearchResults[key] ?? null;
	}

	function feedItemsForSource(commandType: string, sourceId: string, maxPage: number): ExploreItem[] {
		const items: ExploreItem[] = [];
		for (let page = 1; page <= maxPage; page += 1) {
			const result = latestFeedResult(commandType, sourceId, page);
			if (!result) continue;
			items.push(...result.items);
		}
		return items;
	}

	function searchItemsForSource(sourceId: string): ExploreItem[] {
		const query = searchQuery.trim();
		const filters = selectedSourceId === sourceId ? selectedSourceAppliedFilters : {};
		if (!query && Object.keys(filters).length === 0) return [];
		return latestSearchResult(sourceId, query, filters)?.items ?? [];
	}

	function sourceHasMore(commandType: string, sourceId: string): boolean {
		if (exhaustedFeedSources[sourceId]) return false;
		const currentPage = loadedPagesBySource[sourceId] ?? 0;
		if (currentPage < 1) return false;
		return true;
	}

	function hasUniqueFeedItems(existing: ExploreItem[], incoming: ExploreItem[]): boolean {
		const existingSignatures: Record<string, true> = {};
		for (const item of existing) {
			for (const signature of itemMergeSignatures(item)) {
				existingSignatures[signature] = true;
			}
		}
		return incoming.some((item) =>
			itemMergeSignatures(item).some((signature) => existingSignatures[signature] !== true)
		);
	}

	function setTab(value: string) {
		feedLoadGeneration += 1;
		searchRunGeneration += 1;
		activeTab = value as TabValue;
		error = null;
		if (activeTab !== 'search') {
			searchQuery = '';
			selectedSourceId = '';
		}
	}

	function toggleExtensionFilter(pkg: string) {
		if (selectedExtensionPkgs.includes(pkg)) {
			selectedExtensionPkgs = selectedExtensionPkgs.filter((item) => item !== pkg);
			return;
		}
		selectedExtensionPkgs = [...selectedExtensionPkgs, pkg];
	}

	function clearExtensionFilters() {
		selectedExtensionPkgs = [];
	}

	function structuredCloneValue(value: unknown) {
		if (Array.isArray(value)) return [...value];
		if (value && typeof value === 'object') return { ...(value as Record<string, unknown>) };
		return value;
	}

	async function enqueueCommand(
		commandType: string,
		payload: Record<string, unknown>,
		idempotencyKey?: string
	) {
		return client.mutation(convexApi.commands.enqueue, { commandType, payload, idempotencyKey });
	}

	async function runWithConcurrency<T>(
		items: T[],
		limit: number,
		task: (item: T) => Promise<void>
	) {
		if (items.length === 0) return;

		let index = 0;
		const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (index < items.length) {
				const current = items[index];
				index += 1;
				await task(current);
			}
		});

		await Promise.all(workers);
	}

	async function fetchFeedPage(sourceId: string, page: number): Promise<FeedResult> {
		const { commandId } = await enqueueCommand(
			feedCommandType,
			{
				sourceId,
				page,
				limit: FEED_LIMIT
			},
			feedCommandIdempotencyKey(feedCommandType, sourceId, page, FEED_LIMIT)
		);
		const command = await waitForCommand(client, commandId as Id<'commands'>);
		return {
			items: ((command.result?.items as ExploreItem[] | undefined) ?? []) as ExploreItem[],
			page: Number(command.result?.page ?? page),
			hasNextPage: Boolean(command.result?.hasNextPage ?? false)
		};
	}

	async function fetchNextUniqueFeedPage(
		sourceId: string,
		startPage: number,
		existingItems: ExploreItem[]
	): Promise<{ result: FeedResult; finalPage: number; exhausted: boolean }> {
		let page = startPage;
		let duplicatePages = 0;

		while (true) {
			const result = await fetchFeedPage(sourceId, page);
			const hasUniqueItems = hasUniqueFeedItems(existingItems, result.items);
			if (hasUniqueItems || !result.hasNextPage) {
				return {
					result,
					finalPage: result.page,
					exhausted: !result.hasNextPage || !hasUniqueItems
				};
			}

			duplicatePages += 1;
			if (duplicatePages >= FEED_DUPLICATE_PAGE_TOLERANCE) {
				return {
					result,
					finalPage: result.page,
					exhausted: true
				};
			}

			page = result.page + 1;
		}
	}

	function refreshCanLoadMoreFeed(nextLoaded: Record<string, number>, nextExhausted: Record<string, boolean>) {
		canLoadMoreFeed =
			visibleSources.some((source) => {
				const page = nextLoaded[source.id] ?? 0;
				return page > 0 && nextExhausted[source.id] !== true;
			}) ||
			visibleSources.some((source) => !activeFeedSourceIds.includes(source.id));
	}

	async function loadFeedInitial(generation: number) {
		const sourceIds = activeFeedSourceIds;
		if (sourceIds.length === 0) {
			loadedPagesBySource = {};
			exhaustedFeedSources = {};
			canLoadMoreFeed = false;
			loading = false;
			return;
		}
		canLoadMoreFeed = true;
		await loadFeedPageBatch(sourceIds, false, generation);
	}

	async function loadFeedPageBatch(sourceIds: string[], append: boolean, generation: number) {
		if (sourceIds.length === 0) {
			if (!append) {
				loadedPagesBySource = {};
				exhaustedFeedSources = {};
				canLoadMoreFeed = false;
				loading = false;
			}
			return;
		}

		if (append) {
			loadingMore = true;
		} else {
			loading = true;
		}
		error = null;
		const nextPages: Record<string, number> = append ? { ...loadedPagesBySource } : {};
		const nextExhausted: Record<string, boolean> = append ? { ...exhaustedFeedSources } : {};
		const nextLiveFeedResults = { ...liveFeedResults };
		const failures: string[] = [];
		let successfulSources = 0;
		const requestCommandType = feedCommandType;

		await runWithConcurrency(sourceIds, COMMAND_CONCURRENCY, async (sourceId) => {
				try {
					const result = await fetchFeedPage(sourceId, 1);
					successfulSources += 1;
					nextLiveFeedResults[feedResultKey(feedCommandType, sourceId, 1)] = result;
					nextPages[sourceId] = 1;
					if (result.hasNextPage === true) {
						delete nextExhausted[sourceId];
					} else {
						nextExhausted[sourceId] = true;
					}
				} catch (cause) {
					failures.push(cause instanceof Error ? cause.message : `Unable to load ${sourceNameFor(sourceId)}`);
				}
			});

		if (generation !== feedLoadGeneration || activeTab === 'search' || requestCommandType !== feedCommandType) {
			if (append) {
				loadingMore = false;
			} else {
				loading = false;
			}
			return;
		}

		liveFeedResults = nextLiveFeedResults;
		loadedPagesBySource = nextPages;
		exhaustedFeedSources = nextExhausted;
		refreshCanLoadMoreFeed(nextPages, nextExhausted);
		error = failures.length > 0 && successfulSources === 0 ? failures[0] ?? null : null;
		if (append) {
			loadingMore = false;
		} else {
			loading = false;
		}
	}

	async function loadMoreFeed() {
		if (loading || loadingMore || activeTab === 'search') return;
		const generation = feedLoadGeneration;
		const requestCommandType = feedCommandType;

		const nextSourcePages = visibleSources
			.filter((source) => sourceHasMore(feedCommandType, source.id))
			.map((source) => ({
				sourceId: source.id,
				page: (loadedPagesBySource[source.id] ?? 0) + 1
			}));

		if (nextSourcePages.length === 0) {
			const nextSourceIds = visibleSources
				.map((source) => source.id)
				.filter((sourceId) => !activeFeedSourceIds.includes(sourceId))
				.slice(0, FEED_SOURCE_BATCH_SIZE);
			if (nextSourceIds.length === 0) return;
			activeFeedSourceIds = [...activeFeedSourceIds, ...nextSourceIds];
			await loadFeedPageBatch(nextSourceIds, true, feedLoadGeneration);
			return;
		}

		loadingMore = true;
		const nextLoaded = { ...loadedPagesBySource };
		const nextExhausted = { ...exhaustedFeedSources };
		const nextLiveFeedResults = { ...liveFeedResults };
		const failures: string[] = [];
		let successfulSources = 0;

		await runWithConcurrency(nextSourcePages, COMMAND_CONCURRENCY, async ({ sourceId, page }) => {
				try {
					const existingItems = feedItemsForSource(feedCommandType, sourceId, loadedPagesBySource[sourceId] ?? 0);
					const { result, finalPage, exhausted } = await fetchNextUniqueFeedPage(
						sourceId,
						page,
						existingItems
					);
					successfulSources += 1;
					nextLiveFeedResults[feedResultKey(feedCommandType, sourceId, finalPage)] = result;
					nextLoaded[sourceId] = finalPage;
					if (exhausted) {
						nextExhausted[sourceId] = true;
					} else {
						delete nextExhausted[sourceId];
					}
				} catch (cause) {
					failures.push(cause instanceof Error ? cause.message : `Unable to load more from ${sourceNameFor(sourceId)}`);
				}
			});

		if (
			generation !== feedLoadGeneration ||
			requestCommandType !== feedCommandType
		) {
			loadingMore = false;
			return;
		}

		liveFeedResults = nextLiveFeedResults;
		loadedPagesBySource = nextLoaded;
		exhaustedFeedSources = nextExhausted;
		refreshCanLoadMoreFeed(nextLoaded, nextExhausted);
		if (failures.length > 0 && successfulSources === 0 && cards.length === 0) {
			error = failures[0];
		} else if (successfulSources > 0 || cards.length > 0) {
			error = null;
		}
		loadingMore = false;
	}

	async function runSearch() {
		const generation = ++searchRunGeneration;
		const value = searchQuery.trim();
		const selectedSourceFilters = selectedSourceId ? selectedSourceAppliedFilters : {};
		const hasFilterOnlySearch = Boolean(selectedSourceId) && Object.keys(selectedSourceFilters).length > 0;
		if (!value && !hasFilterOnlySearch) {
			loading = false;
			return;
		}

		const sourceIds =
			selectedSourceId && searchSources.some((source) => source.id === selectedSourceId)
				? [selectedSourceId]
				: searchSources.map((source) => source.id);

		if (sourceIds.length === 0) {
			loading = false;
			return;
		}

		loading = true;
		error = null;
		const failures: string[] = [];
		const nextLiveSearchResults = { ...liveSearchResults };

		await runWithConcurrency(sourceIds, COMMAND_CONCURRENCY, async (sourceId) => {
				try {
					const searchFilters = selectedSourceId === sourceId ? selectedSourceAppliedFilters : {};
					const payload: Record<string, unknown> = {
						query: value,
						sourceId,
						limit: 42
					};
					if (Object.keys(searchFilters).length > 0) {
						payload.searchFilters = searchFilters;
					}
					const { commandId } = await enqueueCommand(
						'explore.search',
						payload,
						searchCommandIdempotencyKey(sourceId, value, searchFilters)
					);
					const command = await waitForCommand(client, commandId as Id<'commands'>);
					nextLiveSearchResults[searchResultKey(sourceId, value, searchFilters)] = {
						items: ((command.result?.items as ExploreItem[] | undefined) ?? []) as ExploreItem[]
					};
				} catch (cause) {
					failures.push(cause instanceof Error ? cause.message : `Search failed for ${sourceNameFor(sourceId)}`);
				}
			});

		if (generation !== searchRunGeneration || activeTab !== 'search') {
			loading = false;
			return;
		}

		liveSearchResults = nextLiveSearchResults;
		error = failures[0] ?? null;
		loading = false;
	}

	async function openSearchFilters(sourceId: string) {
		searchFiltersOpen = true;
		searchFiltersLoading = true;
		searchFiltersError = null;
		searchFiltersData = null;
		pendingSearchFilterChanges = {};

		try {
			const { commandId } = await enqueueCommand('sources.preferences.fetch', { sourceId });
			const command = await waitForCommand(client, commandId as Id<'commands'>);
			searchFiltersData = command.result as PreferenceBundle;
			const applied = appliedSearchFiltersBySource[sourceId];
			if (applied) {
				pendingSearchFilterChanges = structuredCloneValue(applied) as Record<string, unknown>;
			}
		} catch (cause) {
			searchFiltersError =
				cause instanceof Error ? cause.message : 'Failed to load search filters';
		} finally {
			searchFiltersLoading = false;
		}
	}

	function closeSearchFilters() {
		searchFiltersOpen = false;
		searchFiltersLoading = false;
		searchFiltersError = null;
		searchFiltersData = null;
		pendingSearchFilterChanges = {};
	}

	function handleSearchFilterChange(key: string, value: unknown) {
		pendingSearchFilterChanges = { ...pendingSearchFilterChanges, [key]: value };
	}

	function clearAppliedSearchFilters() {
		if (!selectedSourceId) return;
		const next = { ...appliedSearchFiltersBySource };
		delete next[selectedSourceId];
		appliedSearchFiltersBySource = next;
		if (canRunSearch) {
			void runSearch();
		}
	}

	function getCurrentSearchFilterValue(filter: FilterMeta) {
		if (filter.key in pendingSearchFilterChanges) {
			return pendingSearchFilterChanges[filter.key];
		}
		if (selectedSourceId && filter.key in selectedSourceAppliedFilters) {
			return selectedSourceAppliedFilters[filter.key];
		}
		return filter.current_value ?? filter.default_value;
	}

	function toggleMultiSelectValue(key: string, option: string, checked: boolean) {
		const current = Array.isArray(pendingSearchFilterChanges[key])
			? [...(pendingSearchFilterChanges[key] as string[])]
			: Array.isArray(selectedSourceAppliedFilters[key])
				? [...(selectedSourceAppliedFilters[key] as string[])]
				: [];
		const next = checked ? [...new Set([...current, option])] : current.filter((item) => item !== option);
		handleSearchFilterChange(key, next);
	}

	async function applySearchFilters() {
		if (!selectedSourceId) {
			closeSearchFilters();
			return;
		}
		appliedSearchFiltersBySource = {
			...appliedSearchFiltersBySource,
			[selectedSourceId]: { ...pendingSearchFilterChanges }
		};
		if (Object.keys(pendingSearchFilterChanges).length === 0) {
			const next = { ...appliedSearchFiltersBySource };
			delete next[selectedSourceId];
			appliedSearchFiltersBySource = next;
		}
		closeSearchFilters();
		if (canRunSearch || Object.keys(pendingSearchFilterChanges).length > 0) {
			await runSearch();
		}
	}

	function onSearchInput() {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			if (activeTab !== 'search') return;
			void runSearch();
		}, 250);
	}

	function buildPreviewHref(item: ExploreCard): string {
		if (item.importedLibraryId) {
			return buildTitlePath(item.importedLibraryId, item.title);
		}
		const query = new URLSearchParams({
			source_id: item.sourceId,
			source_pkg: item.sourcePkg,
			source_lang: item.sourceLang,
			title_url: item.titleUrl,
			title: item.title,
			thumbnail_url: item.thumbnailUrl ?? '',
			canonical_key: item.canonicalKey
		});
		return `/title/open?${query.toString()}`;
	}

	function shouldUseBrowserNavigation(event: MouseEvent): boolean {
		return (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		);
	}

	function handleCardClick(event: MouseEvent, item: ExploreCard) {
		if (shouldUseBrowserNavigation(event)) return;
		if (openingTitleKey) return;
		event.preventDefault();
		openingTitleKey = item.key;
		void goto(buildPreviewHref(item)).finally(() => {
			openingTitleKey = null;
		});
	}

	async function maybeAutoLoadFeed() {
		if (autoLoadFeedPending || activeTab === 'search' || currentLoading || !canLoadMoreFeed) return;

		autoLoadFeedPending = true;
		try {
			await loadMoreFeed();
		} finally {
			autoLoadFeedPending = false;
		}
	}

	function resetFeedObserver() {
		feedIntersectionObserver?.disconnect();
		feedIntersectionObserver = null;
	}

	function observeFeedSentinel() {
		if (typeof window === 'undefined' || !feedSentinel || activeTab === 'search') return;
		resetFeedObserver();
		feedIntersectionObserver = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					void maybeAutoLoadFeed();
				}
			},
			{
				root: null,
				rootMargin: '960px 0px 960px 0px',
				threshold: 0
			}
		);
		feedIntersectionObserver.observe(feedSentinel);
	}

	onMount(() => {
		return () => {
			if (searchTimer) clearTimeout(searchTimer);
			resetFeedObserver();
			panelOverlayOpen.set(false);
		};
	});

	$effect(() => {
		panelOverlayOpen.set(searchFiltersOpen);
		return () => panelOverlayOpen.set(false);
	});

	$effect(() => {
		if (selectedSourceId && !searchSources.some((source) => source.id === selectedSourceId)) {
			selectedSourceId = '';
		}
	});

	$effect(() => {
		if (!sources.length) return;
		if (activeTab === 'search') {
			lastFeedLoadSignature = '';
			activeFeedSourceIds = [];
			loading = false;
			return;
		}
		const signature = `${feedCommandType}:${visibleSources.map((source) => source.id).join(',')}`;
		if (signature === lastFeedLoadSignature) {
			return;
		}
		lastFeedLoadSignature = signature;
		activeFeedSourceIds = visibleSources.slice(0, FEED_SOURCE_BATCH_SIZE).map((source) => source.id);
		canLoadMoreFeed = activeFeedSourceIds.length > 0;
		const generation = ++feedLoadGeneration;
		void loadFeedInitial(generation);
	});

	$effect(() => {
		void activeTab;
		void cards.length;
		void currentLoading;
		void canLoadMoreFeed;
		void feedSentinel;
		observeFeedSentinel();
		void maybeAutoLoadFeed();
		return () => {
			resetFeedObserver();
		};
	});

</script>

<svelte:head>
	<title>{$_('nav.explore')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex items-center justify-between">
		<h1 class="text-display text-xl text-[var(--text)]">{$_('nav.explore').toLowerCase()}</h1>
	</div>

	<Tabs tabs={tabs} value={activeTab} onValueChange={setTab} />

	{#if activeTab === 'search'}
		<div class="flex flex-col gap-4">
			<div class="relative">
				<div class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-ghost)]">
					<MagnifyingGlassIcon size={14} />
				</div>
				<input
					type="search"
					placeholder={$_('explore.searchPlaceholder')}
					bind:value={searchQuery}
					oninput={onSearchInput}
					class="h-11 w-full border border-[var(--void-4)] bg-[var(--void-2)] pr-9 pl-9 text-sm text-[var(--text)] transition-colors placeholder:text-[var(--text-ghost)] hover:border-[var(--void-5)] focus:border-[var(--void-6)] focus:outline-none"
				/>
				{#if searchQuery.trim()}
					<button
						type="button"
						class="absolute top-1/2 right-3 -translate-y-1/2 text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
						onclick={() => {
							searchQuery = '';
							if (selectedSourceId && Object.keys(selectedSourceAppliedFilters).length > 0) {
								void runSearch();
							} else {
								loading = false;
							}
						}}
					>
						<XIcon size={14} />
					</button>
				{/if}
			</div>

			{#if searchSources.length > 0}
				<div class="flex flex-col gap-2.5">
					<div class="flex items-center justify-between">
						<span class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase">
							{$_('explore.selectSource')}
						</span>
						{#if selectedSourceId}
							<button
								type="button"
								class="flex items-center gap-1.5 text-[10px] text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
								onclick={() => void openSearchFilters(selectedSourceId)}
							>
								<FunnelIcon size={10} />
								{$_('explore.advancedFilters')}
								{#if hasAppliedSearchFilters}
									<span class="text-[var(--text-muted)]">· {appliedSearchFilterCount}</span>
								{/if}
							</button>
						{/if}
					</div>

					<div class="no-scrollbar flex gap-1.5 overflow-x-auto">
						<button
							type="button"
							class="h-7 shrink-0 px-3 text-[10px] tracking-wider uppercase transition-colors {!selectedSourceId
								? 'bg-[var(--void-4)] text-[var(--text)]'
								: 'text-[var(--text-ghost)] hover:bg-[var(--void-2)] hover:text-[var(--text-muted)]'}"
							onclick={() => {
								selectedSourceId = '';
								if (canRunSearch) void runSearch();
							}}
						>
							{$_('explore.allSources')}
						</button>
						{#each searchSources as source (source.id)}
							<button
								type="button"
								class="h-7 shrink-0 px-3 text-[10px] tracking-wider uppercase transition-colors {selectedSourceId ===
								source.id
									? 'bg-[var(--void-4)] text-[var(--text)]'
									: 'text-[var(--text-ghost)] hover:bg-[var(--void-2)] hover:text-[var(--text-muted)]'}"
								onclick={() => {
									selectedSourceId = source.id;
									if (searchQuery.trim() || appliedSearchFiltersBySource[source.id]) void runSearch();
								}}
							>
								{source.name}{source.lang ? ` [${source.lang}]` : ''}
							</button>
						{/each}
					</div>

					{#if hasAppliedSearchFilters}
						<div class="flex items-center gap-2">
							<div class="h-px flex-1 bg-[var(--void-3)]"></div>
							<button
								type="button"
								class="flex items-center gap-1 text-[10px] text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
								onclick={clearAppliedSearchFilters}
							>
								<XIcon size={10} />
								{$_('common.clear')}
								{appliedSearchFilterCount}
								{appliedSearchFilterCount === 1 ? 'filter' : 'filters'}
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	{#if extensionFilters.length > 0 && activeTab !== 'search'}
		<div class="flex flex-col gap-2">
			<div class="flex items-center justify-between">
				<p class="text-xs text-[var(--text-ghost)]">{$_('explore.filterByExtension')}</p>
				{#if selectedExtensionPkgs.length > 0}
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
					class="inline-flex items-center gap-1 border px-2.5 py-1 text-xs transition-colors {selectedExtensionPkgs.length > 0
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

	{#if error}
		<div class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-4 py-3 text-sm text-[var(--error)]">
			{error}
		</div>
	{/if}

	<div class="flex items-center justify-between text-sm text-[var(--text-ghost)]">
		<p>
			{#if activeTab === 'search'}
				{#if showSearchPrompt}
					{$_('common.search')}
				{:else}
					{cards.length} result{cards.length === 1 ? '' : 's'}
				{/if}
			{:else if activeTab === 'latest'}
				{$_('explore.latestUpdates')}
			{:else}
				Popular
			{/if}
		</p>
		{#if currentLoading}
			<p class="flex items-center gap-1">
				<SpinnerIcon size={14} class="animate-spin" />
				{$_('common.loading')}
			</p>
		{/if}
	</div>

	{#if currentLoading && cards.length === 0}
		<div class="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
			{#each Array(18) as _, i (i)}
				<div class="flex flex-col overflow-hidden border border-[var(--line)] bg-[var(--void-2)]">
					<div class="aspect-[2/3] animate-pulse bg-[var(--void-4)]" style={`animation-delay: ${i * 40}ms`}></div>
					<div class="flex flex-col gap-1.5 p-2">
						<div class="h-2 w-full animate-pulse bg-[var(--void-4)]"></div>
						<div class="h-2 w-3/5 animate-pulse bg-[var(--void-5)]"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if cards.length > 0}
		<div class="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
			{#each cards as item (item.key)}
				<a
					href={buildPreviewHref(item)}
					class="group card-glow relative flex flex-col overflow-hidden border border-[var(--line)] bg-[var(--void-2)] text-left"
					onclick={(event) => handleCardClick(event, item)}
					aria-disabled={openingTitleKey !== null}
				>
					<div class="relative aspect-[2/3] overflow-hidden bg-[var(--void-3)]">
						{#if item.thumbnailUrl}
							<LazyImage
								src={getCachedCoverUrl(item.thumbnailUrl)}
								alt={item.title}
								class="h-full w-full"
								imgClass="transition-transform group-hover:scale-105"
							/>
						{:else}
							<div class="flex h-full w-full items-center justify-center">
								<ImageIcon size={24} class="text-[var(--text-ghost)]" />
							</div>
						{/if}

						{#if item.importedLibraryId}
							<div class="absolute top-1 right-1 flex items-center gap-1 bg-[var(--success)]/85 px-1.5 py-0.5 text-[10px] text-[var(--void-0)]">
								<CheckIcon size={10} />
								<span>{$_('title.inLibrary')}</span>
							</div>
						{/if}

						<div class="absolute bottom-1 left-1 bg-[var(--void-0)]/80 px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
							{item.sourceName}
						</div>

						{#if openingTitleKey === item.key}
							<div class="absolute inset-0 flex items-center justify-center bg-[var(--void-0)]/60 backdrop-blur-[1px]">
								<SpinnerIcon size={18} class="animate-spin text-[var(--text)]" />
							</div>
						{/if}
					</div>

					<div class="flex flex-1 flex-col gap-1 p-2">
						<p class="line-clamp-2 text-xs text-[var(--text)]">{item.title}</p>
					</div>
				</a>
			{/each}
		</div>
		{#if activeTab !== 'search'}
			<div bind:this={feedSentinel} class="h-px w-full" aria-hidden="true"></div>
		{/if}
		{#if activeTab !== 'search' && canLoadMoreFeed}
			<div class="flex items-center justify-center py-4">
				{#if loadingMore}
					<p class="flex items-center gap-2 text-sm text-[var(--text-ghost)]">
						<SpinnerIcon size={14} class="animate-spin" />
						{$_('common.loading')}
					</p>
				{/if}
			</div>
		{/if}
	{:else}
		<div class="flex flex-col items-center gap-4 py-16 text-center">
			<div class="flex h-16 w-16 items-center justify-center border border-[var(--line)] bg-[var(--void-3)]">
				{#if activeTab === 'search'}
					<MagnifyingGlassIcon size={24} class="text-[var(--text-ghost)]" />
				{:else}
					<CompassIcon size={24} class="text-[var(--text-ghost)]" />
				{/if}
			</div>
			<div>
				<p class="text-[var(--text)]">
					{showSearchPrompt ? $_('common.search') : $_('common.noResults')}
				</p>
				<p class="mt-1 text-sm text-[var(--text-ghost)]">
					{showSearchPrompt ? $_('explore.typeToSearch') : $_('explore.tryDifferentSearch')}
				</p>
			</div>
			{#if sources.length === 0}
				<Button variant="outline" onclick={() => goto('/extensions')}>
					{$_('explore.goToExtensions')}
				</Button>
			{/if}
		</div>
	{/if}
</div>

<SlidePanel
	open={searchFiltersOpen}
	title={selectedSource
		? `${selectedSource.name} ${$_('explore.advancedFilters')}`
		: $_('explore.advancedFilters')}
	onclose={closeSearchFilters}
>
	{#if searchFiltersLoading}
		<div class="flex flex-col items-center gap-4 py-12">
			<SpinnerIcon size={24} class="animate-spin text-[var(--text-muted)]" />
			<p class="text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
		</div>
	{:else if searchFiltersError}
		<div class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-4 py-3 text-sm text-[var(--error)]">
			{searchFiltersError}
		</div>
	{:else if searchFiltersData}
		<div class="flex flex-col gap-4">
			{#if searchFiltersData.searchFilters.length === 0}
				<div class="flex flex-col items-center gap-4 py-12 text-center">
					<FunnelIcon size={32} class="text-[var(--text-ghost)]" />
					<p class="text-sm text-[var(--text-ghost)]">{$_('common.empty')}</p>
				</div>
			{:else}
				<div class="flex flex-col gap-4">
					{#each searchFiltersData.searchFilters.filter((filter) => filter.data.visible !== false) as filter (filter.data.key)}
						{@const meta = filter.data}
						<div class="flex flex-col gap-2 border-b border-[var(--line)] pb-4 last:border-b-0">
							<div>
								<p class="text-sm text-[var(--text)]">{meta.title || meta.key}</p>
								{#if meta.summary}
									<p class="mt-1 text-xs text-[var(--text-ghost)]">{meta.summary}</p>
								{/if}
							</div>

							{#if meta.type === 'toggle'}
								<label class="flex items-center gap-3 text-sm text-[var(--text)]">
									<input
										type="checkbox"
										checked={Boolean(getCurrentSearchFilterValue(meta))}
										onchange={(event) => handleSearchFilterChange(meta.key, event.currentTarget.checked)}
									/>
									<span>Enabled</span>
								</label>
							{:else if meta.type === 'list'}
								<select
									class="h-11 border border-[var(--void-4)] bg-[var(--void-2)] px-3 text-sm text-[var(--text)]"
									value={String(getCurrentSearchFilterValue(meta) ?? '')}
									onchange={(event) => handleSearchFilterChange(meta.key, event.currentTarget.value)}
								>
									{#each meta.entry_values ?? [] as value, index (`${meta.key}:${value}:${index}`)}
										<option value={value}>{meta.entries?.[index] ?? value}</option>
									{/each}
								</select>
							{:else if meta.type === 'multi_select'}
								<div class="grid gap-2">
										{#each meta.entry_values ?? [] as value, index (`${meta.key}:${value}:${index}`)}
											<label class="flex items-center gap-3 text-sm text-[var(--text)]">
											<input
												type="checkbox"
												checked={Array.isArray(getCurrentSearchFilterValue(meta)) &&
													(getCurrentSearchFilterValue(meta) as string[]).includes(value)}
												onchange={(event) => toggleMultiSelectValue(meta.key, value, event.currentTarget.checked)}
											/>
											<span>{meta.entries?.[index] ?? value}</span>
										</label>
									{/each}
								</div>
							{:else}
								<input
									class="h-11 border border-[var(--void-4)] bg-[var(--void-2)] px-3 text-sm text-[var(--text)]"
									type="text"
									value={String(getCurrentSearchFilterValue(meta) ?? '')}
									oninput={(event) => handleSearchFilterChange(meta.key, event.currentTarget.value)}
								/>
							{/if}
						</div>
					{/each}
				</div>
				<div class="flex gap-2 pt-2">
					<Button variant="outline" size="sm" onclick={closeSearchFilters}>
						Cancel
					</Button>
					<Button size="sm" onclick={() => void applySearchFilters()}>
						Apply
					</Button>
				</div>
			{/if}
		</div>
	{/if}
</SlidePanel>
