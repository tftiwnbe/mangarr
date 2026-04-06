<script lang="ts">
	import { onMount } from 'svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import {
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

	// Get the first 2 chapters that are currently downloading, always show 2 slots (fill with null)
	const downloadSlots = $derived.by(() => {
		const downloading = dashboard.activeTasks
			.filter((task) => task.status === 'downloading')
			.slice(0, 2);
		// Always show 2 slots, fill empty slots with null
		const slots: Array<typeof downloading[number] | null> = [...downloading];
		while (slots.length < 2) {
			slots.push(null);
		}
		return slots;
	});

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

	function overviewValue(key: 'downloadedChapters' | 'avgChapterSize' | 'estimatedCapacity') {
		if (key === 'downloadedChapters') {
			const downloaded = Math.max(0, dashboard.overview.downloadedChapters);
			const total = Math.max(0, dashboard.overview.totalChapters);
			return `${numberFormatter.format(downloaded)} / ${numberFormatter.format(total)}`;
		}
		if (key === 'avgChapterSize') {
			return formatBytes(dashboard.overview.avgChapterSizeBytes);
		}
		const freeSpace = storage?.freeSpaceBytes ?? 0;
		if (dashboard.overview.avgChapterSizeBytes <= 0 || freeSpace <= 0) {
			return '0';
		}
		return numberFormatter.format(
			Math.max(0, Math.floor(freeSpace / dashboard.overview.avgChapterSizeBytes))
		);
	}

	function overviewShortLabel(key: 'downloadedChapters' | 'avgChapterSize' | 'estimatedCapacity') {
		if (key === 'avgChapterSize') return $_('downloads.avgSizeShort');
		if (key === 'estimatedCapacity') return $_('downloads.capacityShort');
		return $_('downloads.chaptersShort');
	}

	function taskActionLoading(kind: string, taskId: string) {
		return taskActionKey === `${kind}:${taskId}`;
	}
</script>

