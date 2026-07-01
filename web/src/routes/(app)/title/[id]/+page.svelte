<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { BookIcon, CaretLeftIcon } from 'phosphor-svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import TitleChaptersTab from '$lib/components/title-chapters-tab.svelte';
	import TitleCommentsTab from '$lib/components/title-comments-tab.svelte';
	import TitleEditPanel from '$lib/components/title-edit-panel.svelte';
	import TitleInfoTab from '$lib/components/title-info-tab.svelte';
	import TitlePageHero from '$lib/components/title-page-hero.svelte';
	import TitleReadsTab from '$lib/components/title-reads-tab.svelte';
	import TitleSourceManagementPanel from '$lib/components/title-source-management-panel.svelte';
	import { convexApi } from '$lib/convex/api';
	import { waitForCommand } from '$lib/client/commands';
	import { Alert } from '$lib/elements/alert';
	import { Button } from '$lib/elements/button';
	import TitleSkeleton from '$lib/components/title-skeleton.svelte';
	import { _ } from '$lib/i18n';
	import { navigateBack, navHistoryRevision, resolveNavBackTarget } from '$lib/stores/nav-history';
	import { buildLibraryPath, buildReaderPath, buildTitlePath } from '$lib/utils/routes';
	import {
		directSourceTitleUrlCandidates,
		sourceTitleUrlSearchQueries
	} from '$lib/utils/source-title-url';
	import { TITLE_STATUS } from '$lib/utils/title-status';

	const { data } = $props<{ data: { titleSegment: string | null } }>();

	type ChapterRow = {
		_id: Id<'libraryChapters'>;
		routeSegment?: string | null;
		chapterName: string;
		chapterNumber?: number | null;
		scanlator?: string | null;
		dateUpload?: number | null;
		isRead?: boolean;
		progressPageIndex?: number | null;
		progressUpdatedAt?: number | null;
		downloadStatus: 'missing' | 'queued' | 'downloading' | 'downloaded' | 'failed';
		lastErrorMessage?: string | null;
	};

	type TitleOverview = {
		_id: Id<'libraryTitles'>;
		routeSegment?: string | null;
		title: string;
		sourceId: string;
		sourcePkg: string;
		sourceLang: string;
		titleUrl: string;
		author?: string | null;
		artist?: string | null;
		description?: string | null;
		coverUrl?: string | null;
		localCoverPath?: string | null;
		genre?: string | null;
		status?: number | null;
		userStatus?: {
			id: string;
			key: string;
			label: string;
			position: number;
			isDefault: boolean;
		} | null;
		userRating?: number | null;
		preferredVariantId?: string | null;
		collections: Array<{
			id: string;
			name: string;
			position?: number;
			isDefault?: boolean;
		}>;
		variants: Array<{
			id: string;
			sourceId: string;
			sourcePkg: string;
			sourceLang: string;
			sourceName?: string | null;
			titleUrl: string;
			title: string;
			author?: string | null;
			artist?: string | null;
			description?: string | null;
			coverUrl?: string | null;
			genre?: string | null;
			status?: number | null;
			isInstalled?: boolean;
			isEnabled?: boolean;
			isStale?: boolean;
			isPreferred: boolean;
			lastSyncedAt?: number | null;
			progress: {
				readChapters: number;
				totalChapters: number;
			};
		}>;
		createdAt: number;
		updatedAt: number;
		chapterStats: {
			total: number;
			queued: number;
			downloading: number;
			downloaded: number;
			failed: number;
		};
		readingProgress: {
			startedChapters: number;
			latest: {
				chapterId: Id<'libraryChapters'>;
				pageIndex: number;
				updatedAt: number;
			} | null;
		};
		downloadProfile: {
			enabled: boolean;
			paused: boolean;
			autoDownload: boolean;
			lastCheckedAt?: number | null;
			lastSuccessAt?: number | null;
			lastError?: string | null;
		} | null;
		offlineReadiness: {
			titlePageReady: boolean;
			metadataReady: boolean;
			cachedCover: boolean;
			downloadedChapters: number;
			totalChapters: number;
			fullyDownloaded: boolean;
			missingCoverCache: boolean;
		};
	};

	type TitleComment = {
		_id: Id<'chapterComments'>;
		chapterId: Id<'libraryChapters'>;
		chapterName: string;
		chapterNumber?: number | null;
		pageIndex: number;
		message: string;
		createdAt: number;
		updatedAt: number;
	};

	type SourceItem = {
		id: string;
		name: string;
		lang: string;
		supportsLatest: boolean;
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

	type SimilarTitlesResult = {
		items: (ExploreItem & { score: number; similarityPercent: number | null })[];
		warming: boolean;
	};

	type ImportedLookupResult = {
		sourceId: string;
		titleUrl: string;
		libraryId: string;
		listedInLibrary: boolean;
		routeSegment: string;
	};

	type UserStatusOption = {
		id: string;
		key: string;
		label: string;
		position: number;
		isDefault: boolean;
	};

	type CollectionOption = {
		id: string;
		name: string;
		position: number;
		isDefault: boolean;
		titlesCount?: number;
	};

	let activeTab = $state<'info' | 'chapters' | 'comments' | 'reads'>('info');
	let readSessionBusyId = $state<string | null>(null);
	let startingReadSession = $state(false);
	let showFullDescription = $state(false);
	let showManagementPanel = $state(false);
	let showEditPanel = $state(false);
	let downloadingChapterIds = $state<string[]>([]);
	let updatingDownloadProfile = $state(false);
	let actionError = $state<string | null>(null);
	let prefsSaving = $state(false);
	let metadataRequested = $state(false);
	let readinessRequested = $state(false);
	let chapterHydrationStatus = $state<'idle' | 'syncing' | 'refreshing' | 'failed'>('idle');
	let selectedStatusId = $state<string | null>(null);
	let selectedRating = $state<number>(0);
	let selectedCollectionIds = $state<string[]>([]);
	let sourceManagementError = $state<string | null>(null);
	let sourceStatusRefreshing = $state(false);
	let sourceMatchesLoading = $state(false);
	let sourceMatchesAttempted = $state(false);
	let sourceMatches = $state<ExploreItem[]>([]);
	let linkingVariantKey = $state<string | null>(null);
	let preferredVariantSavingId = $state<string | null>(null);
	let removingVariantId = $state<string | null>(null);
	let normalizingSources = $state(false);
	let lastSourceNormalizationSignature = $state('');
	let lastSyncedPreferenceSignature = $state('');
	let lastMetadataKey = $state('');
	let lastOfflinePreparationKey = $state('');
	let browserOnline = $state(true);
	let coverCacheRequested = $state(false);
	let progressActionChapterId = $state<string | null>(null);

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

	function buildOpenTitleHref(item: ExploreItem) {
		const query = new URLSearchParams({
			source_id: item.sourceId,
			source_pkg: item.sourcePkg,
			source_lang: item.sourceLang,
			title_url: item.titleUrl,
			title: item.title,
			description: item.description ?? '',
			thumbnail_url: item.coverUrl ?? '',
			canonical_key: item.canonicalKey
		});
		return `/title/open?${query.toString()}`;
	}

	function similarTitleLookupKey(item: { sourceId: string; titleUrl: string }) {
		return `${item.sourceId}::${item.titleUrl}`;
	}

	const client = useConvexClient();
	const titleQuery = useQuery(convexApi.library.getMineOverviewByRouteSegment, () =>
		data.titleSegment ? { routeSegment: data.titleSegment } : 'skip'
	);
	const rawTitleQueryData = $derived((titleQuery.data as TitleOverview | null) ?? null);
	const resolvedTitleId = $derived(rawTitleQueryData?._id ?? null);
	const titleChaptersQuery = useQuery(convexApi.library.listTitleChapters, () =>
		resolvedTitleId ? { titleId: resolvedTitleId } : 'skip'
	);
	const titleCommentsQuery = useQuery(convexApi.library.listTitleComments, () =>
		activeTab === 'comments' && resolvedTitleId ? { titleId: resolvedTitleId } : 'skip'
	);
	const titleReadSessionsQuery = useQuery(convexApi.library.listTitleReadSessions, () =>
		resolvedTitleId ? { titleId: resolvedTitleId } : 'skip'
	);
	const titleReadSessions = $derived(
		(titleReadSessionsQuery.data as Array<{
			id: string;
			startedAt: number;
			finishedAt: number | null;
			rating: number | null;
			notes: string | null;
		}> | null) ?? []
	);
	const completedReadCount = $derived(
		titleReadSessions.filter((session) => session.finishedAt !== null).length
	);
	const similarTitlesQuery = useQuery(convexApi.discovery.listSimilarForLibraryTitle, () =>
		resolvedTitleId ? { titleId: resolvedTitleId, limit: 12 } : 'skip'
	);
	const sourcesQuery = useQuery(convexApi.extensions.listSources, () => ({}));
	const statusesQuery = useQuery(convexApi.library.listUserStatuses, () => ({}));
	const collectionsQuery = useQuery(convexApi.library.listCollections, () => ({}));

	const MATCH_SEARCH_CONCURRENCY = 3;
	const MATCH_SEARCH_LIMIT = 12;
	const MATCH_SEARCH_PER_SOURCE_LIMIT = 6;
	const AUTO_MATCH_COMMAND_TIMEOUT_MS = 10_000;
	const MANUAL_MATCH_COMMAND_TIMEOUT_MS = 30_000;

	const title = $derived(rawTitleQueryData);
	const titleChapters = $derived((titleChaptersQuery.data ?? []) as ChapterRow[]);
	const titleComments = $derived((titleCommentsQuery.data ?? []) as TitleComment[]);
	const similarTitlesResult = $derived(
		((similarTitlesQuery.data ?? { items: [], warming: true }) as SimilarTitlesResult) ?? {
			items: [],
			warming: true
		}
	);
	const similarTitlesImportedLookupQuery = useQuery(
		convexApi.library.getMineImportedSourceLookup,
		() =>
			similarTitlesResult.items.length > 0
				? {
						entries: similarTitlesResult.items.map((item) => ({
							sourceId: item.sourceId,
							titleUrl: item.titleUrl
						}))
					}
				: 'skip'
	);
	const similarTitlesImportedLookup = $derived(
		(similarTitlesImportedLookupQuery.data ?? []) as ImportedLookupResult[]
	);
	const similarTitlesImportedLookupByKey = $derived.by(
		() =>
			new Map(
				similarTitlesImportedLookup.map((item) => [similarTitleLookupKey(item), item] as const)
			)
	);
	const similarTitles = $derived(
		similarTitlesResult.items.map((item) => ({
			...item,
			href: (() => {
				const imported = similarTitlesImportedLookupByKey.get(similarTitleLookupKey(item));
				return imported
					? buildTitlePath(imported.libraryId, item.title, imported.routeSegment)
					: buildOpenTitleHref(item);
			})()
		}))
	);
	const sources = $derived((sourcesQuery.data ?? []) as SourceItem[]);
	const availableStatuses = $derived(
		((statusesQuery.data ?? []) as UserStatusOption[]).sort(
			(left, right) => left.position - right.position
		)
	);
	const availableCollections = $derived(
		((collectionsQuery.data ?? []) as CollectionOption[]).sort(
			(left, right) => left.position - right.position
		)
	);
	const loading = $derived(titleQuery.isLoading || titleChaptersQuery.isLoading);
	const errorMessage = $derived.by(() => {
		if (titleQuery.error instanceof Error) return titleQuery.error.message;
		if (titleChaptersQuery.error instanceof Error) return titleChaptersQuery.error.message;
		if (titleCommentsQuery.error instanceof Error) return titleCommentsQuery.error.message;
		return null;
	});

	const titleBackSkipPrefixes = ['/reader/', '/title/'];
	const titleBackTarget = $derived.by(() => {
		const currentUrl = page.url.pathname + page.url.search;
		return resolveNavBackTarget('/library', {
			skipPrefixes: titleBackSkipPrefixes,
			currentUrl,
			revision: $navHistoryRevision
		});
	});
	const backLabel = $derived(
		titleBackTarget?.startsWith('/explore') ? $_('nav.explore') : $_('nav.library')
	);

	const coverSrc = $derived.by(() => {
		if (!title) return null;
		if (title.localCoverPath) {
			const params = new URLSearchParams({ titleId: String(title._id) });
			return `/api/internal/bridge/library/cover?${params.toString()}`;
		}
		if (!browserOnline) return null;
		return title.coverUrl ?? null;
	});

	const genres = $derived.by(() =>
		String(title?.genre ?? '')
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean)
	);
	const readingProgressCount = $derived(title?.readingProgress.startedChapters ?? 0);
	const displayedChapterCount = $derived(
		Math.max(title?.chapterStats.total ?? 0, titleChapters.length)
	);
	const preferredVariantId = $derived.by(
		() =>
			title?.preferredVariantId ??
			title?.variants.find((variant) => variant.isPreferred)?.id ??
			null
	);
	const sourceName = $derived.by(() => {
		if (!title) return '';
		const preferredVariant =
			title.variants.find((variant) => variant.id === preferredVariantId) ?? null;
		return (
			preferredVariant?.sourceName?.trim() ||
			sources.find((item) => item.id === title.sourceId)?.name ||
			title.sourcePkg
		);
	});
	const author = $derived.by(() => String(title?.author ?? '').trim());
	const artist = $derived.by(() => String(title?.artist ?? '').trim());
	const updatesEnabled = $derived(Boolean(title?.downloadProfile?.enabled));
	const linkedSourceKeys = $derived.by(
		() =>
			new Set(
				title?.variants.map((variant) => sourceVariantKey(variant.sourceId, variant.titleUrl)) ?? []
			)
	);
	const enabledMatchSources = $derived.by(() => {
		if (!title) return [] as SourceItem[];
		return [...sources].sort((left, right) => {
			const leftScore = left.lang === title.sourceLang ? 0 : 1;
			const rightScore = right.lang === title.sourceLang ? 0 : 1;
			if (leftScore !== rightScore) return leftScore - rightScore;
			if (left.extensionName !== right.extensionName) {
				return left.extensionName.localeCompare(right.extensionName);
			}
			return left.name.localeCompare(right.name);
		});
	});
	const availableMatchSources = $derived.by(() => {
		if (!title) return [] as SourceItem[];
		const linkedSourceIds = new Set(title.variants.map((variant) => variant.sourceId));
		return enabledMatchSources.filter((source) => !linkedSourceIds.has(source.id));
	});
	const hasStaleVariants = $derived.by(
		() => title?.variants.some((variant) => variant.isStale) ?? false
	);
	const addedAt = $derived(title?.createdAt ?? null);
	const lastReadAt = $derived(title?.readingProgress.latest?.updatedAt ?? null);
	const lastUpdatedAt = $derived(title?.downloadProfile?.lastSuccessAt ?? title?.updatedAt ?? null);
	const startReadingChapter = $derived.by(() => {
		if (!title) return null;
		if (title.readingProgress.latest) {
			return (
				titleChapters.find((chapter) => chapter._id === title.readingProgress.latest?.chapterId) ??
				null
			);
		}
		return titleChapters[0] ?? null;
	});
	const displayStatus = $derived.by(() => {
		const status = Number(title?.status ?? 0);
		if (status === TITLE_STATUS.ONGOING) return $_('status.ongoing');
		if (status === TITLE_STATUS.COMPLETED || status === TITLE_STATUS.COMPLETED_ALT) {
			return $_('status.completed');
		}
		if (status === TITLE_STATUS.HIATUS) return $_('status.hiatus');
		return '';
	});
	const selectedStatus = $derived(
		availableStatuses.find((status) => status.id === selectedStatusId) ?? null
	);
	const selectedCollections = $derived(
		availableCollections.filter((collection) => selectedCollectionIds.includes(collection.id))
	);
	const unselectedCollections = $derived(
		availableCollections.filter((collection) => !selectedCollectionIds.includes(collection.id))
	);
	onMount(() => {
		void Promise.all([
			client.mutation(convexApi.library.ensureDefaultUserStatuses, {}),
			client.mutation(convexApi.library.ensureDefaultCollections, {})
		]);
	});

	$effect(() => {
		if (!title) return;
		const canonicalPath = buildTitlePath(
			String(title._id),
			title.title,
			title.routeSegment ?? null
		);
		if (page.url.pathname !== canonicalPath) {
			void goto(canonicalPath, { replaceState: true, noScroll: true });
		}
	});

	$effect(() => {
		if (!title) return;
		const signature = [
			title._id,
			title.userStatus?.id ?? '',
			String(title.userRating ?? ''),
			[...title.collections.map((collection) => collection.id)].sort().join(',')
		].join('::');
		if (signature === lastSyncedPreferenceSignature) {
			return;
		}

		selectedStatusId = title.userStatus?.id ?? null;
		selectedRating = title.userRating ? Math.round(title.userRating) : 0;
		selectedCollectionIds = title.collections.map((collection) => collection.id);
		lastSyncedPreferenceSignature = signature;
	});

	$effect(() => {
		if (!title || !hasStaleVariants || normalizingSources) return;
		const signature = `${title._id}::${title.variants
			.map((variant) => `${variant.id}:${variant.sourceId}:${variant.isStale ? '1' : '0'}`)
			.join('|')}`;
		if (signature === lastSourceNormalizationSignature) {
			return;
		}
		lastSourceNormalizationSignature = signature;
		void normalizeSourceLinks();
	});

	$effect(() => {
		const key = title ? `${title.sourceId}::${title.titleUrl}` : '';
		if (key === lastMetadataKey) return;
		lastMetadataKey = key;
		metadataRequested = false;
		readinessRequested = false;
		coverCacheRequested = false;
		lastOfflinePreparationKey = '';
		chapterHydrationStatus = 'idle';
	});

	$effect(() => {
		if (!browserOnline || !title || metadataRequested) return;
		if (
			(title.author ?? '').trim() &&
			(title.artist ?? '').trim() &&
			(title.genre ?? '').trim() &&
			Number(title.status ?? 0) > 0 &&
			(title.description ?? '').trim()
		) {
			return;
		}
		const metadataKey = `${title.sourceId}::${title.titleUrl}`;
		metadataRequested = true;
		void (async () => {
			try {
				await client.mutation(convexApi.library.ensureTitleMetadata, {
					titleId: title._id
				});
				if (`${title.sourceId}::${title.titleUrl}` !== metadataKey) {
					return;
				}
			} catch {
				// Leave fields as-is; key reset on navigation/title change enables a later retry.
			}
		})();
	});

	$effect(() => {
		if (!browserOnline || !title || readinessRequested) return;
		if (titleChapters.length > 0) return;
		readinessRequested = true;
		chapterHydrationStatus = 'syncing';
		void (async () => {
			try {
				const titleId = title._id;
				for (let attempt = 0; attempt < 6; attempt += 1) {
					const readiness = await client.mutation(convexApi.library.ensureTitleReady, {
						titleId
					});
					chapterHydrationStatus = readiness.metadataCommandId ? 'refreshing' : 'syncing';
					const chapters = await client.query(convexApi.library.listTitleChapters, {
						titleId
					});
					if (chapters.length > 0) {
						chapterHydrationStatus = 'idle';
						return;
					}
					await new Promise((resolve) => setTimeout(resolve, 1_500));
				}
				chapterHydrationStatus = 'failed';
			} catch {
				readinessRequested = false;
				chapterHydrationStatus = 'failed';
			}
		})();
	});

	$effect(() => {
		if (!browserOnline || !title || coverCacheRequested) return;
		if (title.localCoverPath || !(title.coverUrl ?? '').trim()) return;
		coverCacheRequested = true;
		void (async () => {
			try {
				await client.mutation(convexApi.library.ensureTitleCoverCache, {
					titleId: title._id
				});
			} catch {
				// Leave the current cover state as-is until a later online retry.
			}
		})();
	});

	$effect(() => {
		if (!browserOnline || !title) return;
		const key = `${title._id}:${title.updatedAt}:${title.chapterStats.total}:${title.offlineReadiness.metadataReady}:${title.offlineReadiness.cachedCover}`;
		if (lastOfflinePreparationKey === key) return;
		lastOfflinePreparationKey = key;
		if (
			title.offlineReadiness.metadataReady &&
			title.offlineReadiness.cachedCover &&
			title.chapterStats.total > 0
		) {
			return;
		}
		void (async () => {
			try {
				await client.mutation(convexApi.library.ensureTitlesOfflineReady, {
					titleIds: [title._id],
					limit: 1
				});
			} catch {
				// Leave the current readiness state as-is until title state changes.
			}
		})();
	});

	const isChapterHydrating = $derived(
		Boolean(title) &&
			titleChapters.length === 0 &&
			(chapterHydrationStatus === 'syncing' || chapterHydrationStatus === 'refreshing')
	);
	const chapterHydrationHeadline = $derived.by(() => {
		if (chapterHydrationStatus === 'refreshing') return $_('title.refreshingTitle');
		if (chapterHydrationStatus === 'failed') return $_('title.syncFailed');
		if (chapterHydrationStatus === 'syncing') return $_('title.syncingChapters');
		return $_('title.noChapters');
	});
	const chapterHydrationDescription = $derived.by(() => {
		if (chapterHydrationStatus === 'refreshing') {
			return $_('title.refreshingTitleDescription');
		}
		if (chapterHydrationStatus === 'failed') {
			return $_('title.syncFailedDescription');
		}
		if (chapterHydrationStatus === 'syncing') {
			return $_('title.syncingChaptersDescription');
		}
		return $_('title.noChaptersDescription');
	});

	function sourceDisplayName(
		sourceId: string,
		fallback: string,
		sourceName?: string | null
	): string {
		return sourceName?.trim() || sources.find((source) => source.id === sourceId)?.name || fallback;
	}

	function sourceVariantKey(sourceId: string, titleUrl: string): string {
		return `${sourceId}::${titleUrl}`;
	}

	async function retryTitleHydration() {
		if (!title) return;
		readinessRequested = false;
		chapterHydrationStatus = 'idle';
		await client.mutation(convexApi.library.ensureTitleReady, {
			titleId: title._id
		});
	}

	async function refreshSourceState() {
		if (!title || sourceStatusRefreshing) return;
		sourceStatusRefreshing = true;
		actionError = null;
		try {
			const [metadataResponse, chapterSyncResponse] = await Promise.all([
				client.mutation(convexApi.library.ensureTitleMetadata, {
					titleId: title._id
				}),
				client.mutation(convexApi.library.requestChapterSync, {
					titleId: title._id
				})
			]);
			chapterHydrationStatus = titleChapters.length === 0 ? 'syncing' : 'refreshing';
			const pendingCommands: Promise<unknown>[] = [];
			if (metadataResponse.commandId) {
				pendingCommands.push(waitForCommand(client, metadataResponse.commandId));
			}
			if (chapterSyncResponse.commandId) {
				pendingCommands.push(
					waitForCommand(client, chapterSyncResponse.commandId, {
						timeoutMs: 30_000
					})
				);
			}
			if (pendingCommands.length > 0) {
				await Promise.all(pendingCommands);
			}
			chapterHydrationStatus = 'idle';
		} catch (error) {
			chapterHydrationStatus = titleChapters.length === 0 ? 'failed' : 'idle';
			actionError = error instanceof Error ? error.message : $_('title.sourceRefreshFailed');
		} finally {
			sourceStatusRefreshing = false;
		}
	}

	function handleBack() {
		void navigateBack('/library', { skipPrefixes: titleBackSkipPrefixes });
	}

	function openLibraryPerson(name: string) {
		const normalized = name.trim();
		if (!normalized) return;
		void goto(buildLibraryPath({ person: normalized }));
	}

	function openReadingStart() {
		if (!title || !startReadingChapter) {
			activeTab = 'chapters';
			return;
		}
		void goto(
			buildReaderPath({
				titleId: title._id,
				titleName: title.title,
				titleRouteSegment: title.routeSegment ?? null,
				chapterId: startReadingChapter._id,
				chapterName: startReadingChapter.chapterName,
				chapterNumber: startReadingChapter.chapterNumber ?? null,
				chapterRouteSegment: startReadingChapter.routeSegment ?? null
			})
		);
	}

	function openChapter(chapter: ChapterRow) {
		if (!title) return;
		void goto(
			buildReaderPath({
				titleId: title._id,
				titleName: title.title,
				titleRouteSegment: title.routeSegment ?? null,
				chapterId: chapter._id,
				chapterName: chapter.chapterName,
				chapterNumber: chapter.chapterNumber ?? null,
				chapterRouteSegment: chapter.routeSegment ?? null
			})
		);
	}

	async function downloadChapter(chapterId: Id<'libraryChapters'>) {
		if (downloadingChapterIds.includes(chapterId)) return;
		actionError = null;
		downloadingChapterIds = [...downloadingChapterIds, chapterId];
		try {
			await client.mutation(convexApi.library.requestChapterDownload, { chapterId });
		} catch (error) {
			actionError = error instanceof Error ? error.message : 'Unable to queue chapter download';
		} finally {
			downloadingChapterIds = downloadingChapterIds.filter((id) => id !== chapterId);
		}
	}

	async function resetChapterReadProgress(chapterId: Id<'libraryChapters'>) {
		if (progressActionChapterId === chapterId) return;
		progressActionChapterId = chapterId;
		actionError = null;
		try {
			await client.mutation(convexApi.library.resetChapterProgress, { chapterId });
		} catch (error) {
			actionError = error instanceof Error ? error.message : $_('title.markAsUnread');
		} finally {
			progressActionChapterId = null;
		}
	}

	async function markPreviousChaptersRead(chapterId: Id<'libraryChapters'>) {
		if (!title || progressActionChapterId === chapterId) return;
		progressActionChapterId = chapterId;
		actionError = null;
		try {
			await client.mutation(convexApi.library.markChaptersReadThrough, {
				titleId: title._id,
				chapterId
			});
		} catch (error) {
			actionError = error instanceof Error ? error.message : $_('title.markPreviousRead');
		} finally {
			progressActionChapterId = null;
		}
	}

	async function startReadSession(startedAt: number) {
		if (!title || startingReadSession) return;
		startingReadSession = true;
		actionError = null;
		try {
			await client.mutation(convexApi.library.startReadSession, {
				titleId: title._id,
				startedAt
			});
		} catch (error) {
			actionError = error instanceof Error ? error.message : 'Unable to start read session';
		} finally {
			startingReadSession = false;
		}
	}

	async function finishReadSession(
		sessionId: string,
		finishedAt: number,
		rating: number | null,
		notes: string | null
	) {
		if (readSessionBusyId) return;
		readSessionBusyId = sessionId;
		actionError = null;
		try {
			await client.mutation(convexApi.library.finishReadSession, {
				sessionId: sessionId as Id<'titleReadSessions'>,
				finishedAt,
				rating: rating ?? undefined,
				notes: notes ?? undefined
			});
		} catch (error) {
			actionError = error instanceof Error ? error.message : 'Unable to finish read session';
		} finally {
			readSessionBusyId = null;
		}
	}

	async function updateReadSession(
		sessionId: string,
		patch: {
			startedAt?: number;
			finishedAt?: number | null;
			rating?: number | null;
			notes?: string | null;
		}
	) {
		if (readSessionBusyId) return;
		readSessionBusyId = sessionId;
		actionError = null;
		try {
			await client.mutation(convexApi.library.updateReadSession, {
				sessionId: sessionId as Id<'titleReadSessions'>,
				...patch
			});
		} catch (error) {
			actionError = error instanceof Error ? error.message : 'Unable to update read session';
		} finally {
			readSessionBusyId = null;
		}
	}

	async function deleteReadSession(sessionId: string) {
		if (readSessionBusyId) return;
		readSessionBusyId = sessionId;
		actionError = null;
		try {
			await client.mutation(convexApi.library.deleteReadSession, {
				sessionId: sessionId as Id<'titleReadSessions'>
			});
		} catch (error) {
			actionError = error instanceof Error ? error.message : 'Unable to delete read session';
		} finally {
			readSessionBusyId = null;
		}
	}

	async function toggleDownloadUpdates() {
		if (!title || updatingDownloadProfile) return;
		updatingDownloadProfile = true;
		actionError = null;
		try {
			await client.mutation(convexApi.library.updateDownloadProfile, {
				titleId: title._id,
				enabled: !updatesEnabled
			});
		} catch (cause) {
			actionError = cause instanceof Error ? cause.message : 'Unable to update downloads';
		} finally {
			updatingDownloadProfile = false;
		}
	}

	async function commitPrefs() {
		if (!title) return;
		prefsSaving = true;
		try {
			await client.mutation(convexApi.library.updateTitlePreferences, {
				titleId: title._id,
				userStatusId: selectedStatusId ? (selectedStatusId as Id<'libraryUserStatuses'>) : null,
				userRating: selectedRating > 0 ? selectedRating : null,
				collectionIds: selectedCollectionIds as Id<'libraryCollections'>[]
			});
		} catch (cause) {
			actionError = cause instanceof Error ? cause.message : 'Unable to save';
		} finally {
			prefsSaving = false;
		}
	}

	function setStatus(statusId: string | null) {
		if (selectedStatusId === statusId) return;
		selectedStatusId = statusId;
		void commitPrefs();
	}

	function setRating(value: number) {
		const next = selectedRating === value ? 0 : value;
		if (selectedRating === next) return;
		selectedRating = next;
		void commitPrefs();
	}

	function toggleCollection(collectionId: string) {
		selectedCollectionIds = selectedCollectionIds.includes(collectionId)
			? selectedCollectionIds.filter((id) => id !== collectionId)
			: [...selectedCollectionIds, collectionId];
		void commitPrefs();
	}

	async function runWithConcurrency<T>(
		items: T[],
		limit: number,
		worker: (item: T) => Promise<void>
	) {
		const concurrency = Math.max(1, limit);
		let index = 0;
		await Promise.all(
			Array.from({ length: Math.min(concurrency, items.length) }, async () => {
				while (index < items.length) {
					const current = items[index];
					index += 1;
					await worker(current);
				}
			})
		);
	}

	function normalizeMatchTitle(value: string) {
		return value
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^\p{L}\p{N}]+/gu, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	function uniqueMatchQueries() {
		if (!title) return [] as string[];
		const seen: Record<string, true> = {};
		const queries: string[] = [];
		const slugQueries = title.variants.flatMap((variant) =>
			sourceTitleUrlSearchQueries(variant.titleUrl)
		);
		for (const candidate of [
			title.variants.map((variant) => variant.title),
			title.title,
			slugQueries
		].flat()) {
			const trimmed = candidate.trim();
			const normalized = normalizeMatchTitle(trimmed);
			if (!normalized || seen[normalized] === true) continue;
			seen[normalized] = true;
			queries.push(trimmed);
		}
		return queries.slice(0, 6);
	}

	function sourceMatchScore(query: string, item: ExploreItem) {
		if (!title) return 0;
		const normalizedQuery = normalizeMatchTitle(query);
		const normalizedTitle = normalizeMatchTitle(item.title);
		if (!normalizedQuery) return 0;

		let score = 0;
		if (normalizedTitle) {
			if (normalizedTitle === normalizedQuery) {
				score += 120;
			} else if (normalizedTitle.startsWith(normalizedQuery)) {
				score += 95;
			} else if (normalizedTitle.includes(normalizedQuery)) {
				score += 75 - Math.min(20, Math.max(0, normalizedTitle.length - normalizedQuery.length));
			}
		}

		const queryTokens = normalizedQuery.split(' ').filter((token) => token.length > 1);
		const titleTokens = Object.fromEntries(
			normalizedTitle
				.split(' ')
				.filter((token) => token.length > 1)
				.map((token) => [token, true] as const)
		);
		if (queryTokens.length > 0) {
			const overlap = queryTokens.filter((token) => titleTokens[token] === true).length;
			score += Math.round((overlap / queryTokens.length) * 45);
		}

		if (item.sourceLang === title.sourceLang) {
			score += 10;
		}

		const urlSlugMatches = sourceTitleUrlSearchQueries(item.titleUrl)
			.map(normalizeMatchTitle)
			.filter(Boolean);
		if (urlSlugMatches.includes(normalizedQuery)) {
			score += 130;
		} else if (urlSlugMatches.some((slug) => slug.includes(normalizedQuery))) {
			score += 80;
		}

		if (normalizedTitle.includes('doujinshi')) score -= 70;
		if (normalizedTitle.includes('anthology')) score -= 35;
		if (normalizedTitle.includes('fan colored')) score -= 20;
		if (normalizedTitle.includes('official colored')) score -= 10;

		return score;
	}

	function sourceMatchScoreForQueries(queries: string[], item: ExploreItem) {
		return queries.reduce((best, query) => Math.max(best, sourceMatchScore(query, item)), 0);
	}

	function isSameExtensionUrlMatch(item: ExploreItem) {
		if (!title) return false;
		return title.variants.some(
			(variant) =>
				variant.sourcePkg === item.sourcePkg && variant.titleUrl.trim() === item.titleUrl.trim()
		);
	}

	async function loadSourceMatches(options?: {
		manual?: boolean;
		query?: string;
		sourceId?: string;
	}) {
		if (!title || sourceMatchesLoading) return;

		const manual = options?.manual === true;
		const query = (manual ? options?.query : title.title)?.trim() || title.title;
		const suggestionQueries = manual ? [query] : uniqueMatchQueries();
		const rankedQueries = suggestionQueries.length > 0 ? suggestionQueries : [query];
		const candidateSources = manual
			? options?.sourceId
				? enabledMatchSources.filter((source) => source.id === options.sourceId)
				: enabledMatchSources
			: availableMatchSources;
		if (candidateSources.length === 0) {
			sourceMatches = [];
			sourceMatchesAttempted = true;
			return;
		}

		sourceMatchesLoading = true;
		sourceMatchesAttempted = true;
		sourceManagementError = null;

		try {
			const collected: ExploreItem[] = [];
			const buildRankedMatches = () => {
				const deduped: Record<string, ExploreItem> = {};
				for (const item of collected) {
					const key = sourceVariantKey(item.sourceId, item.titleUrl);
					if (linkedSourceKeys.has(key) || deduped[key]) {
						continue;
					}
					deduped[key] = item;
				}

				return Object.values(deduped)
					.map((item) => ({
						item,
						score:
							sourceMatchScoreForQueries(manual ? [query] : rankedQueries, item) +
							(isSameExtensionUrlMatch(item) ? 250 : 0)
					}))
					.filter(({ item, score }) => manual || isSameExtensionUrlMatch(item) || score >= 55)
					.sort((left, right) => right.score - left.score)
					.slice(0, MATCH_SEARCH_LIMIT)
					.map(({ item }) => item);
			};
			const syncMatches = () => {
				sourceMatches = buildRankedMatches();
			};
			const commandTimeoutMs = manual
				? MANUAL_MATCH_COMMAND_TIMEOUT_MS
				: AUTO_MATCH_COMMAND_TIMEOUT_MS;
			const fetchDirectVariant = async (source: SourceItem, titleUrl: string) => {
				const { commandId } = await client.mutation(convexApi.commands.enqueueExploreTitleFetch, {
					sourceId: source.id,
					titleUrl,
					contextKey: String(title._id)
				});
				const command = await waitForCommand(client, commandId, {
					timeoutMs: commandTimeoutMs
				});
				const resolved = (command.result?.title as Record<string, unknown> | undefined) ?? {};
				const resolvedTitle = String(resolved.title ?? '').trim();
				const resolvedUrl = String(resolved.titleUrl ?? titleUrl).trim();
				if (!resolvedTitle || !resolvedUrl) return;
				collected.push({
					canonicalKey: String(resolved.canonicalKey ?? `${source.id}::${resolvedUrl}`),
					sourceId: source.id,
					sourcePkg: String(resolved.sourcePkg ?? source.extensionPkg),
					sourceLang: String(resolved.sourceLang ?? source.lang),
					sourceName: source.name,
					titleUrl: resolvedUrl,
					title: resolvedTitle,
					description: typeof resolved.description === 'string' ? resolved.description : undefined,
					coverUrl: typeof resolved.coverUrl === 'string' ? resolved.coverUrl : null
				});
				syncMatches();
			};
			const searchSource = async (source: SourceItem, searchQuery: string) => {
				const { commandId } = await client.mutation(convexApi.commands.enqueueExploreSearch, {
					query: searchQuery,
					sourceId: source.id,
					limit: MATCH_SEARCH_PER_SOURCE_LIMIT
				});
				const command = await waitForCommand(client, commandId, {
					timeoutMs: commandTimeoutMs
				});
				const items = ((command.result?.items as ExploreItem[] | undefined) ?? []) as ExploreItem[];
				collected.push(...items);
				syncMatches();
			};
			const searchSourceBatch = async (sourceBatch: SourceItem[]) => {
				await runWithConcurrency(sourceBatch, MATCH_SEARCH_CONCURRENCY, async (source) => {
					if (manual) {
						const directTitleUrlCandidates = directSourceTitleUrlCandidates(query);
						if (directTitleUrlCandidates.length > 0) {
							let lastError: unknown = null;
							for (const titleUrl of directTitleUrlCandidates) {
								try {
									await fetchDirectVariant(source, titleUrl);
									return;
								} catch (cause) {
									lastError = cause;
								}
							}
							if (lastError) {
								throw lastError;
							}
							return;
						}
						await searchSource(source, query);
						return;
					}

					const sameExtensionUrls = [
						...new Set(
							title.variants
								.filter((variant) => variant.sourcePkg === source.extensionPkg)
								.map((variant) => variant.titleUrl)
								.filter((titleUrl) => titleUrl.trim().length > 0)
						)
					];
					if (sameExtensionUrls.length > 0) {
						for (const titleUrl of sameExtensionUrls) {
							try {
								await fetchDirectVariant(source, titleUrl);
								return;
							} catch {
								continue;
							}
						}
					}

					const quickQuery = rankedQueries[0] ?? query;
					if (!quickQuery) return;
					try {
						await searchSource(source, quickQuery);
					} catch {
						// Quick match is best-effort. Keep partial matches from other sources.
					}
				});
			};

			if (manual) {
				await searchSourceBatch(candidateSources);
				syncMatches();
			} else {
				const batchSize = 6;
				sourceMatches = [];
				for (let index = 0; index < candidateSources.length; index += batchSize) {
					await searchSourceBatch(candidateSources.slice(index, index + batchSize));
					if (sourceMatches.length >= Math.min(6, MATCH_SEARCH_LIMIT)) {
						break;
					}
				}
			}
		} catch (cause) {
			sourceManagementError =
				cause instanceof Error && cause.message.includes('Command timed out')
					? $_('title.sourceMatchFailed')
					: cause instanceof Error
						? cause.message
						: $_('title.sourceMatchFailed');
			sourceMatches = [];
		} finally {
			sourceMatchesLoading = false;
		}
	}

	async function choosePreferredVariant(variantId: string) {
		if (!title || preferredVariantSavingId) return;
		preferredVariantSavingId = variantId;
		sourceManagementError = null;
		try {
			await client.mutation(convexApi.library.updateTitlePreferences, {
				titleId: title._id,
				preferredVariantId: variantId as Id<'titleVariants'>
			});
		} catch (cause) {
			sourceManagementError = cause instanceof Error ? cause.message : $_('title.sourceLinkFailed');
		} finally {
			preferredVariantSavingId = null;
		}
	}

	async function linkSourceVariant(item: ExploreItem) {
		if (!title || linkingVariantKey) return;

		const variantKey = sourceVariantKey(item.sourceId, item.titleUrl);
		linkingVariantKey = variantKey;
		sourceManagementError = null;
		try {
			await client.mutation(convexApi.library.linkVariant, {
				titleId: title._id,
				sourceId: item.sourceId,
				sourcePkg: item.sourcePkg,
				sourceLang: item.sourceLang,
				titleUrl: item.titleUrl,
				title: item.title,
				description: item.description ?? null,
				coverUrl: item.coverUrl ?? null,
				author: null,
				artist: null,
				genre: null,
				status: null
			});
			sourceMatches = sourceMatches.filter(
				(result) => sourceVariantKey(result.sourceId, result.titleUrl) !== variantKey
			);
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : '';
			sourceManagementError = message.includes('Linked to another title')
				? $_('title.linkedElsewhere')
				: $_('title.sourceLinkFailed');
		} finally {
			linkingVariantKey = null;
		}
	}

	async function removeSourceVariant(variantId: string) {
		if (!title || removingVariantId) return;
		removingVariantId = variantId;
		sourceManagementError = null;
		try {
			await client.mutation(convexApi.library.removeVariant, {
				titleId: title._id,
				variantId: variantId as Id<'titleVariants'>
			});
		} catch (cause) {
			sourceManagementError =
				cause instanceof Error ? cause.message : $_('title.sourceRemoveFailed');
		} finally {
			removingVariantId = null;
		}
	}

	async function normalizeSourceLinks() {
		if (!title || normalizingSources) return;
		normalizingSources = true;
		sourceManagementError = null;
		try {
			await client.mutation(convexApi.library.normalizeTitleVariants, {
				titleId: title._id
			});
		} catch (cause) {
			sourceManagementError =
				cause instanceof Error ? cause.message : $_('title.sourceRepairFailed');
		} finally {
			normalizingSources = false;
		}
	}
