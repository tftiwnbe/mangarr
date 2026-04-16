<script lang="ts">
	import { onMount } from 'svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import {
		ArrowClockwiseIcon,
		HardDriveIcon,
		PlayIcon,
		SpinnerIcon
	} from 'phosphor-svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import { convexApi } from '$lib/convex/api';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { Switch } from '$lib/elements/switch';
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
	};

	type DashboardTask = {
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
	};

	const client = useConvexClient();
	const dashboardQuery = useQuery(
		convexApi.library.getDownloadDashboard,
		() => ({
			watchedLimit: 30,
			activeLimit: 100,
			recentLimit: 40
		})
	);

	let runningAction = $state<string | null>(null);
	let profileActionTitleId = $state<string | null>(null);
	let taskActionKey = $state<string | null>(null);
	let storage = $state<DownloadSettings | null>(null);
	let reconcileLoading = $state(false);
	let reconcileError = $state<string | null>(null);
	let reconcileResult = $state<ReconcileResult | null>(null);
	let actionError = $state<string | null>(null);

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
			watchedTitles: []
		}
	);
	const isLoading = $derived(dashboardQuery.isLoading);
	const numberFormatter = new Intl.NumberFormat();

	const activeDownloads = $derived(
		dashboard.activeTasks
			.filter((task) => task.status === 'downloading')
			.sort((a, b) => a.chapterId.localeCompare(b.chapterId))
	);

	const chapterProgress = $derived(
		dashboard.overview.totalChapters > 0
			? (dashboard.overview.downloadedChapters / dashboard.overview.totalChapters) * 100
			: 0
	);

	onMount(() => {
		void loadStorage();
	});

	function coverSrc(item: { localCoverPath?: string | null; coverUrl?: string | null }) {
		if (item.localCoverPath) {
			const params = new URLSearchParams({ path: item.localCoverPath });
			return `/api/internal/bridge/library/cover?${params.toString()}`;
		}
		return item.coverUrl ?? '';
	}

	async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
		const response = await fetch(url, init);
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
			await client.mutation(convexApi.library.runDownloadCycle, { limit: 25 });
		} catch (cause) {
			actionError = cause instanceof Error ? cause.message : 'Failed to run downloads';
		} finally {
			runningAction = null;
		}
	}

	async function handleReconcileDownloads() {
		reconcileLoading = true;
		reconcileError = null;
		try {
			reconcileResult = await fetchJson<ReconcileResult>(
				'/api/internal/bridge/downloads/reconcile',
				{
					method: 'POST',
					headers: {
						'content-type': 'application/json'
					},
					body: JSON.stringify({})
				}
			);
			await loadStorage();
		} catch (cause) {
			reconcileError = cause instanceof Error ? cause.message : 'Failed to reconcile downloads';
		} finally {
			reconcileLoading = false;
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

	async function toggleAutoDownload(titleId: Id<'libraryTitles'>, autoDownload: boolean) {
		if (profileActionTitleId === titleId) return;
		profileActionTitleId = titleId;
		actionError = null;
		try {
			await client.mutation(convexApi.library.updateDownloadProfile, {
				titleId,
				enabled: true,
				autoDownload
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
			await client.mutation(convexApi.library.requestMissingDownloads, {
				titleId
			});
		} catch (cause) {
			actionError = cause instanceof Error ? cause.message : 'Failed to queue missing downloads';
		} finally {
			taskActionKey = null;
		}
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
		</div>
	</header>

	<section class="flex flex-col gap-3">
		<div class="flex flex-col gap-2">
			<div class="flex items-baseline justify-between gap-3">
				<span class="text-display text-2xl leading-none text-[var(--text)] tabular-nums">
					{chapterStat.downloaded}<span class="text-[var(--text-ghost)] text-base">/{chapterStat.total}</span>
				</span>
				<span class="text-[10px] leading-none tracking-[0.24em] text-[var(--text-ghost)] uppercase">
					{$_('downloads.chaptersShort')}
				</span>
			</div>
			<div class="relative h-[2px] w-full overflow-hidden bg-[var(--void-4)]">
				<div
					class="absolute inset-y-0 left-0 bg-[rgba(199,210,254,0.5)]"
					style="width: {chapterProgress}%"
				></div>
			</div>
		</div>
		<div class="flex items-center gap-3 text-[11px] text-[var(--text-muted)] tabular-nums">
			<span>{formatBytes(dashboard.overview.avgChapterSizeBytes)} <span class="text-[var(--text-ghost)] tracking-[0.12em] uppercase">avg</span></span>
			<span class="text-[var(--void-6)]">·</span>
			<span>{capacityStat.capacity} <span class="text-[var(--text-ghost)] tracking-[0.12em] uppercase">{$_('downloads.capacityShort')}</span></span>
			<span class="text-[var(--void-6)]">·</span>
			<span>{capacityStat.free} <span class="text-[var(--text-ghost)] tracking-[0.12em] uppercase">free</span></span>
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
				<p class="text-xs text-[var(--error)]">{reconcileError}</p>
			{/if}
		</div>
	{/if}

	{#if actionError}
		<div
			class="border-l-2 border-[var(--error)] bg-[var(--error-soft)] px-3 py-2 text-xs text-[var(--error)]"
		>
			{actionError}
		</div>
	{/if}

	<!-- Inflight -->
	<section class="flex flex-col gap-2">
		<header class="flex items-center gap-2 px-0.5">
			<span
				class="h-1 w-1 rounded-full {activeDownloads.length > 0
					? 'bg-[rgba(199,210,254,0.9)] shadow-[0_0_8px_rgba(165,180,252,0.8)] animate-pulse'
					: 'bg-[var(--void-6)]'}"
			></span>
			<h2 class="text-[10px] tracking-[0.24em] text-[var(--text-ghost)] uppercase">
				{activeDownloads.length > 0
					? $_('downloads.inflight')
					: $_('downloads.standby')}
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
								class="relative h-14 w-10 overflow-hidden bg-[var(--void-3)] shadow-[0_0_0_1px_rgba(199,210,254,0.28),0_0_14px_-4px_rgba(165,180,252,0.35)]"
							>
								<LazyImage
									src={coverSrc(task)}
									alt={task.title}
									class="absolute inset-0 h-full w-full"
								/>
							</div>
						</a>
						<div class="flex min-w-0 flex-1 flex-col justify-center gap-1">
							<a href={buildTitlePath(task.titleId, task.title)} class="flex items-baseline justify-between gap-2">
								<p class="line-clamp-1 text-sm leading-tight text-[var(--text)]">{task.title}</p>
								<span class="shrink-0 text-[11px] leading-none text-[var(--text-soft)] tabular-nums">
									{task.progressPercent > 0 ? `${task.progressPercent}%` : '···'}
								</span>
							</a>
							<div class="flex items-center gap-2">
								<p class="min-w-0 truncate text-xs leading-tight text-[var(--text-muted)]">{task.chapter}</p>
								{#if task.fileSizeBytes && task.fileSizeBytes > 0}
									<span class="shrink-0 text-[10px] text-[var(--text-ghost)] tabular-nums">{formatBytes(task.fileSizeBytes)}</span>
								{/if}
							</div>
							<div class="relative h-[2px] w-full overflow-hidden bg-[var(--void-4)]">
								{#if task.progressPercent > 0}
									<div
										class="absolute inset-y-0 left-0 bg-[rgba(199,210,254,0.9)] shadow-[0_0_10px_rgba(165,180,252,0.7)] transition-[width] duration-300"
										style="width: {task.progressPercent}%"
									></div>
								{:else}
									<div
										class="absolute inset-y-0 left-0 w-full animate-pulse bg-[rgba(199,210,254,0.35)]"
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
			{#if dashboard.watchedTitles.length > 0}
				<span class="text-[10px] text-[var(--text-ghost)] tabular-nums">
					{dashboard.watchedTitles.length}
				</span>
			{/if}
		</header>

		{#if isLoading && !dashboard.generatedAt}
			<div class="flex items-center justify-center py-16">
				<SpinnerIcon size={16} class="animate-spin text-[var(--text-ghost)]" />
			</div>
		{:else if dashboard.watchedTitles.length === 0}
			<div class="flex flex-col items-center gap-1 py-16">
				<p class="text-sm text-[var(--text-muted)]">{$_('downloads.noWatched')}</p>
				<p class="text-[11px] text-[var(--text-ghost)]">
					{$_('downloads.noWatchedDescription')}
				</p>
			</div>
		{:else}
			<ul class="flex flex-col">
				{#each dashboard.watchedTitles as item (item.titleId)}
					{@const progress =
						item.totalChapters > 0
							? Math.round((item.downloadedChapters / item.totalChapters) * 100)
							: 0}
					{@const isDownloading = item.queuedTasks > 0}
					{@const retryActive = taskActionLoading('retry-title', item.titleId)}
					<li
						class="group flex gap-3 py-3 transition-opacity {item.enabled
							? ''
							: 'opacity-35'}"
					>
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
							<a href={buildTitlePath(item.titleId, item.title)} class="flex min-w-0 flex-col gap-0.5">
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
							</a>

							<div class="flex items-center justify-end gap-2">
								{#if item.queuedTasks > 0}
									<span class="mr-auto text-[10px] tabular-nums text-[rgba(199,210,254,0.75)]">
										+{item.queuedTasks} {$_('downloads.queued').toLowerCase()}
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
										? 'bg-[rgba(199,210,254,0.85)] shadow-[0_0_10px_rgba(165,180,252,0.6)] animate-pulse'
										: 'bg-[var(--void-7)]'}"
									style="width: {progress}%"
								></div>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