<svelte:head>
	<title>{$_('nav.downloads')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex items-center justify-between">
		<h1 class="text-display text-xl text-[var(--text)]">{$_('nav.downloads').toLowerCase()}</h1>
		<div class="flex items-center gap-1">
			<button
				type="button"
				class="flex h-8 w-8 items-center justify-center transition-all {runningAction === 'cycle'
					? 'text-[var(--text)]'
					: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
				onclick={handleRunWatch}
				disabled={runningAction !== null}
				title={$_('downloads.runNow')}
			>
				{#if runningAction === 'cycle'}
					<SpinnerIcon size={14} class="animate-spin" />
				{:else}
					<PlayIcon size={14} />
				{/if}
			</button>
			<button
				type="button"
				class="flex h-8 w-8 items-center justify-center transition-all {reconcileLoading
					? 'text-[var(--text)]'
					: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
				onclick={handleReconcileDownloads}
				disabled={reconcileLoading}
				title={$_('downloads.scanDownloads')}
			>
				{#if reconcileLoading}
					<SpinnerIcon size={14} class="animate-spin" />
				{:else}
					<HardDriveIcon size={14} />
				{/if}
			</button>
		</div>
	</div>

	<div class="flex items-start justify-between px-1">
		{#each ['downloadedChapters', 'avgChapterSize', 'estimatedCapacity'] as statKey (statKey)}
			<div class="flex flex-col gap-0.5">
				<span class="text-lg font-medium text-[var(--text)] tabular-nums">
					{overviewValue(statKey as 'downloadedChapters' | 'avgChapterSize' | 'estimatedCapacity')}
				</span>
				<span class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase">
					{overviewShortLabel(
						statKey as 'downloadedChapters' | 'avgChapterSize' | 'estimatedCapacity'
					)}
				</span>
				{#if statKey === 'estimatedCapacity'}
					<span class="text-[10px] text-[var(--text-ghost)]">
						{formatBytes(storage?.freeSpaceBytes ?? 0)} free
					</span>
				{/if}
			</div>
		{/each}
	</div>

	{#if reconcileResult || reconcileLoading || reconcileError}
		<div class="flex flex-col gap-2">
			{#if reconcileResult}
				<p class="text-[10px] tracking-wide text-[var(--text-ghost)]">
					Fixed {reconcileResult.fixed ?? 0} missing downloaded chapters. Found
					{reconcileResult.downloaded ?? 0} stored chapters and {reconcileResult.missing ?? 0}
					missing entries.
				</p>
			{/if}
			{#if reconcileError}
				<p class="text-xs text-[var(--error)]">{reconcileError}</p>
			{/if}
		</div>
	{/if}

	{#if actionError}
		<div
			class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-4 py-3 text-sm text-[var(--error)]"
		>
			{actionError}
		</div>
	{/if}

	<!-- Current Downloads Section -->
	<div class="flex flex-col gap-1 pb-3">
		<h2 class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase px-1 pb-2">
			{$_('downloads.downloading')}
		</h2>
		{#each downloadSlots as task, index (task?.chapterId ?? `empty-${index}`)}
			{#if task}
				<div class="flex gap-3 border border-[var(--line)] bg-[var(--void-2)] p-3">
					<a href={buildTitlePath(task.titleId, task.title)} class="shrink-0">
						<LazyImage
							src={coverSrc(task)}
							alt={task.title}
							class="h-16 w-11 border border-[var(--line)]"
						/>
					</a>
					<div class="min-w-0 flex-1">
						<a href={buildTitlePath(task.titleId, task.title)}>
							<p class="line-clamp-1 text-sm text-[var(--text)]">{task.title}</p>
						</a>
						<p class="mt-0.5 line-clamp-1 text-xs text-[var(--text-muted)]">{task.chapter}</p>
						<div class="mt-1 flex items-center gap-2 text-[10px] text-[var(--text-ghost)]">
							<span class="text-[var(--text-muted)]">{$_('downloads.downloading').toLowerCase()}</span>
							{#if task.fileSizeBytes && task.fileSizeBytes > 0}
								<span>{formatBytes(task.fileSizeBytes)}</span>
							{/if}
						</div>
						<div class="mt-2 h-0.5 w-full overflow-hidden bg-[var(--void-4)]">
							<div
								class="h-full bg-[var(--text-muted)] shadow-[0_0_8px_rgba(228,228,231,0.6)] transition-[width] duration-300 animate-pulse"
								style="width: {task.progressPercent}%"
							></div>
						</div>
					</div>
					<div class="flex shrink-0 items-center self-center">
						<span class="text-sm text-[var(--text)] tabular-nums">
							{task.progressPercent}%
						</span>
					</div>
				</div>
			{:else}
				<!-- Empty download slot -->
				<div class="flex gap-3 border border-dashed border-[var(--line)] bg-[var(--void-1)] p-3 opacity-50">
					<div class="h-16 w-11 border border-dashed border-[var(--line)] bg-[var(--void-2)]"></div>
					<div class="min-w-0 flex-1">
						<p class="text-sm text-[var(--text-ghost)]">{$_('downloads.idle')}</p>
						<div class="mt-2 h-0.5 w-full overflow-hidden bg-[var(--void-4)]">
							<div class="h-full bg-transparent"></div>
						</div>
					</div>
					<div class="flex shrink-0 items-center self-center">
						<span class="text-sm text-[var(--text-ghost)] tabular-nums">-</span>
					</div>
				</div>
			{/if}
		{/each}
	</div>

	<!-- Watched Titles Section -->
	<div class="flex flex-col gap-1">
		<h2 class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase px-1 pb-2">
			{$_('downloads.watched')}
		</h2>
		{#if isLoading && !dashboard.generatedAt}
			<div class="flex items-center justify-center py-20">
				<SpinnerIcon size={16} class="animate-spin text-[var(--text-ghost)]" />
			</div>
		{:else if dashboard.watchedTitles.length === 0}
			<div class="flex flex-col items-center py-20">
				<p class="text-sm text-[var(--text-ghost)]">{$_('downloads.noWatched')}</p>
			</div>
		{:else}
			{#each dashboard.watchedTitles as item (item.titleId)}
				{@const progress =
					item.totalChapters > 0
						? Math.round((item.downloadedChapters / item.totalChapters) * 100)
						: 0}
				{@const isDownloading = item.queuedTasks > 0}
				<div class="group flex gap-3 py-2 transition-opacity {item.enabled ? '' : 'opacity-35'}">
					<a href={buildTitlePath(item.titleId, item.title)} class="shrink-0">
						<LazyImage
							src={coverSrc(item)}
							alt={item.title}
							class="h-16 w-11 border border-[var(--line)]"
						/>
					</a>
					<a href={buildTitlePath(item.titleId, item.title)} class="min-w-0 flex-1">
						<div class="flex items-baseline justify-between gap-2">
							<p class="line-clamp-1 text-sm text-[var(--text)]">{item.title}</p>
							<span class="shrink-0 text-xs text-[var(--text-soft)] tabular-nums">
								{item.downloadedChapters}/{item.totalChapters}
							</span>
						</div>
						<div class="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--text-ghost)]">
							{#if item.variantSources.length > 0}
								<span>{item.variantSources.join(', ')}</span>
							{/if}
							{#if item.paused}
								<span class="text-[var(--text-muted)]"
									>{$_('downloads.paused').toLowerCase()}</span
								>
							{/if}
							{#if item.autoDownload}
								<span>auto</span>
							{/if}
							<span>{formatBytes(item.downloadedBytes)}</span>
						</div>
						{#if item.queuedTasks > 0}
							<div class="mt-0.5 flex items-center gap-2 text-[10px]">
								<span class="text-[var(--text-ghost)]">
									{item.queuedTasks}
									{$_('downloads.queued').toLowerCase()}
								</span>
							</div>
						{/if}
						<div class="mt-2 h-0.5 w-full overflow-hidden bg-[var(--void-4)]">
							<div
								class="h-full bg-[var(--text-muted)] transition-[width] {isDownloading ? 'shadow-[0_0_8px_rgba(228,228,231,0.6)] animate-pulse' : ''}"
								style="width: {progress}%"
							></div>
						</div>
					</a>
					<div class="flex shrink-0 items-center gap-2 self-center">
						<button
							type="button"
							class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase transition-colors hover:text-[var(--text-muted)]"
							onclick={() => void retryMissingForTitle(item.titleId)}
							disabled={taskActionLoading('retry-title', item.titleId)}
							title={$_('downloads.retry')}
						>
							{#if taskActionLoading('retry-title', item.titleId)}
								<SpinnerIcon size={13} class="animate-spin" />
							{:else}
								{$_('downloads.retry')}
							{/if}
						</button>
						<button
							type="button"
							class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase transition-colors hover:text-[var(--text-muted)]"
							onclick={() => void toggleAutoDownload(item.titleId, !item.autoDownload)}
							disabled={profileActionTitleId === item.titleId}
							title={$_('downloads.autoDownload')}
						>
							{$_('downloads.autoDownload')}
							{item.autoDownload ? $_('downloads.on') : $_('downloads.off')}
						</button>
						<Switch
							checked={item.enabled}
							disabled={profileActionTitleId === item.titleId}
							loading={profileActionTitleId === item.titleId}
							variant="success"
							class="self-center"
							onCheckedChange={(enabled) => void toggleWatch(item.titleId, enabled)}
						/>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>