</script>

<svelte:head>
	<title>{title?.title || $_('common.loading')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex min-w-0 flex-col overflow-x-hidden">
	<div class="mb-6 hidden items-center gap-2 md:flex">
		<Button variant="ghost" size="icon-sm" onclick={handleBack}>
			<CaretLeftIcon size={18} />
		</Button>
		<span class="text-xs text-[var(--text-ghost)]">{backLabel}</span>
	</div>

	{#if loading && !title}
		<TitleSkeleton phaseLabel={$_('common.loading')} />
	{:else if title}
		<TitlePageHero
			title={title.title}
			{coverSrc}
			{author}
			{artist}
			chapterStatsTotal={displayedChapterCount}
			{readingProgressCount}
			hasReadingProgress={Boolean(title.readingProgress.latest)}
			{isChapterHydrating}
			{chapterHydrationHeadline}
			{selectedStatus}
			{availableStatuses}
			{selectedCollections}
			{unselectedCollections}
			{updatesEnabled}
			{updatingDownloadProfile}
			{prefsSaving}
			{selectedRating}
			onOpenPerson={openLibraryPerson}
			onBack={handleBack}
			onOpenReadingStart={openReadingStart}
			onOpenManagement={() => (showManagementPanel = true)}
			onOpenEdit={() => (showEditPanel = true)}
			onSetStatus={setStatus}
			onToggleDownloadUpdates={toggleDownloadUpdates}
			onToggleCollection={toggleCollection}
			onSetRating={setRating}
		>
			{#if actionError}
				<Alert variant="error" class="mt-3">{actionError}</Alert>
			{/if}

			<div class="mt-8 flex gap-1">
				<button
					type="button"
					class="px-3 py-1.5 text-xs transition-colors {activeTab === 'info'
						? 'bg-[var(--void-4)] text-[var(--text)]'
						: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
					onclick={() => (activeTab = 'info')}
				>
					{$_('title.info')}
				</button>
				<button
					type="button"
					class="px-3 py-1.5 text-xs transition-colors {activeTab === 'chapters'
						? 'bg-[var(--void-4)] text-[var(--text)]'
						: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
					onclick={() => (activeTab = 'chapters')}
				>
					{$_('title.chapters')}
					<span
						class="ml-1 text-[10px] {activeTab === 'chapters'
							? 'text-[var(--text-muted)]'
							: 'text-[var(--void-6)]'}"
					>
						{displayedChapterCount}
					</span>
				</button>
				<button
					type="button"
					class="px-3 py-1.5 text-xs transition-colors {activeTab === 'comments'
						? 'bg-[var(--void-4)] text-[var(--text)]'
						: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
					onclick={() => (activeTab = 'comments')}
				>
					{$_('title.comments')}
				</button>
				<button
					type="button"
					class="px-3 py-1.5 text-xs transition-colors {activeTab === 'reads'
						? 'bg-[var(--void-4)] text-[var(--text)]'
						: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
					onclick={() => (activeTab = 'reads')}
				>
					{$_('title.reads')}
					{#if completedReadCount > 0}
						<span
							class="ml-1 text-[10px] {activeTab === 'reads'
								? 'text-[var(--text-muted)]'
								: 'text-[var(--void-6)]'}"
						>
							{completedReadCount}
						</span>
					{/if}
				</button>
			</div>

			<div class="mt-4">
				{#if activeTab === 'info'}
					<TitleInfoTab
						description={title.description ?? null}
						{showFullDescription}
						onToggleDescription={() => (showFullDescription = !showFullDescription)}
						{genres}
						{author}
						{artist}
						onOpenPerson={openLibraryPerson}
						{displayStatus}
						{sourceName}
						sourceLang={title.sourceLang}
						{addedAt}
						{lastReadAt}
						{lastUpdatedAt}
						{similarTitles}
						similarTitlesLoading={similarTitlesQuery.isLoading}
						similarTitlesWarming={similarTitlesResult.warming}
					/>
				{:else if activeTab === 'chapters'}
					<TitleChaptersTab
						{titleChapters}
						{chapterHydrationStatus}
						{chapterHydrationHeadline}
						{chapterHydrationDescription}
						{downloadingChapterIds}
						onRetryHydration={() => void retryTitleHydration()}
						onOpenChapter={(chapter) => openChapter(chapter as ChapterRow)}
						onDownloadChapter={(chapterId) =>
							void downloadChapter(chapterId as Id<'libraryChapters'>)}
						onResetChapterProgress={(chapterId) =>
							void resetChapterReadProgress(chapterId as Id<'libraryChapters'>)}
						onMarkPreviousRead={(chapterId) =>
							void markPreviousChaptersRead(chapterId as Id<'libraryChapters'>)}
						onFetchNewChapters={() => void refreshSourceState()}
						fetchingNewChapters={sourceStatusRefreshing}
						{progressActionChapterId}
					/>
				{:else if activeTab === 'comments'}
					<TitleCommentsTab loading={titleCommentsQuery.isLoading} {titleComments} />
				{:else}
					<TitleReadsTab
						sessions={titleReadSessions}
						loading={titleReadSessionsQuery.isLoading}
						busySessionId={readSessionBusyId}
						startingSession={startingReadSession}
						onStartSession={(startedAt) => void startReadSession(startedAt)}
						onFinishSession={(sessionId, finishedAt, rating, notes) =>
							void finishReadSession(sessionId, finishedAt, rating, notes)}
						onUpdateSession={(sessionId, patch) => void updateReadSession(sessionId, patch)}
						onDeleteSession={(sessionId) => void deleteReadSession(sessionId)}
					/>
				{/if}
			</div>
		</TitlePageHero>
	{:else}
		<div class="flex flex-col items-center gap-4 py-20 text-center">
			<BookIcon size={28} class="text-[var(--void-6)]" />
			<div>
				<p class="text-sm text-[var(--text-ghost)]">{$_('title.notFound')}</p>
				<p class="mt-1 text-xs text-[var(--void-6)]">
					{errorMessage || $_('title.notFoundDescription')}
				</p>
			</div>
			<Button variant="outline" onclick={handleBack}>{$_('title.backToLibrary')}</Button>
		</div>
	{/if}
</div>

{#if title}
	<TitleEditPanel open={showEditPanel} {title} onclose={() => (showEditPanel = false)} />
{/if}

{#if title}
	<TitleSourceManagementPanel
		open={showManagementPanel}
		{title}
		{hasStaleVariants}
		{preferredVariantId}
		{preferredVariantSavingId}
		{removingVariantId}
		{linkingVariantKey}
		{normalizingSources}
		{sourceStatusRefreshing}
		{sourceMatchesLoading}
		{sourceMatchesAttempted}
		{sourceMatches}
		{sourceManagementError}
		{enabledMatchSources}
		{sourceDisplayName}
		onclose={() => (showManagementPanel = false)}
		onRefreshSource={() => void refreshSourceState()}
		onNormalizeSources={() => void normalizeSourceLinks()}
		onChoosePreferredVariant={(variantId) => void choosePreferredVariant(variantId)}
		onRemoveSourceVariant={(variantId) => void removeSourceVariant(variantId)}
		onLoadSourceMatches={(options) => void loadSourceMatches(options)}
		onLinkSourceVariant={(item) => void linkSourceVariant(item as ExploreItem)}
	/>
{/if}
