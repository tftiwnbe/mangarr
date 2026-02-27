<script lang="ts">
	import { onMount } from 'svelte';

	import { listSources, type SourceSummary } from '$lib/api/explore';
	import {
		importExternalDownloadTitle,
		reconcileDownloads,
		updateDownloadProfile,
		type DownloadExternalTitleResource,
		type DownloadReconcileResource
	} from '$lib/api/downloads';
	import { Button } from '$lib/elements/button';
	import { Icon } from '$lib/elements/icon';
	import { Input } from '$lib/elements/input';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { downloadsDashboardStore, runDownloadCycle } from '$lib/stores/downloads';
	import type { DownloadStatus, DownloadTaskItem } from '$lib/utils/download-mappers';
	import { _ } from '$lib/i18n';
	import { buildTitlePath } from '$lib/utils/routes';

	type TabValue = 'active' | 'history' | 'monitored';

	let activeTab = $state<TabValue>('active');
	let runningAction = $state<string | null>(null);
	let profileActionTitleId = $state<number | null>(null);
	let reconcileLoading = $state(false);
	let reconcileError = $state<string | null>(null);
	let reconcileResult = $state<DownloadReconcileResource | null>(null);
	let externalSearch = $state('');
	let importingExternalKey = $state<string | null>(null);
	let availableSources = $state<SourceSummary[]>([]);
	let sourcesLoading = $state(false);
	let sourceByExternalKey = $state<Record<string, string>>({});
	let actionsExpanded = $state(false);

	const dashboard = $derived($downloadsDashboardStore.data);
	const isLoading = $derived($downloadsDashboardStore.isLoading);
	const isRefreshing = $derived($downloadsDashboardStore.isRefreshing);
	const numberFormatter = new Intl.NumberFormat();
	const sourceNameById = $derived.by(() => {
		const map = new Map<string, string>();
		for (const source of availableSources) {
			const key = source.id?.trim();
			if (!key) continue;
			const label = `${source.name}${source.lang ? ` [${source.lang}]` : ''}`.trim() || key;
			map.set(key, label);
		}
		return map;
	});
	const monitoredByTitleId = $derived.by(() => {
		const map = new Map<number, (typeof dashboard.monitoredTitles)[number]>();
		for (const item of dashboard.monitoredTitles) {
			map.set(item.titleId, item);
		}
		return map;
	});

	const filteredExternalTitles = $derived.by<DownloadExternalTitleResource[]>(() => {
		const all = reconcileResult?.external_titles ?? [];
		const query = externalSearch.trim().toLowerCase();
		if (!query) return all;
		return all.filter(
			(item) =>
				item.title.toLowerCase().includes(query) ||
				item.source_name.toLowerCase().includes(query) ||
				(item.source_lang ?? '').toLowerCase().includes(query)
		);
	});

	const activeQueueProgress = $derived.by(() => {
		const activeTitleIds = new Set(dashboard.activeTasks.map((task) => task.titleId));
		const relevantMonitored = dashboard.monitoredTitles.filter(
			(item) => item.queuedTasks > 0 || activeTitleIds.has(item.titleId)
		);
		if (relevantMonitored.length === 0 && dashboard.activeTasks.length === 0) return null;

		let plannedTotal = 0;
		let plannedDownloaded = 0;
		let queuedChapters = 0;
		let failedChapters = 0;
		let downloadingChapters = 0;
		let downloadedPages = 0;
		let totalPages = 0;

		for (const item of relevantMonitored) {
			const total = Math.max(0, item.totalChapters);
			const downloaded = Math.max(0, Math.min(total, item.downloadedChapters));
			plannedTotal += total;
			plannedDownloaded += downloaded;
			queuedChapters += Math.max(0, item.queuedTasks);
			failedChapters += Math.max(0, item.failedTasks);
		}

		for (const task of dashboard.activeTasks) {
			downloadingChapters += Math.max(0, task.chaptersDownloading);
			if (task.totalPages > 0) {
				totalPages += task.totalPages;
				downloadedPages += Math.min(task.totalPages, Math.max(0, task.downloadedPages));
			}
		}

		const fallbackScheduled = dashboard.activeTasks.reduce(
			(total, task) => total + Math.max(0, task.chaptersTotal),
			0
		);
		const fallbackCompleted = dashboard.activeTasks.reduce(
			(total, task) => total + Math.max(0, task.chaptersCompleted + task.chaptersCancelled),
			0
		);

		const percent =
			plannedTotal > 0
				? Math.round((plannedDownloaded / plannedTotal) * 100)
				: totalPages > 0
					? Math.round((downloadedPages / totalPages) * 100)
					: fallbackScheduled > 0
						? Math.round((fallbackCompleted / fallbackScheduled) * 100)
						: 0;
		return {
			percent: Math.max(0, Math.min(100, percent)),
			scheduledChapters: plannedTotal > 0 ? plannedTotal : fallbackScheduled,
			plannedDownloaded,
			queuedChapters,
			downloadingChapters,
			failedChapters,
			downloadedPages,
			totalPages
		};
	});

	const statusBarClass: Record<DownloadStatus, string> = {
		downloading: 'bg-[var(--text-muted)] shadow-[0_0_6px_rgba(228,228,231,0.4)] animate-pulse',
		queued: 'bg-[var(--void-6)]',
		completed: 'bg-[var(--success)]/50 shadow-[0_0_6px_rgba(134,239,172,0.4)]',
		failed: 'bg-[var(--error)]/50 shadow-[0_0_6px_rgba(248,113,113,0.3)]',
		cancelled: 'bg-[var(--void-6)]'
	};

	const tabs: { key: TabValue; labelKey: string }[] = [
		{ key: 'active', labelKey: 'downloads.active' },
		{ key: 'history', labelKey: 'downloads.history' },
		{ key: 'monitored', labelKey: 'downloads.monitored' }
	];

	onMount(() => {
		void downloadsDashboardStore.load();
		void loadSources();
		const interval = setInterval(() => {
			if (document.hidden) return;
			void downloadsDashboardStore.refresh();
		}, 15_000);
		return () => clearInterval(interval);
	});

	async function loadSources() {
		sourcesLoading = true;
		try {
			const sources = await listSources();
			availableSources = [...sources].sort((a, b) => {
				const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
				if (byName !== 0) return byName;
				return (a.lang ?? '').localeCompare(b.lang ?? '', undefined, { sensitivity: 'base' });
			});
		} catch {
			availableSources = [];
		} finally {
			sourcesLoading = false;
		}
	}

	function setManualSource(externalKey: string, sourceId: string) {
		sourceByExternalKey = { ...sourceByExternalKey, [externalKey]: sourceId };
	}

	async function handleRunMonitor() {
		runningAction = 'cycle';
		try {
			await runDownloadCycle();
		} finally {
			runningAction = null;
		}
	}

	async function handleReconcileDownloads() {
		reconcileLoading = true;
		reconcileError = null;
		try {
			reconcileResult = await reconcileDownloads({ limit: 200 });
			await downloadsDashboardStore.refresh();
		} catch (error) {
			reconcileError = error instanceof Error ? error.message : 'Failed to reconcile downloads';
		} finally {
			reconcileLoading = false;
		}
	}

	async function handleImportExternalTitle(
		item: DownloadExternalTitleResource,
		sourceIdOverride?: string | null
	) {
		if (importingExternalKey === item.key) return;
		const sourceId = sourceIdOverride?.trim() || item.source_id?.trim() || '';
		if (!sourceId) {
			reconcileError = $_('downloads.selectSourceToImport');
			return;
		}
		importingExternalKey = item.key;
		reconcileError = null;
		try {
			await importExternalDownloadTitle({
				source_id: sourceId,
				title: item.title,
				title_url: item.title_url,
				path: item.path
			});
			reconcileResult = await reconcileDownloads({
				query: externalSearch.trim() || null,
				limit: 200
			});
			await downloadsDashboardStore.refresh();
		} catch (error) {
			reconcileError = error instanceof Error ? error.message : 'Failed to import title';
		} finally {
			importingExternalKey = null;
		}
	}

	async function togglePause(titleId: number, paused: boolean) {
		if (profileActionTitleId === titleId) return;
		profileActionTitleId = titleId;
		try {
			await updateDownloadProfile(titleId, { paused });
			await downloadsDashboardStore.refresh();
		} finally {
			profileActionTitleId = null;
		}
	}

	async function toggleMonitoring(titleId: number, enabled: boolean) {
		if (profileActionTitleId === titleId) return;
		profileActionTitleId = titleId;
		try {
			await updateDownloadProfile(titleId, { enabled });
			await downloadsDashboardStore.refresh();
		} finally {
			profileActionTitleId = null;
		}
	}

	function parseApiDate(value: string): Date {
		const candidate = value.trim();
		if (!candidate) return new Date(Number.NaN);
		const hasTimezone = /(?:z|[+-]\d{2}:\d{2})$/i.test(candidate);
		return new Date(hasTimezone ? candidate : `${candidate}Z`);
	}

	function formatTime(dateStr: string): { key: string; values?: Record<string, number> } {
		const date = parseApiDate(dateStr);
		if (Number.isNaN(date.getTime())) return { key: 'time.justNow' };
		const now = new Date();
		const diff = Math.max(0, now.getTime() - date.getTime());
		const minutes = Math.floor(diff / 60000);
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
			unit++;
		}
		const decimals = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
		return `${value.toFixed(decimals)} ${units[unit]}`;
	}

	function overviewShortLabel(
		key: 'downloadedChapters' | 'avgChapterSize' | 'estimatedCapacity'
	): string {
		if (key === 'avgChapterSize') return $_('downloads.avgSizeShort');
		if (key === 'estimatedCapacity') return $_('downloads.capacityShort');
		return $_('downloads.chaptersShort');
	}

	function overviewValue(
		key: 'downloadedChapters' | 'avgChapterSize' | 'estimatedCapacity',
		value: number
	): string {
		if (key === 'avgChapterSize') return formatBytes(value);
		return numberFormatter.format(Math.max(0, Math.floor(value)));
	}

	function getTasksList(tab: TabValue): DownloadTaskItem[] {
		if (tab === 'active') return dashboard.activeTasks;
		if (tab === 'history') return dashboard.recentTasks;
		return [];
	}

	function displaySources(sourceIds: string[]): string[] {
		return sourceIds.map((sourceId) => sourceNameById.get(sourceId) ?? sourceId);
	}

	function activePlannedProgress(task: DownloadTaskItem): {
		percent: number;
		downloaded: number | null;
		total: number | null;
	} {
		if (activeTab !== 'active') {
			return { percent: task.progressPercent, downloaded: null, total: null };
		}
		const monitored = monitoredByTitleId.get(task.titleId);
		if (!monitored || monitored.totalChapters <= 0) {
			return { percent: task.progressPercent, downloaded: null, total: null };
		}
		const total = Math.max(0, monitored.totalChapters);
		const downloaded = Math.max(0, Math.min(total, monitored.downloadedChapters));
		return {
			percent: Math.round((downloaded / total) * 100),
			downloaded,
			total
		};
	}

	function taskStats(task: DownloadTaskItem): {
		chaptersTotal: number;
		chaptersQueued: number;
		plannedDownloaded: number | null;
		plannedTotal: number | null;
	} {
		if (activeTab === 'active') {
			const monitored = monitoredByTitleId.get(task.titleId);
			if (monitored) {
				return {
					chaptersTotal: Math.max(0, monitored.totalChapters),
					chaptersQueued: Math.max(0, monitored.queuedTasks),
					plannedDownloaded: Math.max(
						0,
						Math.min(monitored.totalChapters, monitored.downloadedChapters)
					),
					plannedTotal: Math.max(0, monitored.totalChapters)
				};
			}
		}
		return {
			chaptersTotal: task.chaptersTotal,
			chaptersQueued: task.chaptersQueued,
			plannedDownloaded: null,
			plannedTotal: null
		};
	}

	function tabCount(key: TabValue): number {
		if (key === 'active') return dashboard.activeTasks.length;
		if (key === 'history') return dashboard.recentTasks.length;
		return dashboard.monitoredTitles.length;
	}
