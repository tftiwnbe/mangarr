<script lang="ts">
	import { browser } from '$app/environment';
	import { Dialog } from 'bits-ui';
	import { onMount } from 'svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import {
		ArrowClockwiseIcon,
		ClockCountdownIcon,
		HardDriveIcon,
		PlayIcon,
		SpinnerIcon,
		WarningCircleIcon
	} from 'phosphor-svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import { convexApi } from '$lib/convex/api';
	import { Alert } from '$lib/elements/alert';
	import { EmptyState } from '$lib/elements/empty-state';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { SearchInput } from '$lib/elements/search-input';
	import { Select } from '$lib/elements/select';
	import { Switch } from '$lib/elements/switch';
	import { toast } from '$lib/elements/toast';
	import { _ } from '$lib/i18n';
	import { buildTitlePath } from '$lib/utils/routes';

	type TaskStatus = 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';

	type DashboardData = {
		generatedAt: number | null;
		overview: {
			downloadedChapters: number;
			totalChapters: number;
			avgChapterSizeBytes: number;
		};
		activeTasks: DashboardTask[];
		recentTasks: DashboardTask[];
		watchedTitles: WatchedTitle[];
		watchedTotal: number;
	};

	type DashboardTask = {
		taskId: string;
		chapterId: Id<'libraryChapters'>;
		titleId: Id<'libraryTitles'>;
		title: string;
		chapter: string;
		chapterUrl: string;
		status: TaskStatus;
		progressPercent: number;
		isPaused: boolean;
		error: string | null;
		coverUrl: string | null;
		localCoverPath: string | null;
		localRelativePath: string | null;
		storageKind: 'directory' | 'archive' | null;
		fileSizeBytes: number | null;
		updatedAt: number;
	};

	type WatchedTitle = {
		titleId: Id<'libraryTitles'>;
		title: string;
		coverUrl: string | null;
		localCoverPath: string | null;
		enabled: boolean;
		paused: boolean;
		autoDownload: boolean;
		downloadedChapters: number;
		totalChapters: number;
		queuedTasks: number;
		downloadedBytes: number;
		variantSources: string[];
		lastError: string | null;
		nextRetryAt: number | null;
		updatedAt: number;
	};

	type DownloadSettings = {
		totalSpaceBytes?: number;
		usedSpaceBytes?: number;
		freeSpaceBytes?: number;
	};

