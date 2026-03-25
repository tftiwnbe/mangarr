<script lang="ts">
	import { onMount } from 'svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import {
		HardDriveIcon,
		PauseIcon,
		PlayIcon,
		SpinnerIcon,
		TrashIcon,
		XIcon
	} from 'phosphor-svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import { convexApi } from '$lib/convex/api';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { Switch } from '$lib/elements/switch';
	import { Tabs } from '$lib/elements/tabs';
	import { _ } from '$lib/i18n';
	import { buildTitlePath } from '$lib/utils/routes';

	type TaskStatus = 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';
	type TabValue = 'active' | 'history' | 'watched';

	type DashboardData = {
		generatedAt: number | null;
		overview: {
			downloadedChapters: number;
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
	const dashboardQuery = useQuery(convexApi.library.getDownloadDashboard, () => ({
		watchedLimit: 30,
		activeLimit: 100,
		recentLimit: 40
	}));

	let activeTab = $state<TabValue>('active');
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
				avgChapterSizeBytes: 0
			},
			activeTasks: [],
			recentTasks: [],
			watchedTitles: []
		}
	);
	const isLoading = $derived(dashboardQuery.isLoading);
	const numberFormatter = new Intl.NumberFormat();

	const tabs: { key: TabValue; labelKey: string }[] = [
		{ key: 'active', labelKey: 'downloads.active' },
		{ key: 'history', labelKey: 'downloads.history' },
		{ key: 'watched', labelKey: 'downloads.watched' }
	];

	const statusBarClass: Record<TaskStatus, string> = {
		downloading: 'bg-[var(--text-muted)] shadow-[0_0_6px_rgba(228,228,231,0.4)] animate-pulse',
		queued: 'bg-[var(--void-6)]',
		completed: 'bg-[var(--success)]/50 shadow-[0_0_6px_rgba(134,239,172,0.4)]',
		failed: 'bg-[var(--error)]/50 shadow-[0_0_6px_rgba(248,113,113,0.3)]',
		cancelled: 'bg-[var(--void-6)]'
	};

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

	async function togglePause(titleId: Id<'libraryTitles'>, paused: boolean) {
		if (profileActionTitleId === titleId) return;
		profileActionTitleId = titleId;
		actionError = null;
		try {
			await client.mutation(convexApi.library.updateDownloadProfile, {
				titleId,
				enabled: true,
				paused
			});
		} catch (cause) {
			actionError = cause instanceof Error ? cause.message : 'Failed to update download profile';
		} finally {
			profileActionTitleId = null;
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

	async function retryTask(task: DashboardTask) {
		const actionKey = `retry:${task.chapterId}`;
		if (taskActionKey === actionKey) return;
		taskActionKey = actionKey;
		actionError = null;
		try {
			await client.mutation(convexApi.library.requestChapterDownload, {
				chapterId: task.chapterId
			});
		} catch (cause) {
			actionError = cause instanceof Error ? cause.message : 'Failed to retry download';
		} finally {
			taskActionKey = null;
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

	async function cancelQueuedTask(task: DashboardTask) {
		const actionKey = `cancel:${task.chapterId}`;
		if (taskActionKey === actionKey) return;
		taskActionKey = actionKey;
		actionError = null;
		try {
			await client.mutation(convexApi.library.cancelQueuedChapterDownload, {
				chapterId: task.chapterId
			});
		} catch (cause) {
			actionError = cause instanceof Error ? cause.message : 'Failed to cancel download';
		} finally {
			taskActionKey = null;
		}
	}

	async function deleteTaskFile(task: DashboardTask) {
		if (!task.localRelativePath || !task.storageKind) return;
		const actionKey = `delete:${task.chapterId}`;
		if (taskActionKey === actionKey) return;
		taskActionKey = actionKey;
		actionError = null;
		try {
			await fetchJson<{ ok: boolean; deleted: boolean }>('/api/internal/bridge/downloads/delete', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					chapterId: task.chapterId,
					titleId: task.titleId,
					chapterUrl: task.chapterUrl,
					localRelativePath: task.localRelativePath,
					storageKind: task.storageKind
				})
			});
			await loadStorage();
		} catch (cause) {
			actionError = cause instanceof Error ? cause.message : 'Failed to delete downloaded file';
		} finally {
			taskActionKey = null;
		}
	}

	function parseTime(value: number): { key: string; values?: Record<string, number> } {
		const diff = Math.max(0, Date.now() - value);
		const minutes = Math.floor(diff / 60_000);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);
		if (days > 0) return { key: 'time.shortDaysAgo', values: { count: days } };
		if (hours > 0) return { key: 'time.shortHoursAgo', values: { count: hours } };
		if (minutes > 0) return { key: 'time.shortMinutesAgo', values: { count: minutes } };
		return { key: 'time.justNow' };
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
			return numberFormatter.format(Math.max(0, dashboard.overview.downloadedChapters));
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

	function getTasksList(tab: TabValue): DashboardTask[] {
		if (tab === 'active') return dashboard.activeTasks;
		if (tab === 'history') return dashboard.recentTasks;
		return [];
	}

	function tabCount(key: TabValue) {
		if (key === 'active') return dashboard.activeTasks.length;
		if (key === 'history') return dashboard.recentTasks.length;
		return dashboard.watchedTitles.length;
	}

	function taskFileHref(task: DashboardTask): string | null {
		if (!task.localRelativePath || !task.storageKind) return null;
		const params = new URLSearchParams({
			path: task.localRelativePath,
			storage: task.storageKind
		});
		return `/api/internal/bridge/library/file?${params.toString()}`;
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

	<Tabs
		tabs={tabs.map((tab) => ({
			value: tab.key,
			label: $_(tab.labelKey),
			count: tabCount(tab.key)
		}))}
		value={activeTab}
		onValueChange={(value) => (activeTab = value as TabValue)}
	/>

	{#if isLoading && !dashboard.generatedAt}
		<div class="flex items-center justify-center py-20">
			<SpinnerIcon size={16} class="animate-spin text-[var(--text-ghost)]" />
		</div>
	{:else if activeTab === 'watched'}
		{#if dashboard.watchedTitles.length === 0}
			<div class="flex flex-col items-center py-20">
				<p class="text-sm text-[var(--text-ghost)]">{$_('downloads.noWatched')}</p>
			</div>
		{:else}
			<div class="flex flex-col gap-1">
				{#each dashboard.watchedTitles as item (item.titleId)}
					{@const progress =
						item.totalChapters > 0
							? Math.round((item.downloadedChapters / item.totalChapters) * 100)
							: 0}
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
									class="h-full bg-[var(--text-muted)] transition-[width]"
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
			</div>
		{/if}
	{:else}
		{@const tasks = getTasksList(activeTab)}
		{#if tasks.length === 0}
			<div class="flex flex-col items-center py-20">
				<p class="text-sm text-[var(--text-ghost)]">
					{activeTab === 'active' ? $_('downloads.noActive') : $_('downloads.noHistory')}
				</p>
			</div>
		{:else}
			<div class="flex flex-col gap-1">
				{#each tasks as task (`${activeTab}:${task.chapterId}`)}
					{@const time = parseTime(task.updatedAt)}
					{@const fileHref = taskFileHref(task)}
					<div class="group flex gap-3 py-2">
						<a href={buildTitlePath(task.titleId, task.title)} class="shrink-0">
							<LazyImage
								src={coverSrc(task)}
								alt={task.title}
								class="h-16 w-11 border border-[var(--line)]"
							/>
						</a>
						<div class="min-w-0 flex-1">
							<div class="flex items-baseline justify-between gap-2">
								<a href={buildTitlePath(task.titleId, task.title)} class="min-w-0">
									<p class="line-clamp-1 text-sm text-[var(--text)]">{task.title}</p>
								</a>
								<span class="shrink-0 text-sm text-[var(--text)] tabular-nums">
									{task.progressPercent}%
								</span>
							</div>
							<p class="mt-0.5 line-clamp-1 text-xs text-[var(--text-muted)]">{task.chapter}</p>
							<div
								class="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--text-ghost)]"
							>
								<span>{$_(`downloads.${task.status}`).toLowerCase()}</span>
								<span>{$_(time.key, { values: time.values })}</span>
								{#if activeTab === 'active' && task.isPaused}
									<span class="text-[var(--text-muted)]"
										>{$_('downloads.paused').toLowerCase()}</span
									>
								{/if}
								{#if task.fileSizeBytes && task.fileSizeBytes > 0}
									<span>{formatBytes(task.fileSizeBytes)}</span>
								{/if}
							</div>
							<div class="mt-2 h-0.5 w-full bg-[var(--void-4)]">
								<div
									class="h-full transition-[width] duration-300 {statusBarClass[task.status]}"
									style="width: {task.progressPercent}%"
								></div>
							</div>
							{#if task.error && task.error !== 'Paused'}
								<p class="mt-1 line-clamp-1 text-[10px] text-[var(--error)]">{task.error}</p>
							{/if}
						</div>
						<div class="flex shrink-0 items-center gap-1 self-center">
							{#if activeTab === 'active'}
								<button
									type="button"
									class="flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] transition-all hover:text-[var(--text-muted)]"
									onclick={() => togglePause(task.titleId, !task.isPaused)}
									disabled={profileActionTitleId === task.titleId}
									title={task.isPaused ? $_('downloads.resume') : $_('downloads.pause')}
								>
									{#if profileActionTitleId === task.titleId}
										<SpinnerIcon size={15} class="animate-spin" />
									{:else if task.isPaused}
										<PlayIcon size={15} />
									{:else}
										<PauseIcon size={15} />
									{/if}
								</button>
								{#if task.status === 'queued'}
									<button
										type="button"
										class="flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] transition-all hover:text-[var(--error)]"
										onclick={() => void cancelQueuedTask(task)}
										disabled={taskActionLoading('cancel', task.chapterId)}
										title={$_('downloads.cancel')}
									>
										{#if taskActionLoading('cancel', task.chapterId)}
											<SpinnerIcon size={15} class="animate-spin" />
										{:else}
											<XIcon size={15} />
										{/if}
									</button>
								{/if}
							{:else}
								{#if (task.status === 'failed' || task.status === 'cancelled') && task.localRelativePath === null}
									<button
										type="button"
										class="flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] transition-all hover:text-[var(--text-muted)]"
										onclick={() => void retryTask(task)}
										disabled={taskActionLoading('retry', task.chapterId)}
										title={$_('downloads.retry')}
									>
										{#if taskActionLoading('retry', task.chapterId)}
											<SpinnerIcon size={15} class="animate-spin" />
										{:else}
											<PlayIcon size={15} />
										{/if}
									</button>
								{/if}
								{#if fileHref}
									<a
										href={fileHref}
										class="flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] transition-all hover:text-[var(--text-muted)]"
										title={$_('downloads.openFile')}
									>
										<HardDriveIcon size={15} />
									</a>
									<button
										type="button"
										class="flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] transition-all hover:text-[var(--error)]"
										onclick={() => void deleteTaskFile(task)}
										disabled={taskActionLoading('delete', task.chapterId)}
										title={$_('downloads.deleteFile')}
									>
										{#if taskActionLoading('delete', task.chapterId)}
											<SpinnerIcon size={15} class="animate-spin" />
										{:else}
											<TrashIcon size={15} />
										{/if}
									</button>
								{/if}
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