</script>

<svelte:head>
	<title>{$_('nav.downloads')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h1 class="text-display text-lg tracking-tight text-[var(--text)]">
			{$_('nav.downloads').toLowerCase()}
		</h1>
		<div class="flex items-center gap-1">
			<button
				type="button"
				class="flex h-8 w-8 items-center justify-center transition-all {runningAction === 'cycle'
					? 'text-[var(--text)]'
					: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
				onclick={handleRunMonitor}
				disabled={runningAction !== null}
				title={$_('downloads.runNow')}
			>
				{#if runningAction === 'cycle'}
					<Icon name="loader" size={14} class="animate-spin" />
				{:else}
					<Icon name="play" size={14} />
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
					<Icon name="loader" size={14} class="animate-spin" />
				{:else}
					<Icon name="hard-drive" size={14} />
				{/if}
			</button>
		</div>
	</div>

	<!-- Stats strip -->
	{#if dashboard.overview.length > 0}
		<div class="flex items-start justify-between px-1">
			{#each dashboard.overview as stat}
				<div class="flex flex-col gap-0.5">
					<span class="text-lg font-medium text-[var(--text)] tabular-nums">
						{overviewValue(stat.key, stat.value)}
					</span>
					<span class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase">
						{overviewShortLabel(stat.key)}
					</span>
					{#if stat.key === 'estimatedCapacity' && stat.secondaryValue !== undefined}
						<span class="text-[10px] text-[var(--text-ghost)]">
							{formatBytes(stat.secondaryValue)} free
						</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- Active queue progress -->
	{#if activeQueueProgress || runningAction === 'cycle' || isRefreshing}
		<div class="flex flex-col gap-1.5">
			<div class="flex items-baseline justify-between">
				<div class="flex items-center gap-2">
					<Icon name="loader" size={10} class="animate-spin text-[var(--text-muted)]" />
					<span class="text-xs text-[var(--text-muted)]">
						{#if activeQueueProgress}
							{activeQueueProgress.queuedChapters}
							{$_('downloads.queued').toLowerCase()}
							{#if activeQueueProgress.failedChapters > 0}
								<span class="text-[var(--error)]"
									>· {activeQueueProgress.failedChapters}
									{$_('downloads.failed').toLowerCase()}</span
								>
							{/if}
						{:else}
							{$_('common.loading')}
						{/if}
					</span>
				</div>
				<span class="text-sm text-[var(--text)] tabular-nums"
					>{activeQueueProgress?.percent ?? 0}%</span
				>
			</div>
			<div class="h-0.5 w-full overflow-hidden bg-[var(--void-4)]">
				<div
					class="h-full bg-[var(--text-muted)] transition-[width] duration-500"
					style="width: {activeQueueProgress?.percent ?? 8}%"
				></div>
			</div>
		</div>
	{/if}

	<!-- Reconcile results -->
	{#if reconcileResult || reconcileLoading || reconcileError}
		<div class="flex flex-col gap-3">
			{#if reconcileResult}
				<p class="text-xs text-[var(--text-muted)]">
					{$_('downloads.reconcileSummary', {
						values: {
							fixed: reconcileResult.reconciled_missing_chapters,
							external: reconcileResult.external_titles.length
						}
					})}
				</p>
			{/if}
			<Input
				type="search"
				placeholder={$_('downloads.externalSearchPlaceholder')}
				bind:value={externalSearch}
				class="h-9 text-sm"
			/>
			{#if reconcileLoading}
				<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
			{:else if reconcileResult}
				{#if filteredExternalTitles.length === 0}
					<p class="text-xs text-[var(--text-ghost)]">{$_('downloads.noExternalTitles')}</p>
				{:else}
					<div class="flex flex-col">
						{#each filteredExternalTitles as item (item.key)}
							<div
								class="flex items-center justify-between gap-3 border-b border-[var(--void-3)] py-2.5"
							>
								<div class="min-w-0">
									<p class="line-clamp-1 text-sm text-[var(--text)]">{item.title}</p>
									<p class="mt-0.5 text-[10px] text-[var(--text-ghost)]">
										{item.source_name}{#if item.source_lang}
											[{item.source_lang}]{/if} · {item.chapters_count}
										{$_('title.chapters').toLowerCase()}
									</p>
									{#if item.reason}
										<p class="mt-0.5 line-clamp-1 text-[10px] text-[var(--text-ghost)]">
											{item.reason}
										</p>
									{/if}
								</div>
								<div class="shrink-0">
									{#if item.importable}
										<Button
											variant="ghost"
											size="sm"
											onclick={() => handleImportExternalTitle(item)}
											disabled={importingExternalKey === item.key}
											loading={importingExternalKey === item.key}
										>
											{item.in_library ? $_('downloads.linkChapters') : $_('downloads.importTitle')}
										</Button>
									{:else if !item.source_id}
										<div class="flex items-center gap-2">
											<select
												class="h-8 min-w-[9rem] border border-[var(--line)] bg-[var(--void-2)] px-2 text-xs text-[var(--text)]"
												value={sourceByExternalKey[item.key] ?? ''}
												onchange={(event) =>
													setManualSource(
														item.key,
														(event.currentTarget as HTMLSelectElement).value
													)}
												disabled={sourcesLoading || availableSources.length === 0}
											>
												<option value="">{$_('downloads.selectSource')}</option>
												{#each availableSources as source (source.id)}
													<option value={source.id}
														>{source.name}{source.lang ? ` [${source.lang}]` : ''}</option
													>
												{/each}
											</select>
											<Button
												variant="ghost"
												size="sm"
												onclick={() =>
													handleImportExternalTitle(item, sourceByExternalKey[item.key] ?? null)}
												disabled={!sourceByExternalKey[item.key] ||
													importingExternalKey === item.key ||
													sourcesLoading}
												loading={importingExternalKey === item.key}
											>
												{$_('downloads.importTitle')}
											</Button>
										</div>
									{:else}
										<span class="text-xs text-[var(--text-ghost)]"
											>{$_('downloads.notImportable')}</span
										>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
			{#if reconcileError}
				<p class="text-xs text-[var(--error)]">{reconcileError}</p>
			{/if}
		</div>
	{/if}

	<!-- Tabs -->
	<div class="flex gap-6 border-b border-[var(--void-3)]">
		{#each tabs as tab (tab.key)}
			{@const count = tabCount(tab.key)}
			<button
				type="button"
				class="relative pb-2.5 text-xs font-medium tracking-wide transition-colors {activeTab ===
				tab.key
					? 'text-[var(--text)]'
					: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
				onclick={() => (activeTab = tab.key)}
			>
				{$_(tab.labelKey)}
				{#if count > 0}
					<span
						class="ml-1.5 text-[10px] tabular-nums {activeTab === tab.key
							? 'text-[var(--text-muted)]'
							: 'text-[var(--void-6)]'}">{count}</span
					>
				{/if}
				{#if activeTab === tab.key}
					<div class="absolute inset-x-0 -bottom-px h-px bg-[var(--text)]"></div>
				{/if}
			</button>
		{/each}
	</div>

	<!-- Content -->
	{#if isLoading && !dashboard.generatedAt}
		<div class="flex items-center justify-center py-20">
			<Icon name="loader" size={16} class="animate-spin text-[var(--text-ghost)]" />
		</div>
	{:else if activeTab === 'monitored'}
		<!-- Monitored titles -->
		{#if dashboard.monitoredTitles.length === 0}
			<div class="flex flex-col items-center py-20">
				<p class="text-sm text-[var(--text-ghost)]">{$_('downloads.noMonitored')}</p>
			</div>
		{:else}
			<div class="flex flex-col gap-1">
				{#each dashboard.monitoredTitles as item (item.titleId)}
					{@const progress =
						item.totalChapters > 0
							? Math.round((item.downloadedChapters / item.totalChapters) * 100)
							: 0}
					<div class="group flex gap-3 py-2 transition-opacity {item.enabled ? '' : 'opacity-35'}">
						<!-- Cover -->
						<a href={buildTitlePath(item.titleId, item.title)} class="shrink-0">
							<LazyImage
								src={item.cover}
								alt={item.title}
								class="h-16 w-11 border border-[var(--line)]"
							/>
						</a>
						<!-- Content -->
						<a href={buildTitlePath(item.titleId, item.title)} class="min-w-0 flex-1">
							<!-- Row 1: Title + Chapter fraction -->
							<div class="flex items-baseline justify-between gap-2">
								<p class="line-clamp-1 text-sm text-[var(--text)]">{item.title}</p>
								<span class="shrink-0 text-xs text-[var(--text-soft)] tabular-nums">
									{item.downloadedChapters}/{item.totalChapters}
								</span>
							</div>
							<!-- Row 2: Source + flags -->
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
							<!-- Row 3: Queue/failed alerts -->
							{#if item.queuedTasks > 0 || item.failedTasks > 0}
								<div class="mt-0.5 flex items-center gap-2 text-[10px]">
									{#if item.queuedTasks > 0}
										<span class="text-[var(--text-ghost)]"
											>{item.queuedTasks} {$_('downloads.queued').toLowerCase()}</span
										>
									{/if}
									{#if item.failedTasks > 0}
										<span class="text-[var(--error)]"
											>{item.failedTasks} {$_('downloads.failed').toLowerCase()}</span
										>
									{/if}
								</div>
							{/if}
							<!-- Row 4: Progress bar -->
							<div class="mt-2 h-0.5 w-full overflow-hidden bg-[var(--void-4)]">
								<div
									class="h-full bg-[var(--text-muted)] transition-[width]"
									style="width: {progress}%"
								></div>
							</div>
						</a>
						<!-- Toggle action (same pattern as extensions page) -->
						<button
							type="button"
							class="flex h-5 w-9 shrink-0 items-center self-center px-0.5 transition-colors {item.enabled
								? 'justify-end bg-[var(--success)]/20'
								: 'justify-start bg-[var(--void-5)]'}"
							onclick={() => toggleMonitoring(item.titleId, !item.enabled)}
							disabled={profileActionTitleId === item.titleId}
							title={item.enabled ? $_('extensions.disable') : $_('extensions.enable')}
						>
							{#if profileActionTitleId === item.titleId}
								<div class="flex h-4 w-4 items-center justify-center bg-[var(--void-6)]">
									<Icon name="loader" size={10} class="animate-spin text-[var(--text-ghost)]" />
								</div>
							{:else}
								<div
									class="h-4 w-4 {item.enabled ? 'bg-[var(--success)]' : 'bg-[var(--void-6)]'}"
								></div>
							{/if}
						</button>
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		<!-- Task list (active / history) -->
		{@const tasks = getTasksList(activeTab)}
		{#if tasks.length === 0}
			<div class="flex flex-col items-center py-20">
				<p class="text-sm text-[var(--text-ghost)]">
					{activeTab === 'active' ? $_('downloads.noActive') : $_('downloads.noHistory')}
				</p>
			</div>
		{:else}
			<div class="flex flex-col gap-1">
				{#each tasks as task (task.id)}
					{@const time = formatTime(task.updatedAt)}
					{@const progress = activePlannedProgress(task)}
					{@const stats = taskStats(task)}
					<div class="group flex gap-3 py-2">
						<!-- Cover -->
						<a href={buildTitlePath(task.titleId, task.title)} class="shrink-0">
							<LazyImage
								src={task.cover}
								alt={task.title}
								class="h-16 w-11 border border-[var(--line)]"
							/>
						</a>
						<!-- Content -->
						<div class="min-w-0 flex-1">
							<!-- Row 1: Title + Percentage -->
							<div class="flex items-baseline justify-between gap-2">
								<a href={buildTitlePath(task.titleId, task.title)} class="min-w-0">
									<p class="line-clamp-1 text-sm text-[var(--text)]">{task.title}</p>
								</a>
								<span class="shrink-0 text-sm text-[var(--text)] tabular-nums"
									>{progress.percent}%</span
								>
							</div>
							<!-- Row 2: Chapter -->
							<p class="mt-0.5 line-clamp-1 text-xs text-[var(--text-muted)]">{task.chapter}</p>
							<!-- Row 3: Metadata -->
							<div
								class="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--text-ghost)]"
							>
								{#if stats.chaptersTotal > 1}
									<span>{stats.chaptersTotal} ch</span>
								{/if}
								{#if stats.chaptersQueued > 0}
									<span>{stats.chaptersQueued} {$_('downloads.queued').toLowerCase()}</span>
								{/if}
								{#if task.chaptersFailed > 0}
									<span class="text-[var(--error)]"
										>{task.chaptersFailed} {$_('downloads.failed').toLowerCase()}</span
									>
								{/if}
								<span>{$_(time.key, { values: time.values })}</span>
								{#if activeTab === 'active' && task.isPaused}
									<span class="text-[var(--text-muted)]"
										>{$_('downloads.paused').toLowerCase()}</span
									>
								{/if}
							</div>
							<!-- Row 4: Progress bar with status glow -->
							<div class="mt-2 h-0.5 w-full bg-[var(--void-4)]">
								<div
									class="h-full transition-[width] duration-300 {statusBarClass[task.status]}"
									style="width: {progress.percent}%"
								></div>
							</div>
							<!-- Error (suppress redundant "Paused" when already shown in metadata) -->
							{#if task.error && task.error !== 'Paused'}
								<p class="mt-1 line-clamp-1 text-[10px] text-[var(--error)]">{task.error}</p>
							{/if}
						</div>
						<!-- Pause/Resume action -->
						{#if activeTab === 'active'}
							<button
								type="button"
								class="flex h-8 w-8 shrink-0 items-center justify-center self-center text-[var(--text-ghost)] transition-all hover:text-[var(--text-muted)]"
								onclick={() => togglePause(task.titleId, !task.isPaused)}
								disabled={profileActionTitleId === task.titleId}
								title={task.isPaused ? $_('downloads.resume') : $_('downloads.pause')}
							>
								{#if profileActionTitleId === task.titleId}
									<Icon name="loader" size={15} class="animate-spin" />
								{:else}
									<Icon name={task.isPaused ? 'play' : 'pause'} size={15} />
								{/if}
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
