<script lang="ts">
	import { goto } from '$app/navigation';
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
	import { Button } from '$lib/elements/button';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { _ } from '$lib/i18n';
	import { navigateBack, navHistoryRevision, resolveNavBackTarget } from '$lib/stores/nav-history';
	import { panelOverlayOpen } from '$lib/stores/ui';
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
			titleUrl: string;
			title: string;
			author?: string | null;
			artist?: string | null;
			description?: string | null;
			coverUrl?: string | null;
			genre?: string | null;
			status?: number | null;
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

	type CommandItem = {
		id: string;
		commandType: string;
		status: string;
		payload?: Record<string, unknown> | null;
		result?: Record<string, unknown> | null;
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
	const commandsQuery = useQuery(convexApi.commands.listMine, () => ({ limit: 100 }));
	const statusesQuery = useQuery(convexApi.library.listUserStatuses, () => ({}));
	const collectionsQuery = useQuery(convexApi.library.listCollections, () => ({}));

	let activeTab = $state<'info' | 'chapters' | 'comments'>('info');
	let showFullDescription = $state(false);
	let showManagementPanel = $state(false);
	let downloadingChapterIds = $state<string[]>([]);
	let updatingDownloadProfile = $state(false);
	let preferencesInitialized = $state(false);
	let preferencesSaving = $state(false);
	let actionError = $state<string | null>(null);
	let preferencesError = $state<string | null>(null);
	let preferencesSuccess = $state(false);
	let metadataRequested = $state(false);
	let fallbackMetadata = $state<{ author: string | null; artist: string | null } | null>(null);
	let selectedStatusId = $state<string | null>(null);
	let selectedRating = $state<number>(0);
	let selectedCollectionIds = $state<string[]>([]);
	let lastSyncedPreferenceSignature = $state('');

	const title = $derived((titleQuery.data as TitleDetail | null) ?? null);
	const sources = $derived((sourcesQuery.data ?? []) as SourceItem[]);
	const commands = $derived((commandsQuery.data ?? []) as CommandItem[]);
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
	const fetchedMetadata = $derived.by(() => {
		if (!title) return null;
		for (const item of commands) {
			if (item.commandType !== 'explore.title.fetch' || item.status !== 'succeeded') continue;
			const payload = item.payload ?? {};
			if (
				String(payload.sourceId ?? '') !== title.sourceId ||
				String(payload.titleUrl ?? '') !== title.titleUrl
			) {
				continue;
			}
			return (item.result?.title as Record<string, unknown> | null) ?? null;
		}
		return null;
	});

	const genres = $derived.by(() =>
		String(fetchedMetadata?.genre ?? title?.genre ?? '')
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean)
	);
	const sourcesCount = $derived(title?.variants.length ?? (title ? 1 : 0));
	const readingProgressCount = $derived(title?.readingProgress.startedChapters ?? 0);
	const sourceName = $derived.by(() => {
		if (!title) return '';
		return sources.find((item) => item.id === title.sourceId)?.name ?? title.sourcePkg;
	});
	const author = $derived.by(() =>
		String(fallbackMetadata?.author ?? fetchedMetadata?.author ?? title?.author ?? '').trim()
	);
	const artist = $derived.by(() =>
		String(fallbackMetadata?.artist ?? fetchedMetadata?.artist ?? title?.artist ?? '').trim()
	);
	const updatesEnabled = $derived(Boolean(title?.downloadProfile?.enabled));
	const selectedStatusLabel = $derived.by(
		() => availableStatuses.find((status) => status.id === selectedStatusId)?.label ?? null
	);
	const selectedCollectionCount = $derived(selectedCollectionIds.length);
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
		const status = Number(fetchedMetadata?.status ?? title?.status ?? 0);
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

	$effect(() => {
		if (preferencesInitialized) return;
		preferencesInitialized = true;
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
		if (!title || metadataRequested) return;
		if (author && artist) return;
		if (fetchedMetadata) return;
		metadataRequested = true;
		void client.mutation(convexApi.commands.enqueue, {
			commandType: 'explore.title.fetch',
			payload: {
				sourceId: title.sourceId,
				titleUrl: title.titleUrl
			}
		});
	});

	$effect(() => {
		if (!title) return;
		if (author && artist) return;
		if (fallbackMetadata !== null) return;
		void (async () => {
			try {
				const params = new URLSearchParams({
					sourcePkg: title.sourcePkg,
					titleUrl: title.titleUrl
				});
				const response = await fetch(`/api/title/metadata?${params.toString()}`);
				if (!response.ok) return;
				fallbackMetadata = (await response.json()) as { author: string | null; artist: string | null };
			} catch {
				fallbackMetadata = { author: null, artist: null };
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

	function chapterLabel(chapter: ChapterRow): string {
		if (chapter.chapterNumber && Number.isFinite(chapter.chapterNumber)) {
			const normalized = Number.isInteger(chapter.chapterNumber)
				? String(chapter.chapterNumber)
				: String(chapter.chapterNumber).replace(/\.0+$/, '');
			return $_('chapter.chapterShort', { values: { number: normalized } });
		}
		return chapter.chapterName || $_('title.noChapters');
	}

	function chapterDetail(chapter: ChapterRow): string | null {
		const raw = chapter.chapterName.trim();
		if (!raw) return null;
		const chapterShort = chapterLabel(chapter);
		if (raw === chapterShort) return null;
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
		void goto(buildReaderPath({ titleId: title._id, chapterId: startReadingChapter._id }));
	}

	function openChapter(chapterId: Id<'libraryChapters'>) {
		if (!title) return;
		void goto(buildReaderPath({ titleId: title._id, chapterId }));
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
												onclick={() => openChapter(chapter._id)}
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
				<span class="text-label">{$_('title.sources')}</span>
				<div class="flex items-start justify-between gap-3 text-sm">
					<div class="min-w-0">
						<div class="flex items-center gap-3">
							<span class="text-[var(--text)]">{sourceName}</span>
							{#if selectedStatusLabel}
								<span class="text-[var(--text-ghost)]">{selectedStatusLabel}</span>
							{/if}
						</div>
						<div class="mt-1 text-[var(--text-ghost)]">{title.title}</div>
					</div>
					<span class="text-[var(--text-ghost)]">{title.sourceLang}</span>
				</div>
				<p class="text-xs text-[var(--text-ghost)]">
					{selectedCollectionCount} {$_('title.collections').toLowerCase()}
				</p>
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