type ReconcileResult = {
	ok?: boolean;
	fixed?: number;
	downloaded?: number;
	missing?: number;
	message?: string;
	nextCursor?: number | null;
	totalTitles?: number;
	processedTitles?: number;
};

	type NormalizeResult = {
		ok?: boolean;
		dryRun?: boolean;
		normalized?: number;
		pruned?: number;
		conflicts?: number;
		missing?: number;
		fixed?: number;
		scanned?: number;
		normalizeCandidates?: number;
		pruneCandidates?: number;
		nextCursor?: number | null;
		totalTitles?: number;
		processedTitles?: number;
		message?: string;
	};

	type RunDownloadCycleResult = {
		checked: number;
		enqueued: number;
		eligibleChapters?: number;
		blocked?: 'in_flight' | 'capacity' | 'no_candidates' | null;
	};

	type RetryMissingDownloadsResult = {
		enqueued: number;
		deferred: number;
		retriedQueued?: number;
		blocked?: 'capacity' | 'no_candidates' | null;
	};

	type WatchedSortValue =
		| 'name-asc'
		| 'updated-desc'
		| 'progress-desc'
		| 'size-desc'
		| 'chapters-desc';

	const client = useConvexClient();
	let watchedVisibleCount = $state(10);
	const dashboardQuery = useQuery(convexApi.library.getDownloadDashboard, () => ({
		activeLimit: 100,
		recentLimit: 40
	}));
	const activeProgressQuery = useQuery(convexApi.library.getActiveDownloadProgress, () => ({
		limit: 100
	}));

	let runningAction = $state<string | null>(null);
	let profileActionTitleId = $state<string | null>(null);
	let taskActionKey = $state<string | null>(null);
	let storage = $state<DownloadSettings | null>(null);
	let reconcileLoading = $state(false);
	let reconcileError = $state<string | null>(null);
	let reconcileResult = $state<ReconcileResult | null>(null);
	let normalizeLoading = $state(false);
	let normalizeError = $state<string | null>(null);
	let normalizeResult = $state<NormalizeResult | null>(null);
	let failuresDialogOpen = $state(false);
	let actionError = $state<string | null>(null);
	let watchedSentinel = $state<HTMLDivElement | null>(null);
	let watchedIntersectionObserver: IntersectionObserver | null = null;
	let watchedSearchQuery = $state('');
	let watchedSort = $state<WatchedSortValue>('name-asc');

	const dashboard = $derived(
		(dashboardQuery.data as DashboardData | null) ?? {
			generatedAt: null,
			overview: {
				downloadedChapters: 0,
				totalChapters: 0,
				avgChapterSizeBytes: 0
			},
			activeTasks: [],
			recentTasks: [],
			watchedTitles: [],
			watchedTotal: 0
		}
	);
	const isLoading = $derived(dashboardQuery.isLoading);
	const numberFormatter = new Intl.NumberFormat();

	const activeDownloads = $derived(
		((activeProgressQuery.data as unknown as { tasks: DashboardTask[] } | null)?.tasks ?? [])
			.slice()
			.sort((a, b) => a.chapterId.localeCompare(b.chapterId))
	);

	const failedRecentTasks = $derived(
		dashboard.recentTasks.filter((task) => task.status === 'failed')
	);
	const watchedSearchValue = $derived(watchedSearchQuery.trim().toLowerCase());
	const watchedSortOptions = $derived([
		{ value: 'name-asc', label: 'Name' },
		{ value: 'updated-desc', label: 'Updated' },
		{ value: 'progress-desc', label: 'Progress' },
		{ value: 'size-desc', label: 'Size' },
		{ value: 'chapters-desc', label: 'Chapters' }
	]);

	const chapterProgress = $derived(
		dashboard.overview.totalChapters > 0
			? (dashboard.overview.downloadedChapters / dashboard.overview.totalChapters) * 100
			: 0
	);
	const filteredWatchedTitles = $derived.by(() => {
		const query = watchedSearchValue;
		const filtered =
			query.length === 0
				? dashboard.watchedTitles.slice()
				: dashboard.watchedTitles.filter((item) => {
						const haystack = [
							item.title,
							item.variantSources.join(' '),
							item.lastError ?? ''
						]
							.join(' ')
							.toLowerCase();
						return haystack.includes(query);
					});

		filtered.sort((left, right) => compareWatchedTitles(left, right, watchedSort));
		return filtered;
	});
	const canLoadMoreWatched = $derived(watchedVisibleCount < filteredWatchedTitles.length);
	const visibleWatchedTitles = $derived(filteredWatchedTitles.slice(0, watchedVisibleCount));

	onMount(() => {
		void loadStorage();
		return () => {
			watchedIntersectionObserver?.disconnect();
			watchedIntersectionObserver = null;
		};
	});

	function resetWatchedObserver() {
		watchedIntersectionObserver?.disconnect();
		watchedIntersectionObserver = null;
	}

	function compareWatchedTitles(
		left: WatchedTitle,
		right: WatchedTitle,
		sortValue: WatchedSortValue
	) {
		switch (sortValue) {
			case 'updated-desc':
				if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt;
				break;
			case 'progress-desc': {
				const leftComplete =
					left.totalChapters > 0 && left.downloadedChapters >= left.totalChapters ? 1 : 0;
				const rightComplete =
					right.totalChapters > 0 && right.downloadedChapters >= right.totalChapters ? 1 : 0;
				if (leftComplete !== rightComplete) return leftComplete - rightComplete;

				const leftProgress =
					left.totalChapters > 0
						? left.downloadedChapters / left.totalChapters
						: Number.POSITIVE_INFINITY;
				const rightProgress =
					right.totalChapters > 0
						? right.downloadedChapters / right.totalChapters
						: Number.POSITIVE_INFINITY;
				if (leftProgress !== rightProgress) return leftProgress - rightProgress;

				const leftRemaining = Math.max(0, left.totalChapters - left.downloadedChapters);
				const rightRemaining = Math.max(0, right.totalChapters - right.downloadedChapters);
				if (rightRemaining !== leftRemaining) return rightRemaining - leftRemaining;

				if (right.queuedTasks !== left.queuedTasks) return right.queuedTasks - left.queuedTasks;
				break;
			}
			case 'size-desc':
				if (right.downloadedBytes !== left.downloadedBytes) {
					return right.downloadedBytes - left.downloadedBytes;
				}
				break;
			case 'chapters-desc':
				if (right.totalChapters !== left.totalChapters) {
					return right.totalChapters - left.totalChapters;
				}
				break;
			case 'name-asc':
			default:
				break;
		}

		return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
	}

	async function maybeLoadMoreWatched() {
		if (dashboardQuery.isLoading || !canLoadMoreWatched) return;
		watchedVisibleCount += 10;
	}

	function getBrowserFetch(): typeof window.fetch {
		if (!browser) {
			throw new Error('Browser fetch is unavailable during server-side rendering');
		}

		return window.fetch.bind(window);
	}

	function coverSrc(item: {
		titleId: Id<'libraryTitles'>;
		localCoverPath?: string | null;
		coverUrl?: string | null;
	}) {
		if (item.localCoverPath) {
			const params = new URLSearchParams({ titleId: String(item.titleId) });
			return `/api/internal/bridge/library/cover?${params.toString()}`;
		}
		return item.coverUrl ?? '';
	}

	async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
		const response = await getBrowserFetch()(url, init);
		const payload = (await response.json().catch(() => null)) as { message?: string } & T;
		if (!response.ok) {
			throw new Error(payload?.message ?? 'Request failed');
		}
		return payload;
	}

	async function loadStorage() {
		try {
			storage = await fetchJson<DownloadSettings>('/api/internal/bridge/settings/downloads');
		} catch {
			storage = null;
		}
	}

	async function handleRunWatch() {
		runningAction = 'cycle';
		actionError = null;
		try {
			const result = await client.mutation(convexApi.library.runDownloadCycle, {
				limit: 25
			});
			notifyRunCycleResult(result as RunDownloadCycleResult);
		} catch (cause) {
			actionError = cause instanceof Error ? cause.message : 'Failed to run downloads';
			toast.error(actionError, { title: 'Run now failed' });
		} finally {
			runningAction = null;
		}
	}

	async function handleReconcileDownloads() {
		reconcileLoading = true;
		reconcileError = null;
		try {
			let cursor = 0;
			let aggregated: ReconcileResult = {
				ok: true,
				fixed: 0,
				downloaded: 0,
				missing: 0,
				totalTitles: 0,
				processedTitles: 0,
				nextCursor: null
			};
			while (true) {
				const batch = await fetchJson<ReconcileResult>('/api/internal/bridge/downloads/reconcile', {
					method: 'POST',
					headers: {
						'content-type': 'application/json'
					},
					body: JSON.stringify({
						cursor,
						maxTitles: 8,
						repairMissing: true
					})
				});
				aggregated = {
					...aggregated,
					fixed: (aggregated.fixed ?? 0) + (batch.fixed ?? 0),
					downloaded: (aggregated.downloaded ?? 0) + (batch.downloaded ?? 0),
					missing: (aggregated.missing ?? 0) + (batch.missing ?? 0),
					totalTitles: batch.totalTitles ?? aggregated.totalTitles ?? 0,
					processedTitles: (aggregated.processedTitles ?? 0) + (batch.processedTitles ?? 0),
					nextCursor: batch.nextCursor ?? null
				};
				reconcileResult = aggregated;
				if (batch.nextCursor == null) {
					break;
				}
				cursor = batch.nextCursor;
			}
			await loadStorage();
		} catch (cause) {
			reconcileError = cause instanceof Error ? cause.message : 'Failed to reconcile downloads';
		} finally {
			reconcileLoading = false;
		}
	}

	async function handleNormalizeDownloads() {
		normalizeLoading = true;
		normalizeError = null;
		try {
			let reconcileCursor = 0;
			while (true) {
				const batch = await fetchJson<ReconcileResult>('/api/internal/bridge/downloads/reconcile', {
					method: 'POST',
					headers: {
						'content-type': 'application/json'
					},
					body: JSON.stringify({
						cursor: reconcileCursor,
						maxTitles: 8,
						repairMissing: false
					})
				});
				if (batch.nextCursor == null) {
					break;
				}
				reconcileCursor = batch.nextCursor;
			}

			let cursor = 0;
			let aggregated: NormalizeResult = {
				ok: true,
				dryRun: false,
				normalized: 0,
				pruned: 0,
				conflicts: 0,
				missing: 0,
				fixed: 0,
				scanned: 0,
				normalizeCandidates: 0,
				pruneCandidates: 0,
				totalTitles: 0,
				processedTitles: 0,
				nextCursor: null
			};
			while (true) {
				const batch = await fetchJson<NormalizeResult>('/api/internal/bridge/downloads/normalize', {
					method: 'POST',
					headers: {
						'content-type': 'application/json'
					},
					body: JSON.stringify({
						cursor,
						maxTitles: 8
					})
				});
				aggregated = {
					...aggregated,
					normalized: (aggregated.normalized ?? 0) + (batch.normalized ?? 0),
					pruned: (aggregated.pruned ?? 0) + (batch.pruned ?? 0),
					conflicts: (aggregated.conflicts ?? 0) + (batch.conflicts ?? 0),
					missing: (aggregated.missing ?? 0) + (batch.missing ?? 0),
					fixed: (aggregated.fixed ?? 0) + (batch.fixed ?? 0),
					scanned: (aggregated.scanned ?? 0) + (batch.scanned ?? 0),
					normalizeCandidates:
						(aggregated.normalizeCandidates ?? 0) + (batch.normalizeCandidates ?? 0),
					pruneCandidates: (aggregated.pruneCandidates ?? 0) + (batch.pruneCandidates ?? 0),
					totalTitles: batch.totalTitles ?? aggregated.totalTitles ?? 0,
					processedTitles:
						(aggregated.processedTitles ?? 0) + (batch.processedTitles ?? 0),
					nextCursor: batch.nextCursor ?? null
				};
				normalizeResult = aggregated;
				if (batch.nextCursor == null) {
					break;
				}
				cursor = batch.nextCursor;
			}
			await loadStorage();
		} catch (cause) {
			normalizeError = cause instanceof Error ? cause.message : 'Failed to normalize downloads';
		} finally {
			normalizeLoading = false;
		}
	}

	async function toggleWatch(titleId: Id<'libraryTitles'>, enabled: boolean) {
		if (profileActionTitleId === titleId) return;
		profileActionTitleId = titleId;
		actionError = null;
		try {
			await client.mutation(convexApi.library.updateDownloadProfile, {
				titleId,
				enabled
			});
		} catch (cause) {
			actionError = cause instanceof Error ? cause.message : 'Failed to update download profile';
		} finally {
			profileActionTitleId = null;
		}
	}

	async function retryMissingForTitle(titleId: Id<'libraryTitles'>) {
		const actionKey = `retry-title:${titleId}`;
		if (taskActionKey === actionKey) return;
		taskActionKey = actionKey;
		actionError = null;
		try {
			const result = await client.mutation(convexApi.library.requestMissingDownloads, {
				titleId
			});
			notifyRetryResult(result as RetryMissingDownloadsResult);
		} catch (cause) {
			actionError = cause instanceof Error ? cause.message : 'Failed to queue missing downloads';
			toast.error(actionError, { title: 'Retry failed' });
		} finally {
			taskActionKey = null;
		}
	}

	function notifyRunCycleResult(result: RunDownloadCycleResult) {
		if (result.enqueued > 0) {
			const eligible = result.eligibleChapters ?? result.enqueued;
			toast.success(`Queued ${result.enqueued} chapters from ${eligible} available picks.`, {
				title: 'Downloads queued'
			});
			return;
		}
		if (result.blocked === 'in_flight') {
			toast.info('Downloads are already active. Wait for current tasks to clear first.', {
				title: 'Queue already busy'
			});
			return;
		}
		if (result.blocked === 'capacity') {
			toast.info('Download slots are full right now. Wait for queued items to start or finish.', {
				title: 'No free slots'
			});
			return;
		}
		toast.info('No eligible chapters were found for watched titles.', {
			title: 'Nothing to queue'
		});
	}

	function notifyRetryResult(result: RetryMissingDownloadsResult) {
		const retriedQueued = result.retriedQueued ?? 0;
		if (result.enqueued > 0 || retriedQueued > 0) {
			const parts: string[] = [];
			if (result.enqueued > 0) {
				parts.push(`queued ${result.enqueued} missing chapters`);
			}
			if (retriedQueued > 0) {
				parts.push(`reissued ${retriedQueued} stuck queue entries`);
			}
			if (result.deferred > 0) {
				parts.push(`${result.deferred} deferred`);
			}
			toast.success(`${parts.join(', ')}.`, { title: 'Retry requested' });
			return;
		}
		if (result.blocked === 'capacity') {
			toast.info('Download slots are full right now. Retry again after active tasks move forward.', {
				title: 'No free slots'
			});
			return;
		}
		toast.info('No missing or failed chapters were found for this title.', {
			title: 'Nothing to retry'
		});
	}

	function formatBytes(bytes: number): string {
		if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let value = bytes;
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value /= 1024;
			unit += 1;
		}
		const decimals = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
		return `${value.toFixed(decimals)} ${units[unit]}`;
	}

	const chapterStat = $derived.by(() => {
		const downloaded = Math.max(0, dashboard.overview.downloadedChapters);
		const total = Math.max(0, dashboard.overview.totalChapters);
		return {
			downloaded: numberFormatter.format(downloaded),
			total: numberFormatter.format(total)
		};
	});

	const capacityStat = $derived.by(() => {
		const freeSpace = storage?.freeSpaceBytes ?? 0;
		const avg = dashboard.overview.avgChapterSizeBytes;
		const capacity = avg > 0 && freeSpace > 0 ? Math.floor(freeSpace / avg) : 0;
		return {
			capacity: numberFormatter.format(capacity),
			free: formatBytes(freeSpace)
		};
	});

	function taskActionLoading(kind: string, taskId: string) {
		return taskActionKey === `${kind}:${taskId}`;
	}

	function formatRetryIn(retryAt: number): string {
		const ms = retryAt - Date.now();
		if (ms <= 0) return 'soon';
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		if (hours >= 1) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
		if (minutes >= 1) return `${minutes}m`;
		return `${totalSeconds}s`;
	}

	$effect(() => {
		const resetKey = `${watchedSearchValue}:${watchedSort}`;
		void resetKey;
		watchedVisibleCount = 10;
	});

	$effect(() => {
		if (typeof window === 'undefined' || !watchedSentinel || !canLoadMoreWatched) {
			resetWatchedObserver();
			return;
		}
		resetWatchedObserver();
		watchedIntersectionObserver = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					void maybeLoadMoreWatched();
				}
			},
			{
				root: null,
				rootMargin: '720px 0px 720px 0px',
				threshold: 0
			}
		);
		watchedIntersectionObserver.observe(watchedSentinel);
	});
