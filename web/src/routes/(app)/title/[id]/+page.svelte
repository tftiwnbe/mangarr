<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	import {
		listLibraryTitleComments,
		listLibraryTitleChapterProgress,
		listLibraryCollections,
		resetLibraryTitleProgress,
		listLibrarySourceMatches,
		listLibraryStatuses,
		listLibraryTitleChapters,
		linkLibraryTitleVariant,
		mergeLibraryTitles,
		updateLibraryTitlePreferences,
		type LibraryCollectionResource,
		type LibraryChapterCommentResource,
		type LibrarySourceMatchResource,
		type LibraryUserStatusResource
	} from '$lib/api/library';
	import { listSources } from '$lib/api/explore';
	import { Button } from '$lib/elements/button';
	import { ConfirmDialog } from '$lib/elements/confirm-dialog';
	import { Icon } from '$lib/elements/icon';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { _ } from '$lib/i18n';
	import { libraryTitleDetailStore } from '$lib/stores/library';
	import { navigateBack, peekNavHistory } from '$lib/stores/nav-history';
	import { panelOverlayOpen } from '$lib/stores/ui';
	import { buildReaderPath, buildTitlePath, parseTitleRouteParam } from '$lib/utils/routes';
	import { mapLibraryChapterResources, type TitleChapterItem } from '$lib/utils/title-mappers';

	let showFullDescription = $state(false);
	let showManagementPanel = $state(false);
	let activeTab = $state<'info' | 'chapters' | 'comments'>('info');
	let statuses = $state<LibraryUserStatusResource[]>([]);
	let collections = $state<LibraryCollectionResource[]>([]);
	let prefsError = $state<string | null>(null);
	let prefsSuccess = $state(false);
	let selectedStatusId = $state<number | null>(null);
	let selectedRating = $state<number>(0);
	let selectedWatchedVariantIds = $state<number[]>([]);
	let selectedCollectionIds = $state<number[]>([]);
	let hasPendingSave = $state(false);
	let saveInFlight = $state(false);
	let saveQueued = $state(false);
	let isHydratingPreferences = $state(true);
	let sourceMatches = $state<LibrarySourceMatchResource[]>([]);
	let sourceMatchesLoading = $state(false);
	let sourceMatchesLoaded = $state(false);
	let sourceMatchesError = $state<string | null>(null);
	let sourceMatchesTitleId = $state<number | null>(null);
	let linkingSourceKey = $state<string | null>(null);
	let sourceLangFilter = $state('');
	let activeTitleRouteId = $state<number | null>(null);
	let selectedVariantId = $state<number | null>(null);
	let variantChapters = $state<TitleChapterItem[] | null>(null);
	let variantChaptersLoading = $state(false);
	let variantChaptersError = $state<string | null>(null);
	let enabledSourceIds = $state<Set<string> | null>(null);
	let variantChaptersRequestId = 0;
	let titleComments = $state<LibraryChapterCommentResource[]>([]);
	let titleCommentsLoading = $state(false);
	let titleCommentsError = $state<string | null>(null);
	let titleCommentsNewestFirst = $state(true);
	let titleCommentsRequestId = 0;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let readerProgressByChapter = $state<Record<number, number>>({});
	let readerProgressUpdatedAtByChapter = $state<Record<number, string>>({});
	let resetProgressConfirmOpen = $state(false);
	let resetProgressLoading = $state(false);
	const structuredChapterPattern =
		/^\s*(?:\d+\s*[-_.]\s*)?(?:(?:vol(?:ume)?\.?\s*(\d+(?:\.\d+)?))\s*)?(?:ch(?:apter)?\.?\s*(\d+(?:\.\d+)?))(?:\s*[-:–]\s*(.*))?\s*$/i;
	function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | null = null;
		return new Promise<T>((resolve, reject) => {
			timer = setTimeout(() => reject(new Error('Request timed out')), ms);
			promise.then(
				(value) => {
					if (timer) clearTimeout(timer);
					resolve(value);
				},
				(error) => {
					if (timer) clearTimeout(timer);
					reject(error);
				}
			);
		});
	}

	const routeTitleParam = $derived(page.params.id);
	const routeTitleId = $derived(parseTitleRouteParam(routeTitleParam) ?? NaN);
	const titleBackTarget = $derived(peekNavHistory(['/reader/', '/title/']));
	const backLabel = $derived(
		titleBackTarget?.startsWith('/explore') ? $_('nav.explore') : $_('nav.library')
	);
	$effect(() => {
		const nextRouteTitleId =
			Number.isInteger(routeTitleId) && routeTitleId > 0 ? routeTitleId : null;

		if (nextRouteTitleId === null) {
			activeTitleRouteId = null;
			libraryTitleDetailStore.reset();
			return;
		}

		if (activeTitleRouteId !== nextRouteTitleId) {
			activeTitleRouteId = nextRouteTitleId;
			libraryTitleDetailStore.reset();
		}

		void libraryTitleDetailStore.load(nextRouteTitleId);
	});

	const title = $derived($libraryTitleDetailStore.data);
	const isLoading = $derived($libraryTitleDetailStore.isLoading);
	const hasAssignedStatus = $derived(selectedStatusId !== null);
	const visibleVariants = $derived.by(() => {
		if (!title) return [];
		const enabledIds = enabledSourceIds;
		if (enabledIds === null) return title.variants;
		return title.variants.filter((variant) => enabledIds.has(variant.sourceId));
	});
	const selectedVariant = $derived.by(() => {
		if (!title || selectedVariantId === null) return null;
		return visibleVariants.find((variant) => variant.id === selectedVariantId) ?? null;
	});
	const isWatchedSelectedVariant = $derived.by(() => {
		if (selectedStatusId === null || selectedVariantId === null) return false;
		return selectedWatchedVariantIds.includes(selectedVariantId);
	});
	const displayTitle = $derived(selectedVariant?.title ?? title?.title ?? '');
	const displayCover = $derived(selectedVariant?.cover ?? title?.cover ?? '');
	const displayAuthor = $derived(selectedVariant?.author ?? title?.author ?? '');
	const displayArtist = $derived(selectedVariant?.artist ?? title?.artist ?? '');
	const displayDescription = $derived(selectedVariant?.description ?? title?.description ?? '');
	const displayGenres = $derived.by(() => {
		const sourceGenre = selectedVariant?.genre
			?.split(',')
			.map((item) => item.trim())
			.filter(Boolean);
		if (sourceGenre && sourceGenre.length > 0) {
			return sourceGenre;
		}
		return title?.genres ?? [];
	});
	const displayedChapters = $derived.by(() => {
		if (!title) return [];
		return variantChapters ?? title.chapters;
	});
	const orderedChaptersForReading = $derived.by(() => {
		return [...displayedChapters].sort((left, right) => {
			const leftNumber = left.number ?? Number.POSITIVE_INFINITY;
			const rightNumber = right.number ?? Number.POSITIVE_INFINITY;
			if (leftNumber !== rightNumber) {
				return leftNumber - rightNumber;
			}
			return left.uploadDate.localeCompare(right.uploadDate);
		});
	});
	const firstChapterForReading = $derived(orderedChaptersForReading[0] ?? null);
	const firstUnreadChapter = $derived(
		orderedChaptersForReading.find((chapter) => !chapter.isRead) ?? null
	);
	const hasReadProgress = $derived(orderedChaptersForReading.some((chapter) => chapter.isRead));
	const chapterWithServerProgress = $derived.by(() => {
		let bestChapter: (typeof orderedChaptersForReading)[number] | null = null;
		let bestUpdatedAt = '';
		for (const chapter of orderedChaptersForReading) {
			if (readerProgressByChapter[chapter.id] === undefined) continue;
			const updatedAt = readerProgressUpdatedAtByChapter[chapter.id] ?? '';
			if (!bestChapter || updatedAt > bestUpdatedAt) {
				bestChapter = chapter;
				bestUpdatedAt = updatedAt;
			}
		}
		return bestChapter;
	});
	const continueChapterForReading = $derived(
		firstUnreadChapter ?? orderedChaptersForReading[orderedChaptersForReading.length - 1] ?? null
	);
	const fallbackPrimaryReadingChapter = $derived(
		hasReadProgress ? continueChapterForReading : firstChapterForReading
	);
	const primaryReadingChapter = $derived(chapterWithServerProgress ?? fallbackPrimaryReadingChapter);
	const completedChapterCount = $derived(
		orderedChaptersForReading.filter((chapter) => chapter.isRead).length
	);
	const localProgressChapterCount = $derived(
		orderedChaptersForReading.filter((chapter) => readerProgressByChapter[chapter.id] !== undefined)
			.length
	);
	const progressedChapterCount = $derived(
		Math.max(completedChapterCount, localProgressChapterCount)
	);
	const hasAnyReadingProgress = $derived(progressedChapterCount > 0);
	const readingProgressRatio = $derived.by(() => {
		if (orderedChaptersForReading.length === 0) return 0;
		return Math.min(1, progressedChapterCount / orderedChaptersForReading.length);
	});
	const primaryReadingHref = $derived.by(() => {
		if (!title || !primaryReadingChapter) return null;
		return buildReaderPath({
			titleId: title.libraryId,
			titleName: displayTitle || title.title,
			chapterId: primaryReadingChapter.id,
			chapterName: primaryReadingChapter.title,
			chapterNumber: primaryReadingChapter.number
		});
	});

	onMount(() => {
		void loadPreferenceOptions();
		void loadEnabledSourceIds();
		return () => {
			if (saveTimer) {
				clearTimeout(saveTimer);
			}
		};
	});

	$effect(() => {
		if (!title || selectedVariantId === null) {
			readerProgressByChapter = {};
			readerProgressUpdatedAtByChapter = {};
			return;
		}
		const libraryTitleId = title.libraryId;
		const variantId = selectedVariantId;
		void (async () => {
			try {
				const progressRows = await listLibraryTitleChapterProgress(libraryTitleId, {
					variant_id: variantId
				});
				if (!title || title.libraryId !== libraryTitleId || selectedVariantId !== variantId) return;
				const byChapter: Record<number, number> = {};
				const updatedByChapter: Record<number, string> = {};
				for (const row of progressRows) {
					if (row.page_index !== null && row.page_index !== undefined) {
						byChapter[row.chapter_id] = row.page_index;
					}
					if (row.updated_at) {
						updatedByChapter[row.chapter_id] = row.updated_at;
					}
				}
				readerProgressByChapter = byChapter;
				readerProgressUpdatedAtByChapter = updatedByChapter;
			} catch {
				readerProgressByChapter = {};
				readerProgressUpdatedAtByChapter = {};
			}
		})();
	});

	$effect(() => {
		if (!title) {
			titleComments = [];
			titleCommentsError = null;
			return;
		}
		const requestId = ++titleCommentsRequestId;
		const libraryTitleId = title.libraryId;
		const variantId = selectedVariantId;
		titleCommentsLoading = true;
		titleCommentsError = null;
		void (async () => {
			try {
				const rows = await listLibraryTitleComments(libraryTitleId, {
					variant_id: variantId ?? undefined,
					newest_first: titleCommentsNewestFirst
				});
				if (requestId !== titleCommentsRequestId) return;
				titleComments = rows;
			} catch (cause) {
				if (requestId !== titleCommentsRequestId) return;
				titleComments = [];
				titleCommentsError = cause instanceof Error ? cause.message : $_('title.commentsLoadFailed');
			} finally {
				if (requestId === titleCommentsRequestId) {
					titleCommentsLoading = false;
				}
			}
		})();
	});

	$effect(() => {
		if (!title) return;
		if (activeTitleRouteId === null || title.libraryId !== activeTitleRouteId) return;
		isHydratingPreferences = true;
		selectedStatusId = title.userStatus?.id ?? null;
		selectedRating = title.userRating ?? 0;
		const availableVariantIds = new Set(visibleVariants.map((variant) => variant.id));
		const linkedWatchedVariantIds = (title.watchedVariantIds ?? []).filter((variantId) =>
			availableVariantIds.has(variantId)
		);
		const preferredVariantId =
			title.preferredVariantId !== undefined &&
			title.preferredVariantId !== null &&
			availableVariantIds.has(title.preferredVariantId)
				? title.preferredVariantId
				: null;
		const fallbackVariantId = preferredVariantId ?? visibleVariants[0]?.id ?? null;
		selectedWatchedVariantIds =
			title.updatesEnabled && linkedWatchedVariantIds.length === 0
				? fallbackVariantId
					? [fallbackVariantId]
					: []
				: linkedWatchedVariantIds;
		selectedCollectionIds = title.collections.map((collection) => collection.id);
		prefsSuccess = false;
		prefsError = null;
		const isDifferentTitle = sourceMatchesTitleId !== title.libraryId;
		if (isDifferentTitle) {
			sourceMatches = [];
			sourceMatchesLoading = false;
			sourceMatchesLoaded = false;
			sourceMatchesError = null;
			linkingSourceKey = null;
			sourceMatchesTitleId = title.libraryId;
			variantChapters = null;
		}
		variantChaptersError = null;
		const hasSelectedVariant =
			selectedVariantId !== null && availableVariantIds.has(selectedVariantId);
		selectedVariantId = hasSelectedVariant ? selectedVariantId : fallbackVariantId;
		queueMicrotask(() => {
			isHydratingPreferences = false;
		});
	});

	$effect(() => {
		if (!title || selectedVariantId === null) return;
		const requestId = ++variantChaptersRequestId;
		variantChaptersLoading = true;
		variantChaptersError = null;
		void (async () => {
			try {
				const chapters = await withTimeout(
					listLibraryTitleChapters(title.libraryId, {
						variant_id: selectedVariantId
					}),
					12_000
				);
				if (requestId !== variantChaptersRequestId) return;

				variantChapters = mapLibraryChapterResources(chapters);
			} catch (error) {
				if (requestId !== variantChaptersRequestId) return;
				variantChapters = title.chapters;
				variantChaptersError =
					error instanceof Error ? error.message : $_('title.failedToLoadVariantChapters');
			} finally {
				if (requestId === variantChaptersRequestId) {
					variantChaptersLoading = false;
				}
			}
		})();
	});

	$effect(() => {
		if (!title) return;
		if (activeTitleRouteId === null || title.libraryId !== activeTitleRouteId) return;
		const canonicalPath = buildTitlePath(title.libraryId, title.title);
		if (page.url.pathname !== canonicalPath) {
			void goto(canonicalPath, { replaceState: true, noScroll: true });
		}
	});

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		if (Number.isNaN(date.getTime())) return dateStr;
		return date.toLocaleDateString();
	}

	function formatDateTime(dateStr: string): string {
		const date = new Date(dateStr);
		if (Number.isNaN(date.getTime())) return dateStr;
		return date.toLocaleString();
	}

	function titleCommentReaderHref(comment: LibraryChapterCommentResource): string {
		if (!title) return '#';
		const base = buildReaderPath({
			titleId: title.libraryId,
			titleName: displayTitle || title.title,
			chapterId: comment.chapter_id,
			chapterName: comment.chapter_name,
			chapterNumber: comment.chapter_number
		});
		return `${base}?page=${comment.page_index}`;
	}

	function chapterHeading(chapter: { title: string; number: number | null }): {
		label: string | null;
		detail: string | null;
	} {
		const raw = chapter.title.trim();
		if (!raw) {
			if (chapter.number === null) return { label: null, detail: null };
			return {
				label: $_('chapter.chapterShort', { values: { number: chapter.number } }),
				detail: null
			};
		}

		const match = raw.match(structuredChapterPattern);
		if (!match) {
			const label =
				chapter.number === null
					? null
					: $_('chapter.chapterShort', { values: { number: chapter.number } });
			return { label, detail: raw };
		}

		const volume = match[1]?.trim() || null;
		const chapterFromTitle = match[2]?.trim() || null;
		const remainder = match[3]?.trim() || null;
		const chapterNumber =
			chapterFromTitle ?? (chapter.number !== null ? String(chapter.number) : null);
		const parts = [];
		if (volume) parts.push(`Vol.${volume}`);
		if (chapterNumber) parts.push(`Ch.${chapterNumber}`);
		return {
			label: parts.length > 0 ? parts.join(' ') : null,
			detail: remainder
		};
	}

	function chooseReadingVariant(variantId: number) {
		if (selectedVariantId === variantId) return;
		selectedVariantId = variantId;
		queueAutoSave();
	}

	async function loadPreferenceOptions() {
		prefsError = null;
		try {
			const [loadedStatuses, loadedCollections] = await Promise.all([
				listLibraryStatuses(),
				listLibraryCollections()
			]);
			statuses = loadedStatuses;
			collections = loadedCollections;
		} catch (error) {
			prefsError = error instanceof Error ? error.message : 'Failed to load library preferences';
		}
	}

	async function loadEnabledSourceIds() {
		try {
			const sources = await listSources({ enabled: true });
			enabledSourceIds = new Set(
				sources
					.map((source) => source.id?.trim() ?? '')
					.filter((sourceId) => sourceId.length > 0)
			);
		} catch {
			enabledSourceIds = null;
		}
	}

	function queueAutoSave() {
		if (isHydratingPreferences || !title) return;
		if (saveTimer) {
			clearTimeout(saveTimer);
		}
		hasPendingSave = true;
		prefsSuccess = false;
		saveTimer = setTimeout(() => {
			void savePreferences();
		}, 500);
	}

	async function savePreferences() {
		if (!title) return;
		if (saveInFlight) {
			saveQueued = true;
			return;
		}
		saveInFlight = true;
		prefsError = null;
		try {
			const watchedVariantIds =
				selectedStatusId === null
					? []
					: [...new Set(selectedWatchedVariantIds)].filter(
							(variantId) => Number.isInteger(variantId) && variantId > 0
						);
			await updateLibraryTitlePreferences(title.libraryId, {
				preferred_variant_id: selectedVariantId,
				user_status_id: selectedStatusId,
				user_rating: selectedRating > 0 ? selectedRating : null,
				updates_enabled: watchedVariantIds.length > 0,
				watched_variant_ids: watchedVariantIds,
				collection_ids: selectedCollectionIds
			});
			const nextStatus = statuses.find((status) => status.id === selectedStatusId);
			const nextCollections = collections.filter((collection) =>
				selectedCollectionIds.includes(collection.id)
			);
			libraryTitleDetailStore.setData({
				...title,
				preferredVariantId: selectedVariantId ?? undefined,
				userStatus: nextStatus
					? {
							id: nextStatus.id,
							key: nextStatus.key,
							label: nextStatus.label,
							color: nextStatus.color,
							position: nextStatus.position,
							isDefault: nextStatus.is_default
						}
					: undefined,
				userRating: selectedRating > 0 ? selectedRating : undefined,
				updatesEnabled: watchedVariantIds.length > 0,
				watchedVariantIds,
				collections: nextCollections.map((collection) => ({
					id: collection.id,
					name: collection.name,
					color: collection.color
				}))
			});
			prefsSuccess = true;
		} catch (error) {
			prefsError = error instanceof Error ? error.message : 'Failed to save preferences';
		} finally {
			saveInFlight = false;
			hasPendingSave = false;
			if (saveQueued) {
				saveQueued = false;
				void savePreferences();
			}
		}
	}

	async function resetReadingProgress() {
		if (!title) return;
		resetProgressLoading = true;
		prefsError = null;
		try {
			const libraryTitleId = title.libraryId;
			await resetLibraryTitleProgress(libraryTitleId);
			readerProgressByChapter = {};
			readerProgressUpdatedAtByChapter = {};
			await libraryTitleDetailStore.refresh(libraryTitleId);
			prefsSuccess = true;
		} catch (error) {
			prefsError = error instanceof Error ? error.message : $_('title.resetProgressFailed');
		} finally {
			resetProgressLoading = false;
			resetProgressConfirmOpen = false;
		}
	}

	function toggleCollection(collectionId: number) {
		if (selectedStatusId === null) return;
		if (selectedCollectionIds.includes(collectionId)) {
			selectedCollectionIds = selectedCollectionIds.filter((id) => id !== collectionId);
		} else {
			selectedCollectionIds = [...selectedCollectionIds, collectionId];
		}
		queueAutoSave();
	}

	function setRating(value: number) {
		if (selectedStatusId === null) return;
		selectedRating = selectedRating === value ? 0 : value;
		queueAutoSave();
	}

	function toggleWatchForSelectedVariant() {
		if (selectedStatusId === null || selectedVariantId === null) return;
		selectedWatchedVariantIds = isWatchedSelectedVariant ? [] : [selectedVariantId];
		queueAutoSave();
	}

	function setStatusId(statusId: number | null) {
		if (selectedStatusId === statusId) return;
		selectedStatusId = statusId;
		if (statusId === null && selectedWatchedVariantIds.length > 0) {
			selectedWatchedVariantIds = [];
		}
		queueAutoSave();
	}

	function sourceMatchKey(match: LibrarySourceMatchResource): string {
		return `${match.source_id}::${match.title_url}`;
	}

	async function findOtherSources() {
		if (!title) return;
		sourceMatchesLoading = true;
		sourceMatchesError = null;
		try {
			const matches = await listLibrarySourceMatches(title.libraryId, {
				lang: sourceLangFilter.trim() || undefined,
				limit_sources: 24,
				min_score: 0.84
			});
			sourceMatches = matches.filter((match) => !match.already_linked);
			sourceMatchesLoaded = true;
		} catch (error) {
			sourceMatchesError = error instanceof Error ? error.message : $_('title.sourceMatchFailed');
		} finally {
			sourceMatchesLoading = false;
		}
	}

	async function addSourceVariant(match: LibrarySourceMatchResource) {
		if (!title) return;
		const key = sourceMatchKey(match);
		if (linkingSourceKey === key) return;
		linkingSourceKey = key;
		sourceMatchesError = null;
		try {
			await linkLibraryTitleVariant(title.libraryId, {
				source_id: match.source_id,
				title_url: match.title_url
			});
			await libraryTitleDetailStore.refresh(title.libraryId);
			sourceMatches = sourceMatches.filter((item) => sourceMatchKey(item) !== key);
		} catch (error) {
			sourceMatchesError = error instanceof Error ? error.message : $_('title.sourceLinkFailed');
		} finally {
			linkingSourceKey = null;
		}
	}

	async function mergeSourceTitle(match: LibrarySourceMatchResource) {
		if (!title || !match.linked_library_title_id) return;
		const key = sourceMatchKey(match);
		if (linkingSourceKey === key) return;
		linkingSourceKey = key;
		sourceMatchesError = null;
		try {
			await mergeLibraryTitles(title.libraryId, {
				source_title_id: match.linked_library_title_id
			});
			await libraryTitleDetailStore.refresh(title.libraryId);
			sourceMatches = sourceMatches.filter((item) => sourceMatchKey(item) !== key);
		} catch (error) {
			sourceMatchesError = error instanceof Error ? error.message : $_('title.sourceMergeFailed');
		} finally {
			linkingSourceKey = null;
		}
	}

	function handleBack() {
		void navigateBack('/library', { skipPrefixes: ['/reader/', '/title/'] });
	}

	$effect(() => {
		panelOverlayOpen.set(showManagementPanel);
		return () => panelOverlayOpen.set(false);
	});
