<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	import {
		listLibraryCollections,
		listLibrarySourceMatches,
		listLibraryStatuses,
		listLibraryTitleChapters,
		linkLibraryTitleVariant,
		mergeLibraryTitles,
		updateLibraryTitlePreferences,
		type LibraryCollectionResource,
		type LibrarySourceMatchResource,
		type LibraryUserStatusResource
	} from '$lib/api/library';
	import { Button } from '$lib/elements/button';
	import { Icon } from '$lib/elements/icon';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { _ } from '$lib/i18n';
	import { libraryTitleDetailStore } from '$lib/stores/library';
	import { buildReaderPath, buildTitlePath, parseIdFromRouteParam } from '$lib/utils/routes';
	import { mapLibraryChapterResources, type TitleChapterItem } from '$lib/utils/title-mappers';

	let showFullDescription = $state(false);
	let activeTab = $state<'chapters' | 'info'>('chapters');
	let statuses = $state<LibraryUserStatusResource[]>([]);
	let collections = $state<LibraryCollectionResource[]>([]);
	let prefsLoading = $state(true);
	let prefsError = $state<string | null>(null);
	let prefsSuccess = $state(false);
	let selectedStatusId = $state<number | null>(null);
	let statusMenuOpen = $state(false);
	let statusMenuContainer = $state<HTMLDivElement | null>(null);
	let selectedRating = $state<number>(0);
	let selectedMonitoringVariantIds = $state<number[]>([]);
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
	let didAutoVariantFallback = $state(false);
	let variantChaptersRequestId = 0;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
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
	const routeTitleId = $derived(parseIdFromRouteParam(routeTitleParam) ?? NaN);

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
	const selectedStatus = $derived.by(() => {
		if (selectedStatusId === null) return null;
		return statuses.find((status) => status.id === selectedStatusId) ?? null;
	});
	const selectedVariant = $derived.by(() => {
		if (!title || selectedVariantId === null) return null;
		return title.variants.find((variant) => variant.id === selectedVariantId) ?? null;
	});
	const displayTitle = $derived(selectedVariant?.title ?? title?.title ?? '');
	const displayCover = $derived(selectedVariant?.cover ?? title?.cover ?? '');
	const displayAuthor = $derived(selectedVariant?.author ?? title?.author ?? '');
	const displayArtist = $derived(selectedVariant?.artist ?? title?.artist ?? '');
	const displayDescription = $derived(selectedVariant?.description ?? title?.description ?? '');
	const displayStatus = $derived(selectedVariant?.status ?? title?.status ?? 0);
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
	const continueChapterForReading = $derived(
		firstUnreadChapter ?? orderedChaptersForReading[orderedChaptersForReading.length - 1] ?? null
	);
	const primaryReadingChapter = $derived(
		hasReadProgress ? continueChapterForReading : firstChapterForReading
	);
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
		const handleDocumentPointerDown = (event: PointerEvent) => {
			if (!statusMenuOpen) return;
			if (!statusMenuContainer) return;
			if (statusMenuContainer.contains(event.target as Node)) return;
			statusMenuOpen = false;
		};
		document.addEventListener('pointerdown', handleDocumentPointerDown);
		void loadPreferenceOptions();
		return () => {
			document.removeEventListener('pointerdown', handleDocumentPointerDown);
			if (saveTimer) {
				clearTimeout(saveTimer);
			}
		};
	});

	$effect(() => {
		if (!title) return;
		if (activeTitleRouteId === null || title.libraryId !== activeTitleRouteId) return;
		isHydratingPreferences = true;
		selectedStatusId = title.userStatus?.id ?? null;
		selectedRating = title.userRating ?? 0;
		const availableVariantIds = new Set(title.variants.map((variant) => variant.id));
		const linkedMonitoringVariantIds = (title.monitoringVariantIds ?? []).filter((variantId) =>
			availableVariantIds.has(variantId)
		);
		const fallbackVariantId = title.preferredVariantId ?? title.variants[0]?.id ?? null;
		selectedMonitoringVariantIds =
			title.monitoringEnabled && linkedMonitoringVariantIds.length === 0
				? fallbackVariantId
					? [fallbackVariantId]
					: []
				: linkedMonitoringVariantIds;
			selectedCollectionIds = title.collections.map((collection) => collection.id);
			prefsSuccess = false;
			prefsError = null;
			statusMenuOpen = false;
			const isDifferentTitle = sourceMatchesTitleId !== title.libraryId;
		if (isDifferentTitle) {
			sourceMatches = [];
			sourceMatchesLoading = false;
			sourceMatchesLoaded = false;
			sourceMatchesError = null;
			linkingSourceKey = null;
			sourceMatchesTitleId = title.libraryId;
		}
		variantChaptersError = null;
		variantChapters = null;
		didAutoVariantFallback = false;
		const hasSelectedVariant =
			selectedVariantId !== null &&
			title.variants.some((variant) => variant.id === selectedVariantId);
		const preferredVariantId = title.preferredVariantId ?? null;
		selectedVariantId = hasSelectedVariant
			? selectedVariantId
			: (preferredVariantId ?? title.variants[0]?.id ?? null);
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

				if (
					chapters.length === 0 &&
					!didAutoVariantFallback &&
					title.variants.length > 1 &&
					selectedVariantId === (title.preferredVariantId ?? null)
				) {
					for (const fallbackVariant of title.variants) {
						if (fallbackVariant.id === selectedVariantId) continue;
						const fallbackChapters = await withTimeout(
							listLibraryTitleChapters(title.libraryId, {
								variant_id: fallbackVariant.id
							}),
							12_000
						);
						if (requestId !== variantChaptersRequestId) return;
						if (fallbackChapters.length > 0) {
							didAutoVariantFallback = true;
							selectedVariantId = fallbackVariant.id;
							return;
						}
					}
				}

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
		prefsLoading = true;
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
		} finally {
			prefsLoading = false;
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
			const monitoringVariantIds =
				selectedStatusId === null
					? []
					: [...new Set(selectedMonitoringVariantIds)].filter(
							(variantId) => Number.isInteger(variantId) && variantId > 0
						);
			await updateLibraryTitlePreferences(title.libraryId, {
				preferred_variant_id: selectedVariantId,
				user_status_id: selectedStatusId,
				user_rating: selectedRating > 0 ? selectedRating : null,
				monitoring_enabled: monitoringVariantIds.length > 0,
				monitoring_variant_ids: monitoringVariantIds,
				collection_ids: selectedCollectionIds
			});
			await Promise.all([
				libraryTitleDetailStore.refresh(title.libraryId),
				loadPreferenceOptions()
			]);
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

	function toggleMonitoringVariant(variantId: number) {
		if (selectedStatusId === null) return;
		if (selectedMonitoringVariantIds.includes(variantId)) {
			selectedMonitoringVariantIds = selectedMonitoringVariantIds.filter((id) => id !== variantId);
		} else {
			selectedMonitoringVariantIds = [...selectedMonitoringVariantIds, variantId];
		}
		queueAutoSave();
	}

	function setStatusId(statusId: number | null) {
		if (selectedStatusId === statusId) {
			statusMenuOpen = false;
			return;
		}
		selectedStatusId = statusId;
		if (statusId === null && selectedMonitoringVariantIds.length > 0) {
			selectedMonitoringVariantIds = [];
		}
		statusMenuOpen = false;
		queueAutoSave();
	}

	function toggleStatusMenu() {
		statusMenuOpen = !statusMenuOpen;
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
		if (typeof window !== 'undefined' && window.history.length > 1) {
			window.history.back();
			return;
		}
		void goto('/library');
	}
</script>

<svelte:head>
	<title>{displayTitle || title?.title || $_('common.loading')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex items-center gap-3">
		<Button variant="ghost" size="icon-sm" onclick={handleBack}>
			<Icon name="chevron-left" size={20} />
		</Button>
		<h1 class="text-display line-clamp-1 flex-1 text-xl text-[var(--text)]">
			{displayTitle || title?.title || $_('common.loading')}
		</h1>
	</div>

	{#if isLoading && !title}
		<div class="flex flex-col gap-6 md:flex-row">
			<div class="mx-auto h-72 w-48 animate-pulse bg-[var(--void-3)] md:mx-0 md:w-56"></div>
			<div class="flex-1 space-y-4">
				<div class="h-8 w-2/3 animate-pulse bg-[var(--void-3)]"></div>
				<div class="h-4 w-1/3 animate-pulse bg-[var(--void-3)]"></div>
				<div class="h-20 w-full animate-pulse bg-[var(--void-3)]"></div>
			</div>
		</div>
	{:else if title}
		<div class="flex flex-col gap-6 md:flex-row">
			<div class="shrink-0">
				<div class="card-glow mx-auto w-48 md:mx-0 md:w-56">
					<LazyImage
						src={displayCover || title.cover}
						alt={displayTitle || title.title}
						class="aspect-[2/3] w-full border border-[var(--line)]"
						loading="eager"
					/>
				</div>
			</div>

			<div class="flex flex-1 flex-col gap-4">
				<div>
					<h2 class="text-xl font-semibold text-[var(--text)] md:text-2xl">
						{displayTitle || title.title}
					</h2>
					{#if displayAuthor}
						<p class="mt-1 text-[var(--text-muted)]">{displayAuthor}</p>
					{/if}
				</div>

				<div class="flex flex-wrap items-center gap-3 text-sm">
					{#if title.userStatus}
						<span
							class="border border-[var(--line)] bg-[var(--void-3)] px-2 py-0.5 text-[var(--text-muted)]"
						>
							{title.userStatus.label}
						</span>
					{:else if displayStatus}
						<span
							class="border border-[var(--line)] bg-[var(--void-3)] px-2 py-0.5 text-[var(--text-muted)]"
						>
							{$_(`status.${displayStatus}`)}
						</span>
					{/if}
					{#if title.userRating != null}
						<span
							class="border border-[var(--line)] bg-[var(--void-3)] px-2 py-0.5 text-[var(--text-muted)]"
						>
							★ {title.userRating.toFixed(1)}
						</span>
					{/if}
					<span class="text-[var(--text-muted)]"
						>{displayedChapters.length} {$_('title.chapters')}</span
					>
					<span class="text-[var(--text-muted)]">{title.variants.length} {$_('title.sources')}</span
					>
				</div>

				{#if displayGenres.length}
					<div class="flex flex-wrap gap-1.5">
						{#each displayGenres as genre (genre)}
							<span
								class="border border-[var(--line)] bg-[var(--void-2)] px-2 py-0.5 text-xs text-[var(--text-soft)]"
							>
								{genre}
							</span>
						{/each}
					</div>
				{/if}

				<div class="flex flex-wrap gap-2">
					{#if primaryReadingHref}
						<Button variant="default" size="sm" href={primaryReadingHref}>
							<Icon name="book-open" size={14} />
							{hasReadProgress ? $_('title.continueReading') : $_('title.startReading')}
						</Button>
					{/if}
					<Button variant="outline" size="sm" href="/downloads">
						<Icon name="download" size={14} />
						{$_('nav.downloads')}
					</Button>
				</div>

				{#if title.variants.length > 0}
					<div class="space-y-2">
						<p class="text-xs text-[var(--text-ghost)]">{$_('title.readingSource')}</p>
						<div class="flex flex-wrap gap-2">
							{#each title.variants as variant (variant.id)}
								<button
									type="button"
									class="border px-3 py-1.5 text-xs transition-colors {variant.id ===
									selectedVariantId
										? 'border-[var(--text)] bg-[var(--void-4)] text-[var(--text)]'
										: 'border-[var(--line)] bg-[var(--void-3)] text-[var(--text-muted)] hover:border-[var(--void-6)] hover:text-[var(--text)]'}"
									onclick={() => chooseReadingVariant(variant.id)}
								>
									{variant.sourceName || variant.sourceId}
									{#if variant.sourceLang}
										[{variant.sourceLang}]
									{/if}
								</button>
							{/each}
						</div>
						{#if variantChaptersLoading}
							<p class="text-xs text-[var(--text-ghost)]">{$_('title.loadingVariantChapters')}</p>
						{:else if variantChaptersError}
							<p class="text-xs text-[var(--error)]">{variantChaptersError}</p>
						{/if}
					</div>
				{/if}

				<div class="border border-[var(--line)] bg-[var(--void-2)] p-4">
					<div class="flex items-center justify-between gap-3">
						<p class="text-sm font-medium text-[var(--text)]">{$_('title.libraryControls')}</p>
						{#if hasPendingSave}
							<span class="text-xs text-[var(--text-ghost)]">{$_('title.saving')}</span>
						{:else if prefsSuccess}
							<span class="text-xs text-[var(--success)]">{$_('title.saved')}</span>
						{/if}
					</div>
						{#if prefsLoading}
							<p class="mt-3 text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
						{:else}
							<div class="mt-4 grid gap-4 md:grid-cols-2">
								<div>
									<p class="text-xs text-[var(--text-ghost)]">{$_('title.status')}</p>
									<div class="relative mt-1" bind:this={statusMenuContainer}>
										<button
											type="button"
											class="flex w-full items-center justify-between border border-[var(--line)] bg-[var(--void-3)] px-3 py-2 text-sm transition-colors hover:border-[var(--void-6)]"
											aria-expanded={statusMenuOpen}
											onclick={toggleStatusMenu}
										>
											<span class="flex items-center gap-2 text-[var(--text)]">
												<Icon
													name={selectedStatus ? 'check' : 'plus'}
													size={14}
													class={selectedStatus ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}
												/>
												<span>{selectedStatus?.label ?? $_('title.addToPlans')}</span>
											</span>
											<Icon
												name="chevron-down"
												size={14}
												class="text-[var(--text-ghost)] transition-transform {statusMenuOpen
													? 'rotate-180'
													: ''}"
											/>
										</button>
										{#if statusMenuOpen}
											<div
												class="absolute left-0 right-0 z-20 mt-2 max-h-64 overflow-auto border border-[var(--line)] bg-[var(--void-2)] p-1"
											>
												{#if statuses.length === 0}
													<p class="px-3 py-2 text-sm text-[var(--text-ghost)]">{$_('common.noResults')}</p>
												{:else}
													{#each statuses as status (status.id)}
														<button
															type="button"
															class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors {status.id ===
															selectedStatusId
																? 'bg-[var(--void-4)] text-[var(--text)]'
																: 'text-[var(--text-muted)] hover:bg-[var(--void-3)] hover:text-[var(--text)]'}"
															onclick={() => setStatusId(status.id)}
														>
															{#if status.id === selectedStatusId}
																<Icon name="check" size={14} />
															{:else}
																<span class="h-[14px] w-[14px]"></span>
															{/if}
															<span>{status.label}</span>
														</button>
													{/each}
													{#if selectedStatusId !== null}
														<div class="my-1 h-px bg-[var(--line)]"></div>
														<button
															type="button"
															class="w-full px-3 py-2 text-left text-sm text-[var(--error)] transition-colors hover:bg-[var(--void-3)]"
															onclick={() => setStatusId(null)}
														>
															{$_('title.removeFromList')}
														</button>
													{/if}
												{/if}
											</div>
										{/if}
									</div>
									{#if !hasAssignedStatus}
										<p class="mt-2 text-[11px] text-[var(--text-ghost)]">
											{$_('title.assignStatusBeforePreferences')}
										</p>
									{/if}
								</div>
								<div>
									<p class="text-xs text-[var(--text-ghost)]">{$_('title.rating')}</p>
									<div class="mt-1 flex items-center gap-1 {hasAssignedStatus ? '' : 'opacity-50'}">
										{#each Array.from({ length: 5 }) as _, i (i)}
											{@const value = i + 1}
											<button
												type="button"
												class="h-8 w-8 border border-[var(--line)] text-lg leading-none transition-colors {selectedRating >=
												value
													? 'bg-[var(--void-4)] text-[var(--text)]'
													: 'bg-[var(--void-3)] text-[var(--text-ghost)]'}"
												disabled={!hasAssignedStatus}
												onclick={() => setRating(value)}
											>
												★
											</button>
										{/each}
										{#if selectedRating > 0}
											<span class="ml-2 text-xs text-[var(--text-muted)]">{selectedRating}/5</span>
										{/if}
									</div>
								</div>
								<div>
									<p class="text-xs text-[var(--text-ghost)]">{$_('title.downloadMonitoring')}</p>
									<p class="mt-1 text-sm text-[var(--text-muted)]">
										{hasAssignedStatus && selectedMonitoringVariantIds.length > 0
											? $_('downloads.enabled')
											: $_('downloads.disabled')}
									</p>
									<p class="mt-2 text-[11px] text-[var(--text-ghost)]">
										{$_('title.monitoringSources')}
									</p>
									<div
										class="mt-2 max-h-28 space-y-1 overflow-auto border border-[var(--line)] bg-[var(--void-3)] p-2 {hasAssignedStatus
											? ''
											: 'opacity-50'}"
									>
										{#if title.variants.length === 0}
											<p class="text-xs text-[var(--text-ghost)]">{$_('common.noResults')}</p>
										{:else}
											{#each title.variants as variant (variant.id)}
												<label class="flex items-center gap-2 text-xs text-[var(--text)]">
													<input
														type="checkbox"
														checked={selectedMonitoringVariantIds.includes(variant.id)}
														disabled={!hasAssignedStatus}
														onchange={() => toggleMonitoringVariant(variant.id)}
													/>
													<span class="truncate">
														{variant.sourceName || variant.sourceId}
														{#if variant.sourceLang}
															[{variant.sourceLang}]
														{/if}
													</span>
												</label>
											{/each}
										{/if}
									</div>
								</div>
								<div>
									<p class="text-xs text-[var(--text-ghost)]">{$_('title.collections')}</p>
									<div
										class="mt-1 max-h-28 space-y-1 overflow-auto border border-[var(--line)] bg-[var(--void-3)] p-2 {hasAssignedStatus
											? ''
											: 'opacity-50'}"
									>
										{#if collections.length === 0}
											<p class="text-xs text-[var(--text-ghost)]">{$_('title.noCollections')}</p>
										{:else}
											{#each collections as collection (collection.id)}
												<label class="flex items-center gap-2 text-sm text-[var(--text)]">
													<input
														type="checkbox"
														checked={selectedCollectionIds.includes(collection.id)}
														disabled={!hasAssignedStatus}
														onchange={() => toggleCollection(collection.id)}
													/>
													<span>{collection.name}</span>
												</label>
											{/each}
										{/if}
									</div>
									<p class="mt-2 text-[11px] text-[var(--text-ghost)]">
										{$_('title.manageCollectionsInLibrary')}
									</p>
								</div>
							</div>
						{/if}
					{#if prefsError}
						<p class="mt-3 text-xs text-[var(--error)]">{prefsError}</p>
					{/if}
				</div>

				<div class="hidden md:block">
					<p class="text-sm leading-relaxed text-[var(--text-soft)]">
						{displayDescription || $_('title.noDescription')}
					</p>
				</div>
			</div>
		</div>

		<div class="md:hidden">
			<p
				class="text-sm leading-relaxed text-[var(--text-soft)] {!showFullDescription
					? 'line-clamp-3'
					: ''}"
			>
				{displayDescription || $_('title.noDescription')}
			</p>
			{#if displayDescription && displayDescription.length > 150}
				<button
					onclick={() => (showFullDescription = !showFullDescription)}
					class="mt-2 flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
				>
					{showFullDescription ? $_('common.less') : $_('common.more')}
					<Icon name={showFullDescription ? 'chevron-up' : 'chevron-down'} size={16} />
				</button>
			{/if}
		</div>

		<div class="flex gap-1 border-b border-[var(--line)]">
			<button
				type="button"
				class="px-4 py-2 text-sm transition-colors {activeTab === 'chapters'
					? 'border-b-2 border-[var(--text)] text-[var(--text)]'
					: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
				onclick={() => (activeTab = 'chapters')}
			>
				{$_('title.chapters')}
			</button>
			<button
				type="button"
				class="px-4 py-2 text-sm transition-colors {activeTab === 'info'
					? 'border-b-2 border-[var(--text)] text-[var(--text)]'
					: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
				onclick={() => (activeTab = 'info')}
			>
				{$_('title.info')}
			</button>
		</div>

		{#if activeTab === 'chapters'}
			{#if displayedChapters.length === 0}
				<div class="flex flex-col items-center gap-4 py-12 text-center">
					<div
						class="flex h-16 w-16 items-center justify-center border border-[var(--line)] bg-[var(--void-3)]"
					>
						<Icon name="book" size={24} class="text-[var(--text-ghost)]" />
					</div>
					<div>
						<p class="text-[var(--text)]">{$_('title.noChapters')}</p>
						<p class="mt-1 text-sm text-[var(--text-ghost)]">{$_('title.noChaptersDescription')}</p>
					</div>
				</div>
			{:else}
				<div class="flex flex-col divide-y divide-[var(--line)] border border-[var(--line)]">
					{#each displayedChapters as chapter (chapter.id)}
						{@const heading = chapterHeading(chapter)}
						<a
							href={buildReaderPath({
								titleId: title.libraryId,
								titleName: displayTitle || title.title,
								chapterId: chapter.id,
								chapterName: chapter.title,
								chapterNumber: chapter.number
							})}
							class="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-[var(--void-3)] {chapter.isRead
								? 'opacity-50'
								: ''}"
						>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									{#if heading.label}
										<span class="font-medium text-[var(--text)]">{heading.label}</span>
									{/if}
									{#if heading.detail}
										<span class="truncate text-[var(--text-muted)]">
											{heading.label ? `- ${heading.detail}` : heading.detail}
										</span>
									{/if}
								</div>
								<div class="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-ghost)]">
									<span>{formatDate(chapter.uploadDate)}</span>
									{#if chapter.scanlator}
										<span class="text-[var(--void-6)]">•</span>
										<span>{chapter.scanlator}</span>
									{/if}
								</div>
								{#if chapter.downloadError}
									<p class="mt-1 text-xs text-[var(--error)]">{chapter.downloadError}</p>
								{/if}
							</div>
							<div class="flex items-center gap-2 text-[var(--text-ghost)]">
								{#if chapter.isDownloaded}
									<Icon name="download" size={16} class="text-[var(--success)]" />
								{/if}
								{#if chapter.isRead}
									<Icon name="check" size={16} />
								{/if}
							</div>
						</a>
					{/each}
				</div>
			{/if}
		{:else}
			<div class="space-y-4 border border-[var(--line)] bg-[var(--void-2)] p-4">
				{#if displayAuthor}
					<div>
						<p class="text-xs text-[var(--text-ghost)]">{$_('title.author')}</p>
						<p class="text-[var(--text)]">{displayAuthor}</p>
					</div>
				{/if}
				{#if displayArtist && displayArtist !== displayAuthor}
					<div>
						<p class="text-xs text-[var(--text-ghost)]">{$_('title.artist')}</p>
						<p class="text-[var(--text)]">{displayArtist}</p>
					</div>
				{/if}
				{#if displayGenres.length}
					<div>
						<p class="text-xs text-[var(--text-ghost)]">{$_('title.genres')}</p>
						<p class="text-[var(--text)]">{displayGenres.join(', ')}</p>
					</div>
				{/if}
				<div>
					<p class="text-xs text-[var(--text-ghost)]">{$_('title.sources')}</p>
					<div class="mt-2 flex flex-wrap items-center gap-2">
						<input
							type="text"
							class="h-8 w-24 border border-[var(--line)] bg-[var(--void-3)] px-2 text-xs text-[var(--text)]"
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
						<p class="mt-2 text-xs text-[var(--error)]">{sourceMatchesError}</p>
					{/if}
					<div class="mt-2 space-y-2">
						{#each title.variants as variant (variant.id)}
							<button
								type="button"
								class="w-full border bg-[var(--void-3)] p-3 text-left transition-colors {variant.id ===
								selectedVariantId
									? 'border-[var(--text)]'
									: 'border-[var(--line)] hover:border-[var(--void-6)]'}"
								onclick={() => chooseReadingVariant(variant.id)}
							>
								<div class="flex items-center justify-between gap-2">
									<div class="flex min-w-0 items-center gap-2">
										<p class="truncate font-medium text-[var(--text)]">
											{variant.sourceName || variant.sourceId}
										</p>
										{#if variant.id === selectedVariantId}
											<span class="text-xs text-[var(--text-ghost)]">{$_('title.readingNow')}</span>
										{/if}
									</div>
									<span
										class="border border-[var(--line)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]"
									>
										{variant.sourceLang || '—'}
									</span>
								</div>
								<p class="mt-0.5 text-sm text-[var(--text-muted)]">{variant.title}</p>
							</button>
						{/each}
						{#if sourceMatchesLoaded}
							{#if sourceMatches.length === 0}
								<p class="text-xs text-[var(--text-ghost)]">{$_('title.noSourceMatches')}</p>
							{:else}
								{#each sourceMatches as match (sourceMatchKey(match))}
									<div class="border border-[var(--line)] bg-[var(--void-3)] p-3">
										<div class="flex items-center justify-between gap-2">
											<div class="min-w-0">
												<p class="font-medium text-[var(--text)]">
													{match.source_name}
													{#if match.source_lang}
														[{match.source_lang}]
													{/if}
												</p>
												<p class="truncate text-sm text-[var(--text-muted)]">{match.title}</p>
											</div>
											{#if match.linked_library_title_id && match.linked_library_title_id !== title.libraryId}
												<div class="flex items-center gap-2">
													<span class="text-xs text-[var(--text-ghost)]">
														{$_('title.linkedElsewhere')}
													</span>
													<Button
														variant="outline"
														size="sm"
														onclick={() => mergeSourceTitle(match)}
														disabled={linkingSourceKey === sourceMatchKey(match)}
														loading={linkingSourceKey === sourceMatchKey(match)}
													>
														{$_('title.mergeTitle')}
													</Button>
												</div>
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
									</div>
								{/each}
							{/if}
						{/if}
					</div>
				</div>
			</div>
		{/if}
	{:else}
		<div class="flex flex-col items-center gap-4 py-16 text-center">
			<div
				class="flex h-16 w-16 items-center justify-center border border-[var(--line)] bg-[var(--void-3)]"
			>
				<Icon name="book" size={24} class="text-[var(--text-ghost)]" />
			</div>
			<div>
				<p class="text-[var(--text)]">{$_('title.notFound')}</p>
				<p class="mt-1 text-sm text-[var(--text-ghost)]">
					{$libraryTitleDetailStore.error || $_('title.notFoundDescription')}
				</p>
			</div>
			<Button variant="outline" onclick={handleBack}>
				{$_('title.backToLibrary')}
			</Button>
		</div>
	{/if}
</div>
