<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import {
		BookIcon,
		CaretLeftIcon,
		CheckIcon,
		DownloadIcon,
		GearIcon,
		PlayIcon,
		StarIcon,
		SpinnerIcon
	} from 'phosphor-svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import { convexApi } from '$lib/convex/api';
	import { waitForCommand } from '$lib/client/commands';
	import { Button } from '$lib/elements/button';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { _ } from '$lib/i18n';
	import { navigateBack, navHistoryRevision, resolveNavBackTarget } from '$lib/stores/nav-history';
	import { panelOverlayOpen } from '$lib/stores/ui';
	import {
		formatChapterNumberValue,
		hasDisplayableChapterNumber,
		parseStructuredChapterName
	} from '$lib/utils/chapter-display';
	import { buildReaderPath, buildTitlePath } from '$lib/utils/routes';
	import { TITLE_STATUS } from '$lib/utils/title-status';

	const { data } = $props<{ data: { titleId: string } }>();

	type ChapterRow = {
		_id: Id<'libraryChapters'>;
		chapterName: string;
		chapterNumber?: number | null;
		scanlator?: string | null;
		dateUpload?: number | null;
		downloadStatus: 'missing' | 'queued' | 'downloading' | 'downloaded' | 'failed';
		lastErrorMessage?: string | null;
	};

	type TitleDetail = {
		_id: Id<'libraryTitles'>;
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
		titleComments: Array<{
			_id: Id<'chapterComments'>;
			chapterId: Id<'libraryChapters'>;
			chapterName: string;
			chapterNumber?: number | null;
			pageIndex: number;
			message: string;
			createdAt: number;
			updatedAt: number;
		}>;
		downloadProfile: {
			enabled: boolean;
			paused: boolean;
			autoDownload: boolean;
			lastCheckedAt?: number | null;
			lastSuccessAt?: number | null;
			lastError?: string | null;
		} | null;
		chapters: ChapterRow[];
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

	const client = useConvexClient();
	const titleQuery = useQuery(convexApi.library.getMineById, () => ({
		titleId: data.titleId as Id<'libraryTitles'>
	}));
	const sourcesQuery = useQuery(convexApi.extensions.listSources, () => ({}));
	const statusesQuery = useQuery(convexApi.library.listUserStatuses, () => ({}));
	const collectionsQuery = useQuery(convexApi.library.listCollections, () => ({}));

	const MATCH_SEARCH_CONCURRENCY = 3;
	const MATCH_SEARCH_LIMIT = 12;
	const MATCH_SEARCH_PER_SOURCE_LIMIT = 6;

	let activeTab = $state<'info' | 'chapters' | 'comments'>('info');
	let showFullDescription = $state(false);
	let showManagementPanel = $state(false);
	let downloadingChapterIds = $state<string[]>([]);
	let updatingDownloadProfile = $state(false);
	let preferencesSaving = $state(false);
	let actionError = $state<string | null>(null);
	let preferencesError = $state<string | null>(null);
	let preferencesSuccess = $state(false);
	let metadataRequested = $state(false);
	let readinessRequested = $state(false);
	let selectedStatusId = $state<string | null>(null);
	let selectedRating = $state<number>(0);
	let selectedCollectionIds = $state<string[]>([]);
	let sourceManagementError = $state<string | null>(null);
	let sourceMatchesOpen = $state(false);
	let sourceMatchesLoading = $state(false);
	let sourceMatchesAttempted = $state(false);
	let sourceMatches = $state<ExploreItem[]>([]);
	let manualSearchOpen = $state(false);
	let manualSearchQuery = $state('');
	let manualSearchSourceId = $state('');
	let linkingVariantKey = $state<string | null>(null);
	let preferredVariantSavingId = $state<string | null>(null);
	let removingVariantId = $state<string | null>(null);
	let normalizingSources = $state(false);
	let lastSourceNormalizationSignature = $state('');
	let lastSyncedPreferenceSignature = $state('');
	let lastMetadataKey = $state('');

	const title = $derived((titleQuery.data as TitleDetail | null) ?? null);
	const sources = $derived((sourcesQuery.data ?? []) as SourceItem[]);
	const availableStatuses = $derived(
		((statusesQuery.data ?? []) as UserStatusOption[]).sort((left, right) => left.position - right.position)
	);
	const availableCollections = $derived(
		((collectionsQuery.data ?? []) as CollectionOption[]).sort(
			(left, right) => left.position - right.position
		)
	);
	const loading = $derived(titleQuery.isLoading);
	const errorMessage = $derived(
		titleQuery.error instanceof Error ? titleQuery.error.message : null
	);

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
			const params = new URLSearchParams({ path: title.localCoverPath });
			return `/api/internal/bridge/library/cover?${params.toString()}`;
		}
		return title.coverUrl ?? null;
	});

	const genres = $derived.by(() =>
		String(title?.genre ?? '')
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean)
	);
	const sourcesCount = $derived(title?.variants.length ?? (title ? 1 : 0));
	const readingProgressCount = $derived(title?.readingProgress.startedChapters ?? 0);
	const preferredVariantId = $derived.by(
		() => title?.preferredVariantId ?? title?.variants.find((variant) => variant.isPreferred)?.id ?? null
	);
	const sourceName = $derived.by(() => {
		if (!title) return '';
		const preferredVariant = title.variants.find((variant) => variant.id === preferredVariantId) ?? null;
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
		() => new Set(title?.variants.map((variant) => sourceVariantKey(variant.sourceId, variant.titleUrl)) ?? [])
	);
	const availableMatchSources = $derived.by(() => {
		if (!title) return [] as SourceItem[];
		const linkedSourceIds = new Set(title.variants.map((variant) => variant.sourceId));
		return [...sources]
			.filter((source) => !linkedSourceIds.has(source.id))
			.sort((left, right) => {
				const leftScore = left.lang === title.sourceLang ? 0 : 1;
				const rightScore = right.lang === title.sourceLang ? 0 : 1;
				if (leftScore !== rightScore) return leftScore - rightScore;
				if (left.extensionName !== right.extensionName) {
					return left.extensionName.localeCompare(right.extensionName);
				}
				return left.name.localeCompare(right.name);
			});
	});
	const hasStaleVariants = $derived.by(() => title?.variants.some((variant) => variant.isStale) ?? false);
	const chaptersLabel = $derived.by(() =>
		`${title?.chapterStats.total ?? 0} ${$_('title.chapters').toLowerCase()}`
	);
	const sourcesLabel = $derived.by(() => `${sourcesCount} ${$_('title.sources').toLowerCase()}`);
	const startReadingChapter = $derived.by(() => {
		if (!title) return null;
		if (title.readingProgress.latest) {
			return (
				title.chapters.find((chapter) => chapter._id === title.readingProgress.latest?.chapterId) ?? null
			);
		}
		return title.chapters.length ? title.chapters.at(-1) ?? null : null;
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
	const preferencesDirty = $derived.by(() => {
		if (!title) {
			return false;
		}

		const currentStatusId = title.userStatus?.id ?? null;
		const currentRating = title.userRating ? Math.round(title.userRating) : 0;
		const currentCollectionIds = [...title.collections.map((collection) => collection.id)].sort();
		const nextCollectionIds = [...selectedCollectionIds].sort();

		return (
			currentStatusId !== selectedStatusId ||
			currentRating !== selectedRating ||
			currentCollectionIds.join(',') !== nextCollectionIds.join(',')
		);
	});

	$effect(() => {
		panelOverlayOpen.set(showManagementPanel);
		return () => panelOverlayOpen.set(false);
	});

	onMount(() => {
		void Promise.all([
			client.mutation(convexApi.library.ensureDefaultUserStatuses, {}),
			client.mutation(convexApi.library.ensureDefaultCollections, {})
		]);
	});

	$effect(() => {
		if (!title) return;
		const canonicalPath = buildTitlePath(title._id, title.title);
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
		if (availableMatchSources.length === 0) {
			if (manualSearchSourceId !== '') {
				manualSearchSourceId = '';
			}
			return;
		}

		if (
			manualSearchSourceId &&
			availableMatchSources.some((source) => source.id === manualSearchSourceId)
		) {
			return;
		}

		const nextSource = availableMatchSources[0]?.id ?? '';
		if (manualSearchSourceId !== nextSource) {
			manualSearchSourceId = nextSource;
		}
	});

	$effect(() => {
		const key = title ? `${title.sourceId}::${title.titleUrl}` : '';
		if (key === lastMetadataKey) return;
		lastMetadataKey = key;
		metadataRequested = false;
		readinessRequested = false;
	});

	$effect(() => {
		if (!title || metadataRequested) return;
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
		if (!title || readinessRequested) return;
		if (title.chapters.length > 0) return;
		readinessRequested = true;
		void (async () => {
			try {
				await client.mutation(convexApi.library.ensureTitleReady, {
					titleId: title._id
				});
			} catch {
				readinessRequested = false;
			}
		})();
	});

	function formatDate(value?: number | null): string {
		if (!value) return '';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		return date.toLocaleDateString();
	}

	function formatTimestamp(value: number): string {
		return new Date(value).toLocaleString();
	}

	function sourceDisplayName(sourceId: string, fallback: string, sourceName?: string | null): string {
		return sourceName?.trim() || sources.find((source) => source.id === sourceId)?.name || fallback;
	}

	function sourceVariantKey(sourceId: string, titleUrl: string): string {
		return `${sourceId}::${titleUrl}`;
	}

	function chapterLabel(chapter: ChapterRow): string {
		if (hasDisplayableChapterNumber(chapter.chapterNumber)) {
			return $_('chapter.chapterShort', {
				values: { number: formatChapterNumberValue(chapter.chapterNumber) }
			});
		}
		const parsed = parseStructuredChapterName(chapter.chapterName);
		if (parsed) {
			const parts: string[] = [];
			if (parsed.volumeNumber) {
				parts.push($_('chapter.volumeShort', { values: { number: parsed.volumeNumber } }));
			}
			if (parsed.chapterNumber) {
				parts.push($_('chapter.chapterShort', { values: { number: parsed.chapterNumber } }));
			}
			if (parts.length > 0) {
				return parts.join(' · ');
			}
		}
		return chapter.chapterName || $_('title.noChapters');
	}

	function chapterDetail(chapter: ChapterRow): string | null {
		const raw = chapter.chapterName.trim();
		if (!raw) return null;
		if (hasDisplayableChapterNumber(chapter.chapterNumber)) {
			const chapterShort = $_('chapter.chapterShort', {
				values: { number: formatChapterNumberValue(chapter.chapterNumber) }
			});
			if (raw === chapterShort) return null;
			return raw;
		}
		const parsed = parseStructuredChapterName(raw);
		if (parsed) {
			return parsed.detail;
		}
		return raw;
	}

	function chapterDownloadState(chapter: ChapterRow): string | null {
		if (chapter.downloadStatus === 'downloaded') return $_('chapter.downloaded');
		if (chapter.downloadStatus === 'downloading') return $_('chapter.downloading');
		if (chapter.downloadStatus === 'queued') return $_('downloads.queued');
		if (chapter.downloadStatus === 'failed') return $_('downloads.failed');
		return null;
	}

	function handleBack() {
		void navigateBack('/library', { skipPrefixes: titleBackSkipPrefixes });
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
				chapterId: startReadingChapter._id,
				chapterName: startReadingChapter.chapterName,
				chapterNumber: startReadingChapter.chapterNumber ?? null
			})
		);
	}

	function openChapter(chapter: ChapterRow) {
		if (!title) return;
		void goto(
			buildReaderPath({
				titleId: title._id,
				titleName: title.title,
				chapterId: chapter._id,
				chapterName: chapter.chapterName,
				chapterNumber: chapter.chapterNumber ?? null
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

	function toggleCollectionSelection(collectionId: string) {
		selectedCollectionIds = selectedCollectionIds.includes(collectionId)
			? selectedCollectionIds.filter((id) => id !== collectionId)
			: [...selectedCollectionIds, collectionId];
	}

	function selectRating(value: number) {
		selectedRating = selectedRating === value ? 0 : value;
	}

	async function savePreferences() {
		if (!title || preferencesSaving || !preferencesDirty) return;

		preferencesSaving = true;
		preferencesError = null;
		preferencesSuccess = false;
		try {
			await client.mutation(convexApi.library.updateTitlePreferences, {
				titleId: title._id,
				userStatusId: selectedStatusId
					? (selectedStatusId as Id<'libraryUserStatuses'>)
					: null,
				userRating: selectedRating > 0 ? selectedRating : null,
				collectionIds: selectedCollectionIds as Id<'libraryCollections'>[]
			});
			preferencesSuccess = true;
			setTimeout(() => {
				preferencesSuccess = false;
			}, 2500);
		} catch (cause) {
			preferencesError =
				cause instanceof Error ? cause.message : 'Unable to save title preferences';
		} finally {
			preferencesSaving = false;
		}
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
		for (const candidate of [title.variants.map((variant) => variant.title), title.title].flat()) {
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
		if (!normalizedQuery || !normalizedTitle) return 0;

		let score = 0;
		if (normalizedTitle === normalizedQuery) {
			score += 120;
		} else if (normalizedTitle.startsWith(normalizedQuery)) {
			score += 95;
		} else if (normalizedTitle.includes(normalizedQuery)) {
			score += 75 - Math.min(20, Math.max(0, normalizedTitle.length - normalizedQuery.length));
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
				variant.sourcePkg === item.sourcePkg &&
				variant.titleUrl.trim() === item.titleUrl.trim()
		);
	}

	async function loadSourceMatches(options?: { manual?: boolean }) {
		if (!title || sourceMatchesLoading) return;

		const manual = options?.manual === true;
		const query = (manual ? manualSearchQuery : title.title).trim() || title.title;
		const suggestionQueries = manual ? [query] : uniqueMatchQueries();
		const rankedQueries = suggestionQueries.length > 0 ? suggestionQueries : [query];
		const candidateSources = manual
			? manualSearchSourceId
				? availableMatchSources.filter((source) => source.id === manualSearchSourceId)
				: availableMatchSources
			: availableMatchSources;
		if (candidateSources.length === 0) {
			sourceMatches = [];
			sourceMatchesAttempted = true;
			return;
		}

		sourceMatchesLoading = true;
		sourceMatchesAttempted = true;
		sourceManagementError = null;
		sourceMatchesOpen = true;

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
			const fetchDirectVariant = async (source: SourceItem, titleUrl: string) => {
				const { commandId } = await client.mutation(convexApi.commands.enqueueExploreTitleFetch, {
					sourceId: source.id,
					titleUrl,
					contextKey: String(title._id)
				});
				const command = await waitForCommand(client, commandId);
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
					description:
						typeof resolved.description === 'string' ? resolved.description : undefined,
					coverUrl: typeof resolved.coverUrl === 'string' ? resolved.coverUrl : null
				});
			};
			const searchSource = async (source: SourceItem, searchQuery: string) => {
				const { commandId } = await client.mutation(convexApi.commands.enqueueExploreSearch, {
					query: searchQuery,
					sourceId: source.id,
					limit: MATCH_SEARCH_PER_SOURCE_LIMIT
				});
				const command = await waitForCommand(client, commandId);
				const items = ((command.result?.items as ExploreItem[] | undefined) ?? []) as ExploreItem[];
				collected.push(...items);
			};
			const searchSourceBatch = async (sourceBatch: SourceItem[]) => {
				await runWithConcurrency(sourceBatch, MATCH_SEARCH_CONCURRENCY, async (source) => {
					if (manual) {
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

					for (const variantQuery of rankedQueries) {
						await searchSource(source, variantQuery);
					}
				});
			};

			if (manual) {
				await searchSourceBatch(candidateSources);
				sourceMatches = buildRankedMatches();
			} else {
				const batchSize = 6;
				sourceMatches = [];
				for (let index = 0; index < candidateSources.length; index += batchSize) {
					await searchSourceBatch(candidateSources.slice(index, index + batchSize));
					sourceMatches = buildRankedMatches();
					if (sourceMatches.length >= Math.min(6, MATCH_SEARCH_LIMIT)) {
						break;
					}
				}
			}
		} catch (cause) {
			sourceManagementError =
				cause instanceof Error ? cause.message : $_('title.sourceMatchFailed');
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
			sourceManagementError =
				cause instanceof Error ? cause.message : $_('title.sourceLinkFailed');
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

<div class="flex flex-col">
	<div class="mb-6 hidden items-center gap-2 md:flex">
		<Button variant="ghost" size="icon-sm" onclick={handleBack}>
			<CaretLeftIcon size={18} />
		</Button>
		<span class="text-xs text-[var(--text-ghost)]">{backLabel}</span>
	</div>

	{#if loading && !title}
		<div class="-mx-4 md:hidden">
			<div class="aspect-[3/4] max-h-[70vh] w-full animate-pulse bg-[var(--void-3)]"></div>
		</div>
		<div class="md:grid md:grid-cols-[260px_1fr] md:gap-8">
			<div class="hidden animate-pulse bg-[var(--void-3)] md:block md:aspect-[2/3]"></div>
			<div class="relative -mt-24 flex flex-col gap-3 md:mt-0">
				<div class="h-7 w-3/4 animate-pulse bg-[var(--void-4)]"></div>
				<div class="h-4 w-1/3 animate-pulse bg-[var(--void-4)]"></div>
			</div>
		</div>
	{:else if title}
		<div class="flex flex-col md:grid md:grid-cols-[260px_1fr] md:items-start md:gap-8">
			<div class="relative -mx-4 md:sticky md:top-8 md:mx-0">
				<div
					class="aspect-[3/4] max-h-[70vh] w-full overflow-hidden bg-[var(--void-2)] md:aspect-[2/3] md:max-h-none"
				>
					{#if coverSrc}
						<LazyImage
							src={coverSrc}
							alt={title.title}
							class="h-full w-full"
							imgClass="object-cover object-top"
							loading="eager"
						/>
					{:else}
						<div class="flex h-full w-full items-center justify-center bg-[var(--void-3)]">
							<BookIcon size={28} class="text-[var(--void-6)]" />
						</div>
					{/if}
				</div>
				<div
					class="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 md:hidden"
					style="background: linear-gradient(to top, var(--void-0) 0%, var(--void-0) 8%, transparent 100%);"
				></div>
				<button
					type="button"
					class="absolute top-4 left-4 flex h-8 w-8 items-center justify-center bg-[var(--void-0)]/60 text-[var(--text)] backdrop-blur-sm transition-colors hover:bg-[var(--void-0)]/80 md:hidden"
					onclick={handleBack}
				>
					<CaretLeftIcon size={18} />
				</button>

				<div class="mt-4 hidden flex-col gap-3 md:flex">
					<div class="flex items-center gap-2">
						{#if title.chapterStats.total > 0}
							<button
								type="button"
								class="flex h-10 flex-1 items-center justify-center gap-2 bg-[var(--void-5)] text-xs text-[var(--text)] transition-all hover:bg-[var(--void-6)]"
								onclick={openReadingStart}
							>
								<PlayIcon size={14} />
								<span>{$_('title.startReading')}</span>
							</button>
						{:else}
							<div
								class="flex h-10 flex-1 items-center justify-center text-xs text-[var(--text-ghost)]"
							>
								{$_('title.noChapters')}
							</div>
						{/if}
						<button
							type="button"
							class="flex h-10 w-10 shrink-0 items-center justify-center bg-[var(--void-3)] text-[var(--text-muted)] transition-colors hover:bg-[var(--void-4)] hover:text-[var(--text)]"
							onclick={() => (showManagementPanel = true)}
						>
							<GearIcon size={16} />
						</button>
					</div>
					{#if title.chapterStats.total > 0}
						<div class="flex items-center gap-2">
							<div class="relative h-px min-w-0 flex-1 bg-[var(--void-4)]">
								<div
									class="absolute inset-y-0 left-0 bg-[var(--text-ghost)]"
									style={`width: ${Math.round((readingProgressCount / Math.max(title.chapterStats.total, 1)) * 100)}%`}
								></div>
							</div>
							<span class="shrink-0 text-[11px] text-[var(--void-7)] tabular-nums">
								{readingProgressCount}/{title.chapterStats.total}
							</span>
						</div>
					{/if}
				</div>
			</div>

			<div class="flex flex-col">
				<div class="relative -mt-20 flex flex-col gap-2 sm:-mt-24 md:mt-0">
					<h1 class="text-display text-2xl leading-tight text-[var(--text)] sm:text-3xl md:text-2xl">
						{title.title}
					</h1>
					{#if author || artist}
						<p class="text-sm text-[var(--text-ghost)]">
							{#if author}{author}{/if}
							{#if artist && artist !== author}
								{#if author} · {/if}{artist}
							{/if}
						</p>
					{/if}
					<p class="text-xs text-[var(--void-6)]">
						{#if displayStatus}{displayStatus}{/if}
						{#if title.chapterStats.total > 0} · {chaptersLabel}{/if}
						{#if sourcesCount > 0} · {sourcesLabel}{/if}
					</p>
				</div>

				<div class="mt-8 flex flex-col gap-4 md:hidden">
					<div class="flex items-center gap-3">
						{#if title.chapterStats.total > 0}
							<button
								type="button"
								class="flex h-12 flex-1 items-center justify-center gap-2 bg-[var(--void-5)] text-sm text-[var(--text)] transition-all hover:bg-[var(--void-6)]"
								onclick={openReadingStart}
							>
								<PlayIcon size={16} />
								<span>{$_('title.startReading')}</span>
							</button>
						{:else}
							<div
								class="flex h-12 flex-1 items-center justify-center text-sm text-[var(--text-ghost)]"
							>
								{$_('title.noChapters')}
							</div>
						{/if}
						<button
							type="button"
							class="flex h-12 w-12 shrink-0 items-center justify-center bg-[var(--void-3)] text-[var(--text-muted)] transition-colors hover:bg-[var(--void-4)] hover:text-[var(--text)]"
							onclick={() => (showManagementPanel = true)}
						>
							<GearIcon size={18} />
						</button>
					</div>
					{#if title.chapterStats.total > 0}
						<div class="flex items-center gap-3">
							<div class="relative h-px min-w-0 flex-1 bg-[var(--void-4)]">
								<div
									class="absolute inset-y-0 left-0 bg-[var(--text-ghost)]"
									style={`width: ${Math.round((readingProgressCount / Math.max(title.chapterStats.total, 1)) * 100)}%`}
								></div>
							</div>
							<span class="shrink-0 text-xs text-[var(--void-7)] tabular-nums">
								{readingProgressCount}/{title.chapterStats.total}
							</span>
						</div>
					{/if}
				</div>

				{#if actionError}
					<p class="mt-3 text-xs text-[var(--error)]">{actionError}</p>
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
							{title.chapterStats.total}
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
				</div>

				<div class="mt-4">
					{#if activeTab === 'info'}
						<div class="flex flex-col gap-8">
							{#if title.description}
								<div>
									<p
										class="text-sm leading-relaxed text-[var(--text-soft)] {!showFullDescription
											? 'line-clamp-6'
											: ''}"
									>
										{title.description}
									</p>
									{#if title.description.length > 300}
										<button
											type="button"
											class="mt-2 text-xs text-[var(--void-7)] transition-colors hover:text-[var(--text-muted)]"
											onclick={() => (showFullDescription = !showFullDescription)}
										>
											{showFullDescription ? $_('common.less') : $_('common.more')}
										</button>
									{/if}
								</div>
							{:else}
								<p class="text-sm text-[var(--text-ghost)]">{$_('title.noDescription')}</p>
							{/if}

							{#if genres.length > 0}
								<div class="flex flex-wrap gap-2">
									{#each genres as genre (genre)}
										<span class="bg-[var(--void-2)] px-2.5 py-1 text-[11px] text-[var(--text-ghost)]">
											{genre}
										</span>
									{/each}
								</div>
							{/if}

							<div class="flex flex-col gap-8">
								<div class="flex flex-col gap-3">
									{#if author}
										<div class="flex items-baseline justify-between gap-4">
											<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
												{$_('title.author')}
											</span>
											<span class="text-xs text-[var(--text-muted)]">{author}</span>
										</div>
									{/if}
									{#if artist && artist !== author}
										<div class="flex items-baseline justify-between gap-4">
											<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
												{$_('title.artist')}
											</span>
											<span class="text-xs text-[var(--text-muted)]">{artist}</span>
										</div>
									{/if}
								</div>

								<div class="flex flex-col gap-3">
									{#if displayStatus}
										<div class="flex items-baseline justify-between gap-4">
											<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
												{$_('title.status')}
											</span>
											<span class="text-xs text-[var(--text-muted)]">{displayStatus}</span>
										</div>
									{/if}
									<div class="flex items-baseline justify-between gap-4">
										<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
											{$_('title.readingSource')}
										</span>
										<span class="text-right text-xs text-[var(--text-muted)]">
											{sourceName} [{title.sourceLang}]
										</span>
									</div>
									<div class="flex items-baseline justify-between gap-4">
										<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
											{$_('title.chapters')}
										</span>
										<span class="text-xs text-[var(--text-muted)]">{chaptersLabel}</span>
									</div>
									<div class="flex items-baseline justify-between gap-4">
										<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
											{$_('title.sources')}
										</span>
										<span class="text-xs text-[var(--text-muted)]">{sourcesLabel}</span>
									</div>
									<div class="flex items-baseline justify-between gap-4">
										<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
											{$_('title.downloadMonitoring')}
										</span>
										<span class="text-xs text-[var(--text-muted)]">
											{updatesEnabled ? $_('downloads.enabled') : $_('downloads.disabled')}
										</span>
									</div>
								</div>
							</div>
						</div>
					{:else if activeTab === 'chapters'}
						{#if title.chapters.length === 0}
							<div class="flex flex-col items-center gap-3 py-16">
								<BookIcon size={28} class="text-[var(--void-5)]" />
								<p class="text-sm text-[var(--text-ghost)]">{$_('title.noChapters')}</p>
							</div>
						{:else}
							<div class="flex flex-col">
								{#each title.chapters as chapter (chapter._id)}
									{@const detail = chapterDetail(chapter)}
									{@const downloadState = chapterDownloadState(chapter)}
									<div class="flex items-center gap-4 py-3">
										<div class="min-w-0 flex-1">
											<button
												type="button"
												class="flex w-full items-baseline gap-2 text-left"
									onclick={() => openChapter(chapter)}
											>
												<span class="shrink-0 text-sm text-[var(--text)]">
													{chapterLabel(chapter)}
												</span>
												{#if detail}
													<span class="truncate text-sm text-[var(--text-muted)]">{detail}</span>
												{/if}
											</button>
											<div class="mt-1 flex items-center gap-2 text-[11px] text-[var(--text-ghost)]">
												{#if chapter.dateUpload}
													<span>{formatDate(chapter.dateUpload)}</span>
												{/if}
												{#if chapter.scanlator}
													<span class="text-[var(--void-5)]">·</span>
													<span class="truncate">{chapter.scanlator}</span>
												{/if}
												{#if downloadState}
													<span class="text-[var(--void-5)]">·</span>
													<span>{downloadState}</span>
												{/if}
											</div>
											{#if chapter.lastErrorMessage}
												<p class="mt-1 text-[11px] text-[var(--error)]">{chapter.lastErrorMessage}</p>
											{/if}
										</div>
										<div class="flex shrink-0 items-center gap-2">
											{#if chapter.downloadStatus === 'downloaded'}
												<CheckIcon size={13} class="text-[var(--void-7)]" />
											{:else}
												<Button
													variant="ghost"
													size="sm"
													onclick={() => downloadChapter(chapter._id)}
													disabled={chapter.downloadStatus === 'queued' ||
														chapter.downloadStatus === 'downloading' ||
														downloadingChapterIds.includes(chapter._id)}
												>
													{#if chapter.downloadStatus === 'queued' ||
														chapter.downloadStatus === 'downloading' ||
														downloadingChapterIds.includes(chapter._id)}
														<SpinnerIcon size={12} class="animate-spin" />
													{:else}
														<DownloadIcon size={12} />
													{/if}
												</Button>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					{:else if title.titleComments.length === 0}
						<p class="py-6 text-center text-sm text-[var(--text-ghost)]">{$_('title.noComments')}</p>
					{:else}
						<div class="flex flex-col gap-4">
							{#each title.titleComments as comment (comment._id)}
								<div class="flex flex-col gap-1.5 py-2">
									<div class="flex items-center justify-between gap-4 text-[10px] text-[var(--text-ghost)]">
										<span class="truncate">
											{comment.chapterName}
											{#if comment.chapterNumber != null}
												· {$_('reader.page')} {comment.pageIndex + 1}
											{/if}
										</span>
										<span class="shrink-0">{formatTimestamp(comment.createdAt)}</span>
									</div>
									<p class="text-sm whitespace-pre-wrap text-[var(--text-soft)]">{comment.message}</p>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
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
	<SlidePanel
		open={showManagementPanel}
		title={$_('title.info')}
		onclose={() => (showManagementPanel = false)}
	>
		<div class="flex flex-col gap-6">
			<div class="flex flex-col gap-2">
				<span class="text-label">{$_('title.status')}</span>
				{#if availableStatuses.length === 0}
					<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
				{:else}
					<div class="flex flex-wrap gap-1.5">
						<button
							type="button"
							class="px-3 py-1.5 text-xs transition-colors {selectedStatusId === null
								? 'bg-[var(--void-5)] text-[var(--text)]'
								: 'bg-[var(--void-3)] text-[var(--text-ghost)] hover:bg-[var(--void-4)] hover:text-[var(--text-muted)]'}"
							onclick={() => (selectedStatusId = null)}
						>
							{$_('common.clear')}
						</button>
						{#each availableStatuses as status (status.id)}
							<button
								type="button"
								class="px-3 py-1.5 text-xs transition-colors {selectedStatusId === status.id
									? 'bg-[var(--void-5)] text-[var(--text)]'
									: 'bg-[var(--void-3)] text-[var(--text-ghost)] hover:bg-[var(--void-4)] hover:text-[var(--text-muted)]'}"
								onclick={() => (selectedStatusId = status.id)}
							>
								{status.label}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<div class="flex flex-col gap-2">
				<span class="text-label">{$_('title.rating')}</span>
				<div class="flex items-center gap-2 text-[var(--void-6)]">
					{#each Array.from({ length: 5 }) as _, i (i)}
						{@const value = i + 1}
						<button
							type="button"
							class="transition-colors {selectedRating >= value
								? 'text-[var(--text)]'
								: 'text-[var(--void-6)] hover:text-[var(--text-muted)]'}"
							onclick={() => selectRating(value)}
							aria-label={`Rate ${value}`}
						>
							<StarIcon size={16} weight={selectedRating >= value ? 'fill' : 'regular'} />
						</button>
					{/each}
					<button
						type="button"
						class="ml-2 text-xs text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
						onclick={() => (selectedRating = 0)}
					>
						{$_('common.clear')}
					</button>
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<span class="text-label">{$_('title.collections')}</span>
				{#if availableCollections.length === 0}
					<p class="text-xs text-[var(--text-ghost)]">{$_('title.noCollections')}</p>
				{:else}
					<div class="flex flex-wrap gap-1.5">
						{#each availableCollections as collection (collection.id)}
							{@const selected = selectedCollectionIds.includes(collection.id)}
							<button
								type="button"
								class="px-3 py-1.5 text-xs transition-colors {selected
									? 'bg-[var(--void-5)] text-[var(--text)]'
									: 'bg-[var(--void-3)] text-[var(--text-ghost)] hover:bg-[var(--void-4)] hover:text-[var(--text-muted)]'}"
								onclick={() => toggleCollectionSelection(collection.id)}
							>
								{collection.name}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<div class="flex flex-col gap-2">
				<span class="text-label">{$_('extensions.updates')}</span>
				<button
					type="button"
					class="flex items-center gap-2 bg-[var(--void-3)] px-4 py-3 text-left text-sm text-[var(--text-ghost)] transition-colors hover:bg-[var(--void-4)] disabled:opacity-50"
					onclick={toggleDownloadUpdates}
					disabled={updatingDownloadProfile}
				>
					{#if updatingDownloadProfile}
						<SpinnerIcon size={14} class="animate-spin" />
					{:else}
						<DownloadIcon size={14} />
					{/if}
					<span>{updatesEnabled ? $_('downloads.enabled') : $_('downloads.disabled')}</span>
				</button>
			</div>

			<div class="flex flex-col gap-3">
				<div class="flex items-center justify-between gap-4">
					<div>
						<span class="text-label">{$_('title.sources')}</span>
						<p class="mt-1 text-xs text-[var(--text-ghost)]">
							{$_('title.findMatchesDescription')}
						</p>
					</div>
					<div class="flex items-center gap-2">
						{#if hasStaleVariants}
							<Button
								variant="outline"
								size="sm"
								onclick={() => void normalizeSourceLinks()}
								disabled={normalizingSources}
								loading={normalizingSources}
							>
								{$_('title.repairSources')}
							</Button>
						{/if}
						<Button
							variant="outline"
							size="sm"
							onclick={() => void loadSourceMatches()}
							disabled={sourceMatchesLoading || availableMatchSources.length === 0}
							loading={sourceMatchesLoading}
						>
							{$_('title.findOtherSources')}
						</Button>
					</div>
				</div>

				<div class="flex flex-col gap-2">
					{#each title.variants as variant (variant.id)}
						<div class="bg-[var(--void-2)] px-3 py-3">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<span class="truncate text-sm text-[var(--text)]">
											{sourceDisplayName(variant.sourceId, variant.sourcePkg, variant.sourceName)}
										</span>
										<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
											{variant.sourceLang}
										</span>
										{#if variant.isStale}
											<span class="text-[11px] text-[var(--error)]">
												{$_('title.staleSource')}
											</span>
										{:else if variant.isEnabled === false}
											<span class="text-[11px] text-[var(--text-ghost)]">
												{$_('downloads.disabled')}
											</span>
										{/if}
										{#if preferredVariantId === variant.id}
											<span class="text-[11px] text-[var(--success)]">
												{$_('title.readingNow')}
											</span>
										{/if}
									</div>
									<div class="mt-1 truncate text-xs text-[var(--text-ghost)]">
										{variant.title}
									</div>
								</div>
							</div>
							<div class="mt-3 flex flex-wrap gap-2">
								<Button
									variant="ghost"
									size="sm"
									onclick={() => void choosePreferredVariant(variant.id)}
									disabled={preferredVariantSavingId === variant.id || preferredVariantId === variant.id}
									loading={preferredVariantSavingId === variant.id}
								>
									{preferredVariantId === variant.id
										? $_('title.readingNow')
										: $_('title.readFromSource')}
								</Button>
								{#if title.variants.length > 1}
									<Button
										variant="ghost"
										size="sm"
										onclick={() => void removeSourceVariant(variant.id)}
										disabled={removingVariantId === variant.id}
										loading={removingVariantId === variant.id}
									>
										{$_('title.removeSource')}
									</Button>
								{/if}
							</div>
						</div>
					{/each}
				</div>

				{#if sourceMatchesOpen}
					<div class="flex flex-col gap-3 bg-[var(--void-1)] p-4">
						<div class="flex items-center justify-between gap-4">
							<div>
								<p class="text-sm text-[var(--text)]">{$_('title.suggestedMatches')}</p>
								<p class="mt-1 text-xs text-[var(--text-ghost)]">
									{$_('title.enabledSourcesOnly')}
								</p>
							</div>
							<button
								type="button"
								class="text-xs text-[var(--void-7)] transition-colors hover:text-[var(--text-muted)]"
								onclick={() => (manualSearchOpen = !manualSearchOpen)}
							>
								{manualSearchOpen ? $_('common.less') : $_('title.searchManually')}
							</button>
						</div>

						{#if sourceMatchesLoading}
							<div class="flex items-center gap-2 text-xs text-[var(--text-ghost)]">
								<SpinnerIcon size={12} class="animate-spin" />
								<span>{$_('common.loading')}</span>
							</div>
						{:else if sourceMatches.length > 0}
							<div class="flex flex-col gap-2">
								{#each sourceMatches as result (`${result.sourceId}::${result.titleUrl}`)}
									<div class="flex items-start justify-between gap-3 bg-[var(--void-2)] px-3 py-3 text-sm">
										<div class="min-w-0">
											<div class="truncate text-[var(--text)]">{result.title}</div>
											<div class="mt-1 text-xs text-[var(--text-ghost)]">
												{sourceDisplayName(result.sourceId, result.sourcePkg)} [{result.sourceLang}]
											</div>
										</div>
										<Button
											variant="ghost"
											size="sm"
											onclick={() => void linkSourceVariant(result)}
											disabled={linkingVariantKey === `${result.sourceId}::${result.titleUrl}`}
											loading={linkingVariantKey === `${result.sourceId}::${result.titleUrl}`}
										>
											{$_('title.addSource')}
										</Button>
									</div>
								{/each}
							</div>
						{:else if sourceMatchesAttempted}
							<p class="text-xs text-[var(--text-ghost)]">{$_('title.noSourceMatches')}</p>
						{/if}

						{#if manualSearchOpen}
							<div class="grid gap-2 border-t border-[var(--void-3)] pt-3">
								<input
									type="text"
									class="min-w-0 bg-[var(--void-2)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-ghost)]"
									placeholder={title.title}
									bind:value={manualSearchQuery}
								/>
								<select
									class="bg-[var(--void-2)] px-3 py-2 text-sm text-[var(--text)] outline-none"
									bind:value={manualSearchSourceId}
								>
									<option value="">{$_('title.allEnabledSources')}</option>
									{#each availableMatchSources as source (source.id)}
										<option value={source.id}>{source.name} [{source.lang}]</option>
									{/each}
								</select>
								<Button
									variant="outline"
									size="sm"
									onclick={() => void loadSourceMatches({ manual: true })}
									disabled={sourceMatchesLoading || availableMatchSources.length === 0}
									loading={sourceMatchesLoading}
								>
									{$_('common.search')}
								</Button>
							</div>
						{/if}
					</div>
				{/if}

				{#if sourceManagementError}
					<p class="text-xs text-[var(--error)]">{sourceManagementError}</p>
				{/if}
			</div>

			{#if preferencesError}
				<p class="text-xs text-[var(--error)]">{preferencesError}</p>
			{/if}
			{#if preferencesSuccess}
				<p class="text-xs text-[var(--success)]">{$_('title.preferencesSaved')}</p>
			{/if}

			<Button
				variant="solid"
				size="md"
				onclick={() => void savePreferences()}
				disabled={!preferencesDirty || preferencesSaving}
				loading={preferencesSaving}
			>
				{preferencesSaving ? $_('title.saving') : $_('common.save')}
			</Button>
		</div>
	</SlidePanel>
{/if}