</script>

<svelte:head>
	<title>{displayTitle || title?.title || $_('common.loading')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col">
	<!-- Desktop-only back navigation -->
	<div class="mb-6 hidden items-center gap-2 md:flex">
		<Button variant="ghost" size="icon-sm" onclick={handleBack}>
			<Icon name="chevron-left" size={18} />
		</Button>
		<span class="text-xs text-[var(--text-ghost)]">
			{backLabel}
		</span>
	</div>

	{#if isLoading && !title}
		<!-- Loading skeleton — mobile: full-bleed, desktop: grid -->
		<div class="md:hidden -mx-4">
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
		<!-- Responsive layout: full-bleed mobile / side-cover desktop -->
		<div class="flex flex-col md:grid md:grid-cols-[260px_1fr] md:items-start md:gap-8">

			<!-- COVER COLUMN -->
			<div class="-mx-4 relative md:sticky md:top-8 md:mx-0">
				<div class="aspect-[3/4] max-h-[70vh] w-full overflow-hidden bg-[var(--void-2)] md:aspect-[2/3] md:max-h-none">
					<LazyImage
						src={displayCover || title.cover}
						alt={displayTitle || title.title}
						class="h-full w-full"
						imgClass="object-cover object-top"
						loading="eager"
					/>
				</div>
				<!-- Mobile gradient fade -->
				<div
					class="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 md:hidden"
					style="background: linear-gradient(to top, var(--void-0) 0%, var(--void-0) 8%, transparent 100%);"
				></div>
				<!-- Mobile back button overlay -->
				<button
					type="button"
					class="absolute left-4 top-4 flex h-8 w-8 items-center justify-center bg-[var(--void-0)]/60 text-[var(--text)] backdrop-blur-sm transition-colors hover:bg-[var(--void-0)]/80 md:hidden"
					onclick={handleBack}
				>
					<Icon name="chevron-left" size={18} />
				</button>

				<!-- Desktop: CTA + progress under cover -->
				<div class="mt-4 hidden flex-col gap-3 md:flex">
					<div class="flex items-center gap-2">
						{#if primaryReadingHref}
							<a
								href={primaryReadingHref}
								class="flex h-10 flex-1 items-center justify-center gap-2 bg-[var(--void-5)] text-xs text-[var(--text)] transition-all hover:bg-[var(--void-6)]"
							>
								<Icon name="play" size={14} />
								<span>{hasAnyReadingProgress ? $_('title.continueReading') : $_('title.startReading')}</span>
							</a>
						{:else}
							<div class="flex h-10 flex-1 items-center justify-center text-xs text-[var(--text-ghost)]">
								{$_('title.noChapters')}
							</div>
						{/if}
						<button
							type="button"
							class="flex h-10 w-10 shrink-0 items-center justify-center bg-[var(--void-3)] text-[var(--text-muted)] transition-colors hover:bg-[var(--void-4)] hover:text-[var(--text)]"
							onclick={() => (showManagementPanel = true)}
						>
							<Icon name="settings" size={16} />
						</button>
					</div>
					{#if orderedChaptersForReading.length > 0}
						<div class="flex items-center gap-2">
							<div class="relative h-px min-w-0 flex-1 bg-[var(--void-4)]">
								<div
									class="absolute inset-y-0 left-0 bg-[var(--text-ghost)] transition-[width] duration-500"
									style="width: {Math.round(readingProgressRatio * 100)}%"
								></div>
							</div>
							<span class="shrink-0 text-[11px] tabular-nums text-[var(--void-7)]">
								{progressedChapterCount}/{orderedChaptersForReading.length}
							</span>
						</div>
						{#if hasAnyReadingProgress}
							<button
								type="button"
								class="self-start text-[11px] text-[var(--text-ghost)] transition-colors hover:text-[var(--text)]"
								onclick={() => (resetProgressConfirmOpen = true)}
							>
								{$_('title.resetProgress')}
							</button>
						{/if}
					{/if}
				</div>
			</div>

			<!-- CONTENT COLUMN -->
			<div class="flex flex-col">
				<!-- Title identity -->
				<div class="relative -mt-20 flex flex-col gap-2 sm:-mt-24 md:mt-0">
					<h1 class="text-display text-2xl leading-tight text-[var(--text)] sm:text-3xl md:text-2xl">
						{displayTitle || title.title}
					</h1>
					<p class="text-sm text-[var(--text-ghost)]">
						{#if displayAuthor}
							{displayAuthor}
						{/if}
						{#if displayArtist && displayArtist !== displayAuthor}
							{#if displayAuthor} · {/if}{displayArtist}
						{/if}
					</p>
				</div>

				<!-- PRIMARY ACTION BAR (mobile only — desktop version is under cover) -->
				<div class="mt-8 flex flex-col gap-4 md:hidden">
					<div class="flex items-center gap-3">
						{#if primaryReadingHref}
							<a
								href={primaryReadingHref}
								class="flex h-12 flex-1 items-center justify-center gap-2 bg-[var(--void-5)] text-sm text-[var(--text)] transition-all hover:bg-[var(--void-6)]"
							>
								<Icon name="play" size={16} />
								<span>{hasAnyReadingProgress ? $_('title.continueReading') : $_('title.startReading')}</span>
							</a>
						{:else}
							<div class="flex h-12 flex-1 items-center justify-center text-sm text-[var(--text-ghost)]">
								{$_('title.noChapters')}
							</div>
						{/if}

						<button
							type="button"
							class="flex h-12 w-12 shrink-0 items-center justify-center bg-[var(--void-3)] text-[var(--text-muted)] transition-colors hover:bg-[var(--void-4)] hover:text-[var(--text)]"
							onclick={() => (showManagementPanel = true)}
						>
							<Icon name="settings" size={18} />
						</button>
					</div>

					{#if orderedChaptersForReading.length > 0}
						<div class="flex items-center gap-3">
							<div class="relative h-px min-w-0 flex-1 bg-[var(--void-4)]">
								<div
									class="absolute inset-y-0 left-0 bg-[var(--text-ghost)] transition-[width] duration-500"
									style="width: {Math.round(readingProgressRatio * 100)}%"
								></div>
							</div>
							<span class="shrink-0 text-xs tabular-nums text-[var(--void-7)]">
								{progressedChapterCount}/{orderedChaptersForReading.length}
							</span>
						</div>
						{#if hasAnyReadingProgress}
							<button
								type="button"
								class="self-start text-xs text-[var(--text-ghost)] transition-colors hover:text-[var(--text)]"
								onclick={() => (resetProgressConfirmOpen = true)}
							>
								{$_('title.resetProgress')}
							</button>
						{/if}
					{/if}
				</div>

				{#if variantChaptersError}
					<p class="mt-2 text-xs text-[var(--error)]">{variantChaptersError}</p>
				{/if}

				<!-- TABS -->
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
						{#if displayedChapters.length > 0}
							<span class="ml-1 text-[10px] {activeTab === 'chapters' ? 'text-[var(--text-muted)]' : 'text-[var(--void-6)]'}">
								{displayedChapters.length}
							</span>
						{/if}
					</button>
					<button
						type="button"
						class="px-3 py-1.5 text-xs transition-colors {activeTab === 'comments'
							? 'bg-[var(--void-4)] text-[var(--text)]'
							: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
						onclick={() => (activeTab = 'comments')}
					>
						{$_('title.comments')}
						{#if titleComments.length > 0}
							<span class="ml-1 text-[10px] {activeTab === 'comments' ? 'text-[var(--text-muted)]' : 'text-[var(--void-6)]'}">
								{titleComments.length}
							</span>
						{/if}
					</button>
				</div>

				<!-- TAB CONTENT -->
				<div class="mt-4">
					{#if activeTab === 'info'}
						<!-- INFO TAB -->
						<div class="flex flex-col gap-8">
							{#if displayDescription}
								<div>
									<p class="text-sm leading-relaxed text-[var(--text-soft)] {!showFullDescription ? 'line-clamp-6' : ''}">
										{displayDescription}
									</p>
									{#if displayDescription.length > 300}
										<button
											type="button"
											class="mt-2 text-xs text-[var(--void-7)] transition-colors hover:text-[var(--text-muted)]"
											onclick={() => (showFullDescription = !showFullDescription)}
										>
											{showFullDescription ? $_('common.less') : $_('common.more')}
										</button>
									{/if}
								</div>
							{/if}

							{#if displayGenres.length > 0}
								<div class="flex flex-wrap gap-2">
									{#each displayGenres as genre (genre)}
										<span class="bg-[var(--void-2)] px-2.5 py-1 text-[11px] text-[var(--text-ghost)]">
											{genre}
										</span>
									{/each}
								</div>
							{/if}

							{#if displayAuthor || (displayArtist && displayArtist !== displayAuthor)}
								<div class="flex flex-col gap-3">
									{#if displayAuthor}
										<div class="flex items-baseline justify-between gap-4">
											<span class="text-[10px] uppercase tracking-widest text-[var(--void-6)]">
												{$_('title.author')}
											</span>
											<span class="text-xs text-[var(--text-muted)]">{displayAuthor}</span>
										</div>
									{/if}
									{#if displayArtist && displayArtist !== displayAuthor}
										<div class="flex items-baseline justify-between gap-4">
											<span class="text-[10px] uppercase tracking-widest text-[var(--void-6)]">
												{$_('title.artist')}
											</span>
											<span class="text-xs text-[var(--text-muted)]">{displayArtist}</span>
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{:else if activeTab === 'chapters'}
						<!-- CHAPTERS TAB -->
						{#if variantChaptersLoading && displayedChapters.length === 0}
							<div class="flex justify-center py-12">
								<Icon name="loader" size={18} class="animate-spin text-[var(--text-ghost)]" />
							</div>
						{:else if displayedChapters.length === 0}
							<div class="flex flex-col items-center gap-3 py-16">
								<Icon name="book" size={28} class="text-[var(--void-5)]" />
								<p class="text-sm text-[var(--text-ghost)]">{$_('title.noChapters')}</p>
							</div>
						{:else}
							<div class="flex flex-col">
								{#each displayedChapters as chapter (chapter.id)}
									{@const heading = chapterHeading(chapter)}
									{@const chapterProgress = readerProgressByChapter[chapter.id]}
									<a
										href={buildReaderPath({
											titleId: title.libraryId,
											titleName: displayTitle || title.title,
											chapterId: chapter.id,
											chapterName: chapter.title,
											chapterNumber: chapter.number
										})}
										class="group flex items-center gap-4 py-3 transition-colors hover:bg-[var(--void-2)] {chapter.isRead ? 'opacity-30' : ''}"
									>
										<div class="min-w-0 flex-1">
											<div class="flex items-baseline gap-2">
												{#if heading.label}
													<span class="shrink-0 text-sm text-[var(--text)]">
														{heading.label}
													</span>
												{/if}
												{#if heading.detail}
													<span class="truncate text-sm text-[var(--text-muted)]">
														{heading.detail}
													</span>
												{/if}
											</div>
											<div class="mt-1 flex items-center gap-2 text-[11px] text-[var(--text-ghost)]">
												<span>{formatDate(chapter.uploadDate)}</span>
												{#if chapter.scanlator}
													<span class="text-[var(--void-5)]">·</span>
													<span class="truncate">{chapter.scanlator}</span>
												{/if}
											</div>
											{#if chapter.downloadError}
												<p class="mt-1 text-[11px] text-[var(--error)]">{chapter.downloadError}</p>
											{/if}
										</div>
										<div class="flex shrink-0 items-center gap-2 text-[var(--text-ghost)]">
											{#if chapterProgress !== undefined}
												<span class="text-[10px] tabular-nums text-[var(--void-7)]">
													p.{chapterProgress + 1}
												</span>
											{/if}
											{#if chapter.isDownloaded}
												<Icon name="download" size={13} class="text-[var(--void-7)]" />
											{/if}
											{#if chapter.isRead}
												<Icon name="check" size={13} />
											{/if}
										</div>
									</a>
								{/each}
							</div>
						{/if}
					{:else}
						<!-- COMMENTS TAB -->
						<div class="flex flex-col gap-2">
							<div class="flex items-center justify-end">
								<Button
									variant="ghost"
									size="sm"
									onclick={() => (titleCommentsNewestFirst = !titleCommentsNewestFirst)}
								>
									<Icon name="clock" size={13} />
									{titleCommentsNewestFirst ? $_('reader.sortNewest') : $_('reader.sortOldest')}
								</Button>
							</div>
							{#if titleCommentsError}
								<p class="text-xs text-[var(--error)]">{titleCommentsError}</p>
							{:else if titleCommentsLoading}
								<div class="flex justify-center py-8">
									<Icon name="loader" size={18} class="animate-spin text-[var(--text-ghost)]" />
								</div>
							{:else if titleComments.length === 0}
								<p class="py-6 text-center text-sm text-[var(--text-ghost)]">{$_('title.noComments')}</p>
							{:else}
								<div class="flex flex-col gap-2">
									{#each titleComments as comment (comment.id)}
										<a
											href={titleCommentReaderHref(comment)}
											class="block bg-[var(--void-2)] px-4 py-3 text-xs transition-colors hover:bg-[var(--void-3)]"
										>
											<div class="mb-1.5 flex items-center justify-between gap-2 text-[10px] text-[var(--text-ghost)]">
												<span class="truncate">
													{comment.chapter_name} · {$_('reader.page')} {comment.page_index + 1}
												</span>
												<span class="shrink-0">{formatDateTime(comment.created_at)}</span>
											</div>
											<p class="line-clamp-3 whitespace-pre-wrap text-[var(--text-muted)]">
												{comment.message}
											</p>
										</a>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{:else}
		<!-- Not found -->
		<div class="flex flex-col items-center gap-4 py-20 text-center">
			<Icon name="book" size={28} class="text-[var(--void-6)]" />
			<div>
				<p class="text-sm text-[var(--text-ghost)]">{$_('title.notFound')}</p>
				<p class="mt-1 text-xs text-[var(--void-6)]">
					{$libraryTitleDetailStore.error || $_('title.notFoundDescription')}
				</p>
			</div>
			<Button variant="outline" onclick={handleBack}>{$_('title.backToLibrary')}</Button>
		</div>
	{/if}
</div>

<!-- MANAGEMENT SLIDE PANEL -->
{#if title}
	<SlidePanel
		open={showManagementPanel}
		title={$_('title.info')}
		onclose={() => (showManagementPanel = false)}
	>
		<div class="flex flex-col gap-6">
			<!-- Status selection -->
			<div class="flex flex-col gap-2">
				<span class="text-label">{$_('title.status')}</span>
				<div class="flex flex-wrap gap-1.5">
					{#each statuses as status (status.id)}
						<button
							type="button"
							class="px-3 py-1.5 text-xs transition-colors {status.id === selectedStatusId
								? 'bg-[var(--void-5)] text-[var(--text)]'
								: 'bg-[var(--void-3)] text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
							onclick={() => setStatusId(status.id)}
						>
							{status.label}
						</button>
					{/each}
					{#if selectedStatusId !== null}
						<button
							type="button"
							class="px-3 py-1.5 text-xs text-[var(--error)] transition-colors hover:bg-[var(--error-soft)]"
							onclick={() => setStatusId(null)}
						>
							{$_('title.removeFromList')}
						</button>
					{/if}
				</div>
			</div>

			<!-- Rating -->
			{#if hasAssignedStatus}
				<div class="flex flex-col gap-2">
					<span class="text-label">{$_('title.rating')}</span>
					<div class="flex items-center gap-1">
						{#each Array.from({ length: 5 }) as _, i (i)}
							{@const val = i + 1}
							<button
								type="button"
								class="flex h-10 w-10 items-center justify-center text-lg transition-colors {selectedRating >= val
									? 'text-[var(--text)]'
									: 'text-[var(--void-5)] hover:text-[var(--void-7)]'}"
								onclick={() => setRating(val)}
							>
								★
							</button>
						{/each}
						{#if selectedRating > 0}
							<span class="ml-2 text-xs text-[var(--text-muted)]">{selectedRating}/5</span>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Collections -->
			{#if hasAssignedStatus && collections.length > 0}
				<div class="flex flex-col gap-2">
					<span class="text-label">{$_('title.collections')}</span>
					<div class="flex flex-wrap gap-1.5">
						{#each collections as collection (collection.id)}
							{@const active = selectedCollectionIds.includes(collection.id)}
							<button
								type="button"
								class="px-3 py-1.5 text-xs transition-colors {active
									? 'bg-[var(--void-5)] text-[var(--text)]'
									: 'bg-[var(--void-3)] text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
								onclick={() => toggleCollection(collection.id)}
							>
								{collection.name}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Updates watch toggle -->
			<div class="flex flex-col gap-2">
				<span class="text-label">{$_('downloads.monitor')}</span>
				<button
					type="button"
					class="flex h-10 items-center gap-3 px-3 text-xs transition-colors {isWatchedSelectedVariant
						? 'bg-[var(--void-5)] text-[var(--text)]'
						: 'bg-[var(--void-3)] text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
					onclick={toggleWatchForSelectedVariant}
					disabled={!hasAssignedStatus || selectedVariantId === null}
				>
					<Icon name="download" size={14} />
					{isWatchedSelectedVariant ? $_('downloads.enabled') : $_('downloads.disabled')}
				</button>
			</div>

			<!-- Sources section -->
			{#if visibleVariants.length > 0}
				<div class="flex flex-col gap-2">
					<span class="text-label">{$_('title.sources')}</span>
					<div class="flex flex-col">
						{#each visibleVariants as variant (variant.id)}
							<button
								type="button"
								class="flex items-center gap-3 py-2.5 text-left text-xs transition-colors {variant.id === selectedVariantId
									? 'text-[var(--text)]'
									: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
								onclick={() => chooseReadingVariant(variant.id)}
							>
								<div class="min-w-0 flex-1">
									<span>{variant.sourceName || variant.sourceId}</span>
									{#if variant.id === selectedVariantId}
										<span class="ml-2 text-[var(--void-6)]">{$_('title.readingNow')}</span>
									{/if}
									<p class="mt-0.5 truncate text-[var(--void-6)]">{variant.title}</p>
								</div>
								<span class="shrink-0 text-[10px] text-[var(--void-7)]">
									{variant.sourceLang || ''}
								</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Find other sources -->
			<div class="flex flex-col gap-2">
				<div class="flex items-center gap-2">
					<input
						type="text"
						class="h-8 w-20 bg-[var(--void-3)] px-2 text-xs text-[var(--text)] placeholder-[var(--void-6)] focus:bg-[var(--void-4)] focus:outline-none"
						placeholder={$_('title.langFilter')}
						bind:value={sourceLangFilter}
					/>
					<Button
						variant="outline"
						size="sm"
						onclick={findOtherSources}
						disabled={sourceMatchesLoading}
						loading={sourceMatchesLoading}
					>
						{$_('title.findOtherSources')}
					</Button>
				</div>
				{#if sourceMatchesError}
					<p class="text-xs text-[var(--error)]">{sourceMatchesError}</p>
				{/if}
				{#if sourceMatchesLoaded}
					{#if sourceMatches.length === 0}
						<p class="text-xs text-[var(--void-6)]">{$_('title.noSourceMatches')}</p>
					{:else}
						<div class="flex flex-col gap-1.5">
							{#each sourceMatches as match (sourceMatchKey(match))}
								<div class="flex items-center gap-2 bg-[var(--void-3)] p-2.5">
									<div class="min-w-0 flex-1">
										<p class="text-xs text-[var(--text-muted)]">
											{match.source_name}
											{#if match.source_lang}
												<span class="text-[var(--void-6)]">[{match.source_lang}]</span>
											{/if}
										</p>
										<p class="truncate text-[11px] text-[var(--void-6)]">{match.title}</p>
									</div>
									{#if match.linked_library_title_id && match.linked_library_title_id !== title.libraryId}
										<Button
											variant="outline"
											size="sm"
											onclick={() => mergeSourceTitle(match)}
											disabled={linkingSourceKey === sourceMatchKey(match)}
											loading={linkingSourceKey === sourceMatchKey(match)}
										>
											{$_('title.mergeTitle')}
										</Button>
									{:else}
										<Button
											variant="outline"
											size="sm"
											onclick={() => addSourceVariant(match)}
											disabled={linkingSourceKey === sourceMatchKey(match)}
											loading={linkingSourceKey === sourceMatchKey(match)}
										>
											{$_('title.addSource')}
										</Button>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			</div>

			<!-- Save status feedback -->
			{#if prefsError}
				<span class="text-[11px] text-[var(--error)]">{prefsError}</span>
			{:else if hasPendingSave}
				<span class="text-[11px] text-[var(--void-7)]">{$_('title.saving')}</span>
			{:else if prefsSuccess}
				<span class="text-[11px] text-[var(--text-muted)]">{$_('title.saved')}</span>
			{/if}
		</div>
	</SlidePanel>

	<ConfirmDialog
		open={resetProgressConfirmOpen}
		title={$_('title.resetProgressConfirmTitle')}
		description={$_('title.resetProgressConfirmDescription')}
		confirmLabel={$_('title.resetProgress')}
		variant="danger"
		loading={resetProgressLoading}
		onConfirm={resetReadingProgress}
		onCancel={() => (resetProgressConfirmOpen = false)}
	/>
{/if}