</script>

<svelte:head>
	<title>{$_('nav.downloads')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-7">
	<header class="flex items-end justify-between gap-3">
		<h1 class="text-display text-xl leading-none text-[var(--text)]">
			{$_('nav.downloads').toLowerCase()}
		</h1>
		<div class="flex items-center gap-1">
			{#if failedRecentTasks.length > 0}
				<button
					type="button"
					class="group/btn flex h-8 items-center gap-1.5 px-2 text-[rgba(248,113,113,0.76)] transition-colors hover:text-[rgba(248,113,113,0.96)]"
					onclick={() => (failuresDialogOpen = true)}
					title="Recent failures"
					aria-label="Recent failures"
				>
					<WarningCircleIcon size={15} weight="duotone" />
					<span class="text-[10px] tabular-nums">{failedRecentTasks.length}</span>
				</button>
			{/if}
			<button
				type="button"
				class="group/btn flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text)] disabled:opacity-40"
				onclick={handleRunWatch}
				disabled={runningAction !== null}
				title={$_('downloads.runNow')}
				aria-label={$_('downloads.runNow')}
			>
				{#if runningAction === 'cycle'}
					<SpinnerIcon size={15} class="animate-spin" />
				{:else}
					<PlayIcon size={15} weight="duotone" />
				{/if}
			</button>
			<button
				type="button"
				class="group/btn flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text)] disabled:opacity-40"
				onclick={handleReconcileDownloads}
				disabled={reconcileLoading}
				title={$_('downloads.scanDownloads')}
				aria-label={$_('downloads.scanDownloads')}
			>
				{#if reconcileLoading}
					<SpinnerIcon size={15} class="animate-spin" />
				{:else}
					<HardDriveIcon size={15} weight="duotone" />
				{/if}
			</button>
			<button
				type="button"
				class="group/btn flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text)] disabled:opacity-40"
				onclick={handleNormalizeDownloads}
				disabled={normalizeLoading}
				title="Check storage"
				aria-label="Check storage"
			>
				{#if normalizeLoading}
					<SpinnerIcon size={15} class="animate-spin" />
				{:else}
					<ArrowClockwiseIcon size={15} weight="duotone" />
				{/if}
			</button>
		</div>
	</header>

	<section class="flex flex-col gap-3">
		<div class="flex flex-col gap-2">
			<div class="flex items-baseline justify-between gap-3">
				<span class="text-display text-2xl leading-none text-[var(--text)] tabular-nums">
					{chapterStat.downloaded}<span class="text-base text-[var(--text-ghost)]"
						>/{chapterStat.total}</span
					>
				</span>
				<span class="text-[10px] leading-none tracking-[0.24em] text-[var(--text-ghost)] uppercase">
					{$_('downloads.chaptersShort')}
				</span>
			</div>
			<div class="relative h-[2px] w-full overflow-hidden bg-[var(--void-4)]">
				<div
					class="absolute inset-y-0 left-0 bg-[var(--cosmic-dim)]"
					style="width: {chapterProgress}%"
				></div>
			</div>
		</div>
		<div class="flex items-center gap-3 text-[11px] text-[var(--text-muted)] tabular-nums">
			<span
				>{formatBytes(dashboard.overview.avgChapterSizeBytes)}
				<span class="tracking-[0.12em] text-[var(--text-ghost)] uppercase">avg</span></span
			>
			<span class="text-[var(--void-6)]">·</span>
			<span
				>{capacityStat.capacity}
				<span class="tracking-[0.12em] text-[var(--text-ghost)] uppercase"
					>{$_('downloads.capacityShort')}</span
				></span
			>
			<span class="text-[var(--void-6)]">·</span>
			<span
				>{capacityStat.free}
				<span class="tracking-[0.12em] text-[var(--text-ghost)] uppercase">free</span></span
			>
		</div>
	</section>

	{#if reconcileResult || reconcileError}
		<div class="flex flex-col gap-1 border-l border-[var(--line)] pl-3">
			{#if reconcileResult}
				<p class="text-[11px] text-[var(--text-muted)]">
					Fixed {reconcileResult.fixed ?? 0} · found {reconcileResult.downloaded ?? 0} stored · {reconcileResult.missing ??
						0} missing
				</p>
			{/if}
			{#if reconcileError}
				<Alert variant="error">{reconcileError}</Alert>
			{/if}
		</div>
	{/if}

	{#if normalizeResult || normalizeError}
		<div class="flex flex-col gap-1 border-l border-[var(--line)] pl-3">
			{#if normalizeResult}
				<p class="text-[11px] text-[var(--text-muted)]">
					Processed {normalizeResult.scanned ?? 0} chapters across {normalizeResult.processedTitles ?? 0}/{normalizeResult.totalTitles ??
						0} titles · repaired {normalizeResult.fixed ?? 0} · relocated {normalizeResult.normalized ?? 0} · pruned {normalizeResult.pruned ??
						0} · missing or damaged {normalizeResult.missing ?? 0}
				</p>
			{/if}
			{#if normalizeError}
				<Alert variant="error">{normalizeError}</Alert>
			{/if}
		</div>
	{/if}

	{#if actionError}
		<Alert variant="error">{actionError}</Alert>
	{/if}

	<!-- Inflight -->
	<section class="flex flex-col gap-2">
		<header class="flex items-center gap-2 px-0.5">
			<span
				class="h-1 w-1 rounded-full {activeDownloads.length > 0
					? 'animate-pulse bg-[var(--cosmic)] shadow-[0_0_8px_var(--cosmic-glow)]'
					: 'bg-[var(--void-6)]'}"
			></span>
			<h2 class="text-[10px] tracking-[0.24em] text-[var(--text-ghost)] uppercase">
				{activeDownloads.length > 0 ? $_('downloads.inflight') : $_('downloads.standby')}
			</h2>
			{#if activeDownloads.length > 0}
				<span class="text-[10px] text-[var(--text-ghost)] tabular-nums">
					{activeDownloads.length}
				</span>
			{/if}
		</header>

		{#if activeDownloads.length === 0}
			<div class="px-0.5 py-3 text-[11px] text-[var(--text-muted)]">
				{$_('downloads.noDownloading')}
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#each activeDownloads as task (task.chapterId)}
					<article class="flex h-[72px] gap-3 py-2">
						<a href={buildTitlePath(task.titleId, task.title)} class="shrink-0">
							<div
								class="relative h-14 w-10 overflow-hidden bg-[var(--void-3)] shadow-[0_0_0_1px_var(--cosmic-halo),0_0_14px_-4px_var(--cosmic-halo)]"
							>
								<LazyImage
									src={coverSrc(task)}
									alt={task.title}
									class="absolute inset-0 h-full w-full"
								/>
							</div>
						</a>
						<div class="flex min-w-0 flex-1 flex-col justify-center gap-1">
							<a
								href={buildTitlePath(task.titleId, task.title)}
								class="flex items-baseline justify-between gap-2"
							>
								<p class="line-clamp-1 text-sm leading-tight text-[var(--text)]">{task.title}</p>
								<span
									class="shrink-0 text-[11px] leading-none text-[var(--text-soft)] tabular-nums"
								>
									{task.progressPercent > 0 ? `${task.progressPercent}%` : '···'}
								</span>
							</a>
							<div class="flex items-center gap-2">
								<p class="min-w-0 truncate text-xs leading-tight text-[var(--text-muted)]">
									{task.chapter}
								</p>
								{#if task.fileSizeBytes && task.fileSizeBytes > 0}
									<span class="shrink-0 text-[10px] text-[var(--text-ghost)] tabular-nums"
										>{formatBytes(task.fileSizeBytes)}</span
									>
								{/if}
							</div>
							<div class="relative h-[2px] w-full overflow-hidden bg-[var(--void-4)]">
								{#if task.progressPercent > 0}
									<div
										class="absolute inset-y-0 left-0 bg-[var(--cosmic)] shadow-[0_0_10px_var(--cosmic-glow)] transition-[width] duration-300"
										style="width: {task.progressPercent}%"
									></div>
								{:else}
									<div
										class="absolute inset-y-0 left-0 w-full animate-pulse bg-[var(--cosmic-soft)]"
									></div>
								{/if}
							</div>
						</div>
					</article>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Watched -->
	<section class="flex flex-col gap-2">
		<header class="flex items-center gap-2 px-0.5">
			<span class="h-1 w-1 rounded-full bg-[var(--void-6)]"></span>
			<h2 class="text-[10px] tracking-[0.24em] text-[var(--text-ghost)] uppercase">
				{$_('downloads.watched')}
			</h2>
			{#if filteredWatchedTitles.length > 0}
				<span class="text-[10px] text-[var(--text-ghost)] tabular-nums">
					{filteredWatchedTitles.length}
					{#if watchedSearchValue && filteredWatchedTitles.length !== dashboard.watchedTitles.length}
						/{dashboard.watchedTitles.length}
					{/if}
				</span>
			{/if}
		</header>

		{#if isLoading && !dashboard.generatedAt}
			<div class="flex items-center justify-center py-16">
				<SpinnerIcon size={16} class="animate-spin text-[var(--text-ghost)]" />
			</div>
		{:else if dashboard.watchedTitles.length === 0}
			<EmptyState
				icon={HardDriveIcon}
				title={$_('downloads.noWatched')}
				description={$_('downloads.noWatchedDescription')}
			/>
		{:else}
			<div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8.5rem]">
				<SearchInput
					bind:value={watchedSearchQuery}
					placeholder="search downloads..."
					inputSize="sm"
				/>
				<Select bind:value={watchedSort} options={watchedSortOptions} size="sm" />
			</div>

			{#if filteredWatchedTitles.length === 0}
				<div class="px-0.5 py-6 text-[11px] text-[var(--text-muted)]">
					No watched downloads match this search.
				</div>
			{:else}
			<ul class="flex flex-col">
				{#each visibleWatchedTitles as item (item.titleId)}
					{@const progress =
						item.totalChapters > 0
							? Math.round((item.downloadedChapters / item.totalChapters) * 100)
							: 0}
					{@const isDownloading = item.queuedTasks > 0}
					{@const retryActive = taskActionLoading('retry-title', item.titleId)}
					<li class="group flex gap-3 py-3 transition-opacity {item.enabled ? '' : 'opacity-35'}">
						<a href={buildTitlePath(item.titleId, item.title)} class="shrink-0 self-start">
							<div
								class="relative h-20 w-14 overflow-hidden bg-[var(--void-3)] ring-1 ring-[var(--void-4)] transition-all group-hover:ring-[var(--void-6)]"
							>
								<LazyImage
									src={coverSrc(item)}
									alt={item.title}
									class="absolute inset-0 h-full w-full"
								/>
							</div>
						</a>
						<div class="flex min-w-0 flex-1 flex-col gap-1.5">
							<a
								href={buildTitlePath(item.titleId, item.title)}
								class="flex min-w-0 flex-col gap-0.5"
							>
								<div class="flex items-baseline justify-between gap-2">
									<p class="line-clamp-1 text-sm text-[var(--text)]">{item.title}</p>
									<span
										class="shrink-0 text-[11px] leading-none text-[var(--text-soft)] tabular-nums"
									>
										{item.downloadedChapters}<span class="text-[var(--text-ghost)]"
											>/{item.totalChapters || '—'}</span
										>
									</span>
								</div>
								{#if item.variantSources.length > 0 || item.downloadedBytes > 0}
									<div class="flex items-center gap-2 text-[10px] text-[var(--text-ghost)]">
										{#if item.variantSources.length > 0}
											<span class="truncate tracking-wide uppercase">
												{item.variantSources.join(' · ')}
											</span>
										{/if}
										{#if item.downloadedBytes > 0}
											<span class="shrink-0 tabular-nums">
												{formatBytes(item.downloadedBytes)}
											</span>
										{/if}
										{#if item.paused}
											<span class="text-[var(--text-muted)]">
												{$_('downloads.paused').toLowerCase()}
											</span>
										{/if}
									</div>
								{/if}
								{#if item.lastError}
									<div
										class="flex min-w-0 items-start gap-1 text-[10px] leading-tight text-[rgba(248,113,113,0.7)]"
									>
										<WarningCircleIcon size={10} class="mt-px shrink-0 opacity-70" />
										<span class="line-clamp-2 min-w-0">{item.lastError}</span>
									</div>
								{/if}
							</a>

							<div class="flex items-center justify-end gap-2">
								{#if item.queuedTasks > 0 && !(item.nextRetryAt != null && item.nextRetryAt > Date.now())}
									<span class="mr-auto text-[10px] text-[var(--cosmic-dim)] tabular-nums">
										+{item.queuedTasks}
										{$_('downloads.queued').toLowerCase()}
									</span>
								{/if}
								{#if item.nextRetryAt != null && item.nextRetryAt > Date.now()}
									<span
										class="flex items-center gap-1 text-[10px] text-[var(--text-ghost)] tabular-nums"
									>
										<ClockCountdownIcon size={10} class="shrink-0" />
										{formatRetryIn(item.nextRetryAt)}
									</span>
								{/if}
								<button
									type="button"
									class="flex h-6 w-6 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)] disabled:opacity-40"
									onclick={() => void retryMissingForTitle(item.titleId)}
									disabled={retryActive}
									title={$_('downloads.retry')}
									aria-label={$_('downloads.retry')}
								>
									{#if retryActive}
										<SpinnerIcon size={12} class="animate-spin" />
									{:else}
										<ArrowClockwiseIcon size={12} />
									{/if}
								</button>
								<Switch
									checked={item.enabled}
									disabled={profileActionTitleId === item.titleId}
									loading={profileActionTitleId === item.titleId}
									variant="default"
									onCheckedChange={(enabled) => void toggleWatch(item.titleId, enabled)}
								/>
							</div>

							<div class="relative h-[2px] w-full overflow-hidden bg-[var(--void-4)]">
								<div
									class="absolute inset-y-0 left-0 transition-[width] {isDownloading
										? 'animate-pulse bg-[var(--cosmic)] shadow-[0_0_10px_var(--cosmic-glow)]'
										: 'bg-[var(--void-7)]'}"
									style="width: {progress}%"
								></div>
							</div>
						</div>
					</li>
				{/each}
			</ul>
			{#if canLoadMoreWatched}
				<div bind:this={watchedSentinel} class="flex items-center justify-center py-5">
					{#if dashboardQuery.isLoading}
						<SpinnerIcon size={14} class="animate-spin text-[var(--text-ghost)]" />
					{:else}
						<span class="text-[10px] tracking-[0.16em] text-[var(--text-ghost)] uppercase">
							Loading more
						</span>
					{/if}
				</div>
			{/if}
			{/if}
		{/if}
	</section>
</div>

<Dialog.Root bind:open={failuresDialogOpen}>
	<Dialog.Portal>
		<Dialog.Overlay
			class="animate-fade-in fixed inset-0 z-[70] bg-[var(--void-0)]/85 backdrop-blur-sm"
		/>
		<Dialog.Content
			class="animate-scale-in fixed top-1/2 left-1/2 z-[70] flex max-h-[min(40rem,calc(100vh-2rem))] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col border border-[var(--line)] bg-[var(--void-1)] shadow-[0_20px_60px_-24px_rgba(0,0,0,0.75)] focus:outline-none"
		>
			<div class="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-4">
				<div class="flex items-center gap-2">
					<WarningCircleIcon size={14} class="text-[rgba(248,113,113,0.82)]" />
					<Dialog.Title class="text-sm text-[var(--text)]">Recent failures</Dialog.Title>
				</div>
				<button
					type="button"
					class="text-xs text-[var(--text-ghost)] transition-colors hover:text-[var(--text)]"
					onclick={() => (failuresDialogOpen = false)}
				>
					Close
				</button>
			</div>
			<div class="overflow-y-auto px-4 py-3">
				{#if failedRecentTasks.length === 0}
					<p class="py-6 text-center text-[11px] text-[var(--text-muted)]">
						No recent failures.
					</p>
				{:else}
					<ul class="flex flex-col">
						{#each failedRecentTasks as task (task.taskId)}
							<li class="flex gap-3 py-3">
								<a href={buildTitlePath(task.titleId, task.title)} class="shrink-0 self-start">
									<div
										class="relative h-16 w-11 overflow-hidden bg-[var(--void-3)] ring-1 ring-[rgba(248,113,113,0.15)]"
									>
										<LazyImage
											src={coverSrc(task)}
											alt={task.title}
											class="absolute inset-0 h-full w-full"
										/>
									</div>
								</a>
								<div class="flex min-w-0 flex-1 flex-col gap-1">
									<a
										href={buildTitlePath(task.titleId, task.title)}
										class="flex min-w-0 flex-col gap-0.5"
									>
										<div class="flex items-baseline justify-between gap-2">
											<p class="line-clamp-1 text-sm text-[var(--text)]">{task.title}</p>
											<span class="shrink-0 text-[10px] text-[var(--text-ghost)] tabular-nums">
												{new Date(task.updatedAt).toLocaleDateString()}
											</span>
										</div>
										<p class="truncate text-xs text-[var(--text-muted)]">{task.chapter}</p>
									</a>
									{#if task.error}
										<div
											class="flex min-w-0 items-start gap-1 text-[11px] leading-tight text-[rgba(248,113,113,0.76)]"
										>
											<WarningCircleIcon size={11} class="mt-px shrink-0 opacity-70" />
											<span class="line-clamp-3 min-w-0">{task.error}</span>
										</div>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
