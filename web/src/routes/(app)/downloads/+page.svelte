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

	const dashboard = $derived($downloadsDashboardStore.data);
	const isLoading = $derived($downloadsDashboardStore.isLoading);
	const numberFormatter = new Intl.NumberFormat();
	const filteredExternalTitles = $derived.by<DownloadExternalTitleResource[]>(() => {
		const all = reconcileResult?.external_titles ?? [];
		const query = externalSearch.trim().toLowerCase();
		if (!query) return all;
		return all.filter((item) => {
			return (
				item.title.toLowerCase().includes(query) ||
				item.source_name.toLowerCase().includes(query) ||
				(item.source_lang ?? '').toLowerCase().includes(query)
			);
		});
	});
	const activeQueueProgress = $derived.by(() => {
		if (dashboard.activeTasks.length === 0) {
			return null;
		}

		let scheduledChapters = 0;
		let queuedChapters = 0;
		let downloadingChapters = 0;
		let failedChapters = 0;
		let completedChapters = 0;
		let downloadedPages = 0;
		let totalPages = 0;

		for (const task of dashboard.activeTasks) {
			scheduledChapters += Math.max(0, task.chaptersTotal);
			queuedChapters += Math.max(0, task.chaptersQueued);
			downloadingChapters += Math.max(0, task.chaptersDownloading);
			failedChapters += Math.max(0, task.chaptersFailed);
			completedChapters += Math.max(0, task.chaptersCompleted + task.chaptersCancelled);
			if (task.totalPages > 0) {
				totalPages += task.totalPages;
				downloadedPages += Math.min(task.totalPages, Math.max(0, task.downloadedPages));
			}
		}

		const percent =
			totalPages > 0
				? Math.round((downloadedPages / totalPages) * 100)
				: scheduledChapters > 0
					? Math.round((completedChapters / scheduledChapters) * 100)
					: 0;

		return {
			percent: Math.max(0, Math.min(100, percent)),
			scheduledChapters,
			queuedChapters,
			downloadingChapters,
			failedChapters,
			downloadedPages,
			totalPages
		};
	});

	const statusColors: Record<DownloadStatus, string> = {
		downloading: 'text-[var(--text)]',
		queued: 'text-[var(--text-muted)]',
		completed: 'text-[var(--success)]',
		failed: 'text-[var(--error)]',
		cancelled: 'text-[var(--text-ghost)]'
	};

	const statusIcons: Record<DownloadStatus, string> = {
		downloading: 'loader',
		queued: 'clock',
		completed: 'check-circle',
		failed: 'x-circle',
		cancelled: 'x'
	};

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
			const sources = await listSources({ enabled: true });
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
		if (importingExternalKey === item.key) {
			return;
		}
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
		if (profileActionTitleId === titleId) {
			return;
		}
		profileActionTitleId = titleId;
		try {
			await updateDownloadProfile(titleId, { paused });
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
			unit += 1;
		}
		const decimals = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
		return `${value.toFixed(decimals)} ${units[unit]}`;
	}

	function overviewLabelKey(
		key: 'downloadedChapters' | 'avgChapterSize' | 'estimatedCapacity'
	): string {
		if (key === 'avgChapterSize') return 'downloads.avgChapterSize';
		if (key === 'estimatedCapacity') return 'downloads.estimatedCapacity';
		return 'downloads.downloadedChapters';
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
</script>

<svelte:head>
	<title>{$_('nav.downloads')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h1 class="text-display text-xl text-[var(--text)]">{$_('nav.downloads').toLowerCase()}</h1>
	</div>

	<!-- Overview stats -->
	{#if dashboard.overview.length > 0}
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
			{#each dashboard.overview as stat}
				<div class="border border-[var(--line)] bg-[var(--void-2)] p-3">
					<p class="text-xs text-[var(--text-ghost)]">{$_(overviewLabelKey(stat.key))}</p>
					<p class="mt-1 text-lg text-[var(--text)]">{overviewValue(stat.key, stat.value)}</p>
					{#if stat.key === 'estimatedCapacity' && stat.secondaryValue !== undefined}
						<p class="mt-1 text-[11px] text-[var(--text-ghost)]">
							{$_('downloads.freeSpace')}: {formatBytes(stat.secondaryValue)}
						</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- Actions -->
	<div class="flex flex-col gap-2">
		<Button
			variant="outline"
			size="sm"
			onclick={handleRunMonitor}
			disabled={runningAction !== null}
		>
			{#if runningAction === 'cycle'}
				<Icon name="loader" size={14} class="animate-spin" />
			{:else}
				<Icon name="search" size={14} />
			{/if}
			{$_('downloads.runNow')}
		</Button>
		<Button
			variant="outline"
			size="sm"
			onclick={handleReconcileDownloads}
			disabled={reconcileLoading}
		>
			{#if reconcileLoading}
				<Icon name="loader" size={14} class="animate-spin" />
			{:else}
				<Icon name="search" size={14} />
			{/if}
			{$_('downloads.scanDownloads')}
		</Button>
		<p class="text-xs text-[var(--text-ghost)]">{$_('downloads.autoWorkerHint')}</p>
	</div>

	<!-- Reconcile results -->
	{#if reconcileResult || reconcileLoading || reconcileError}
		<div class="flex flex-col gap-3 border border-[var(--line)] bg-[var(--void-2)] p-3">
			{#if reconcileResult}
				<p class="text-sm text-[var(--text-muted)]">
					{$_('downloads.reconcileSummary', {
						values: {
							fixed: reconcileResult.reconciled_missing_chapters,
							external: reconcileResult.external_titles.length
						}
					})}
				</p>
			{/if}
			<div class="flex items-center gap-2">
				<Input
					type="search"
					placeholder={$_('downloads.externalSearchPlaceholder')}
					bind:value={externalSearch}
				/>
			</div>
			{#if reconcileLoading}
				<p class="text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
			{:else if reconcileResult}
				{#if filteredExternalTitles.length === 0}
					<p class="text-sm text-[var(--text-ghost)]">{$_('downloads.noExternalTitles')}</p>
				{:else}
					<div class="flex flex-col gap-2">
						{#each filteredExternalTitles as item (item.key)}
							<div class="flex items-center justify-between gap-3 border border-[var(--line)] bg-[var(--void-3)] p-2">
								<div class="min-w-0">
									<p class="line-clamp-1 text-sm text-[var(--text)]">{item.title}</p>
									<p class="mt-0.5 text-xs text-[var(--text-ghost)]">
										{item.source_name}
										{#if item.source_lang}
											[{item.source_lang}]
										{/if}
										• {item.chapters_count} {$_('title.chapters').toLowerCase()}
									</p>
									{#if item.reason}
										<p class="mt-0.5 line-clamp-1 text-xs text-[var(--text-ghost)]">{item.reason}</p>
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
												class="h-8 min-w-[10rem] border border-[var(--line)] bg-[var(--void-2)] px-2 text-xs text-[var(--text)]"
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
													<option value={source.id}>
														{source.name}
														{source.lang ? ` [${source.lang}]` : ''}
													</option>
												{/each}
											</select>
											<Button
												variant="ghost"
												size="sm"
												onclick={() =>
													handleImportExternalTitle(item, sourceByExternalKey[item.key] ?? null)}
												disabled={
													!sourceByExternalKey[item.key] ||
													importingExternalKey === item.key ||
													sourcesLoading
												}
												loading={importingExternalKey === item.key}
											>
												{$_('downloads.importTitle')}
											</Button>
										</div>
									{:else}
										<span class="text-xs text-[var(--text-ghost)]">{$_('downloads.notImportable')}</span>
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
	<div class="flex gap-1 border-b border-[var(--line)]">
		<button
			type="button"
			class="px-4 py-2 text-sm transition-colors {activeTab === 'active'
				? 'border-b-2 border-[var(--text)] text-[var(--text)]'
				: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
			onclick={() => (activeTab = 'active')}
		>
			{$_('downloads.active')} ({dashboard.activeTasks.length})
		</button>
		<button
			type="button"
			class="px-4 py-2 text-sm transition-colors {activeTab === 'history'
				? 'border-b-2 border-[var(--text)] text-[var(--text)]'
				: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
			onclick={() => (activeTab = 'history')}
		>
			{$_('downloads.history')} ({dashboard.recentTasks.length})
		</button>
		<button
			type="button"
			class="px-4 py-2 text-sm transition-colors {activeTab === 'monitored'
				? 'border-b-2 border-[var(--text)] text-[var(--text)]'
				: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
			onclick={() => (activeTab = 'monitored')}
		>
			{$_('downloads.monitored')} ({dashboard.monitoredTitles.length})
		</button>
	</div>

	<!-- Content -->
	{#if isLoading && !dashboard.generatedAt}
		<div class="flex flex-col items-center gap-4 py-16">
			<Icon name="loader" size={24} class="animate-spin text-[var(--text-muted)]" />
			<p class="text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
		</div>
	{:else if activeTab === 'monitored'}
		<!-- Monitored titles -->
		{#if dashboard.monitoredTitles.length === 0}
			<div class="flex flex-col items-center gap-4 py-12 text-center">
				<div
					class="flex h-16 w-16 items-center justify-center border border-[var(--line)] bg-[var(--void-3)]"
				>
					<Icon name="book" size={24} class="text-[var(--text-ghost)]" />
				</div>
				<div>
					<p class="text-[var(--text)]">{$_('downloads.noMonitored')}</p>
					<p class="mt-1 text-sm text-[var(--text-ghost)]">
						{$_('downloads.noMonitoredDescription')}
					</p>
				</div>
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each dashboard.monitoredTitles as item (item.titleId)}
					<div class="card-glow flex gap-3 border border-[var(--line)] bg-[var(--void-2)] p-3">
						<a href={buildTitlePath(item.titleId, item.title)} class="flex min-w-0 flex-1 gap-3">
							<LazyImage
								src={item.cover}
								alt={item.title}
								class="h-20 w-14 border border-[var(--line)]"
							/>
							<div class="min-w-0 flex-1">
							<p class="line-clamp-1 font-medium text-[var(--text)]">{item.title}</p>
							<div class="mt-1 flex items-center gap-2 text-xs">
								{#if item.enabled}
									<span class="text-[var(--success)]">{$_('downloads.enabled')}</span>
								{:else}
									<span class="text-[var(--text-ghost)]">{$_('downloads.disabled')}</span>
								{/if}
								{#if item.paused}
									<span class="bg-[var(--void-4)] px-1 py-0.5 text-[var(--text-muted)]"
										>{$_('downloads.paused')}</span
									>
								{/if}
								{#if item.autoDownload}
									<span class="bg-[var(--void-4)] px-1 py-0.5 text-[var(--text-muted)]"
										>{$_('downloads.autoDownload')}</span
									>
								{/if}
							</div>
							<div class="mt-1 text-xs text-[var(--text-ghost)]">
								{item.downloadedChapters}/{item.totalChapters}
								{$_('downloads.downloaded')}
							</div>
							<div class="mt-1 text-xs text-[var(--text-ghost)]">
								{$_('downloads.titleSize')}: {formatBytes(item.downloadedBytes)}
							</div>
							<div class="mt-1 text-xs text-[var(--text-ghost)]">
								{$_('downloads.avgTitleChapterSize')}: {formatBytes(item.avgChapterSizeBytes)}
							</div>
							{#if item.variantSources.length > 0}
								<div class="mt-1 line-clamp-2 text-xs text-[var(--text-ghost)]">
									{item.variantSources.join(', ')}
								</div>
							{/if}
							{#if item.queuedTasks > 0}
								<div class="mt-1 text-xs text-[var(--text-muted)]">
									{item.queuedTasks}
									{$_('downloads.queued')}
								</div>
							{/if}
							{#if item.failedTasks > 0}
								<div class="mt-1 text-xs text-[var(--error)]">
									{item.failedTasks}
									{$_('downloads.failed')}
								</div>
							{/if}
							</div>
						</a>
						{#if item.enabled || item.paused}
							<div class="flex shrink-0 items-start">
								<Button
									variant="ghost"
									size="sm"
									onclick={() => togglePause(item.titleId, !item.paused)}
									disabled={profileActionTitleId === item.titleId}
									loading={profileActionTitleId === item.titleId}
								>
									{item.paused ? $_('downloads.resume') : $_('downloads.pause')}
								</Button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		<!-- Task list -->
		{@const tasks = getTasksList(activeTab)}
		{#if tasks.length === 0}
			<div class="flex flex-col items-center gap-4 py-12 text-center">
				<div
					class="flex h-16 w-16 items-center justify-center border border-[var(--line)] bg-[var(--void-3)]"
				>
					<Icon name="download" size={24} class="text-[var(--text-ghost)]" />
				</div>
				<div>
					<p class="text-[var(--text)]">
						{activeTab === 'active' ? $_('downloads.noActive') : $_('downloads.noHistory')}
					</p>
				</div>
			</div>
		{:else}
			{#if activeTab === 'active' && activeQueueProgress}
				<div class="mb-3 border border-[var(--line)] bg-[var(--void-2)] p-3">
					<div class="flex items-center justify-between gap-3">
						<p class="text-sm text-[var(--text-muted)]">{$_('downloads.overallQueueProgress')}</p>
						<p class="text-sm font-medium text-[var(--text)]">{activeQueueProgress.percent}%</p>
					</div>
					<div class="mt-2 h-2 overflow-hidden bg-[var(--void-4)]">
						<div
							class="h-full bg-[var(--text)] transition-[width]"
							style={`width:${activeQueueProgress.percent}%`}
						></div>
					</div>
					<div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--text-ghost)]">
						<span
							>{activeQueueProgress.scheduledChapters}
							{$_('title.chapters').toLowerCase()}</span
						>
						{#if activeQueueProgress.queuedChapters > 0}
							<span>•</span>
							<span
								>{activeQueueProgress.queuedChapters}
								{$_('downloads.queued').toLowerCase()}</span
							>
						{/if}
						{#if activeQueueProgress.downloadingChapters > 0}
							<span>•</span>
							<span
								>{activeQueueProgress.downloadingChapters}
								{$_('downloads.downloading').toLowerCase()}</span
							>
						{/if}
						{#if activeQueueProgress.failedChapters > 0}
							<span>•</span>
							<span class="text-[var(--error)]"
								>{activeQueueProgress.failedChapters}
								{$_('downloads.failed').toLowerCase()}</span
							>
						{/if}
					</div>
				</div>
			{/if}
			<div class="flex flex-col divide-y divide-[var(--line)] border border-[var(--line)]">
				{#each tasks as task (task.id)}
					{@const time = formatTime(task.updatedAt)}
					<div class="flex gap-4 p-4 transition-colors hover:bg-[var(--void-3)]">
						<LazyImage src={task.cover} alt={task.title} class="h-16 w-11 border border-[var(--line)]" />
						<div class="min-w-0 flex-1">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="line-clamp-1 font-medium text-[var(--text)]">{task.title}</p>
									<p class="line-clamp-1 text-xs text-[var(--text-ghost)]">
										{task.sources.join(', ')}
									</p>
								</div>
								<div class="flex items-center gap-2">
									<span class="{statusColors[task.status]} flex items-center gap-1 text-xs">
										<Icon
											name={statusIcons[task.status]}
											size={12}
											class={task.status === 'downloading' ? 'animate-spin' : ''}
										/>
										{$_(`downloads.${task.status}`)}
									</span>
									{#if task.isPaused}
										<span class="text-xs text-[var(--text-ghost)]">{$_('downloads.paused')}</span>
									{/if}
								</div>
								</div>
								<p class="mt-1 line-clamp-1 text-sm text-[var(--text-muted)]">{task.chapter}</p>
								{#if activeTab !== 'active'}
									<div class="mt-2 h-1.5 overflow-hidden bg-[var(--void-4)]">
										<div
											class="h-full bg-[var(--text)] transition-[width]"
											style={`width:${task.progressPercent}%`}
										></div>
									</div>
								{/if}
								<div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--text-ghost)]">
									<span>{task.progressPercent}%</span>
								<span>•</span>
								<span>{task.chaptersTotal} {$_('title.chapters').toLowerCase()}</span>
								{#if task.chaptersQueued > 0}
									<span>•</span>
									<span>{task.chaptersQueued} {$_('downloads.queued').toLowerCase()}</span>
								{/if}
								{#if task.chaptersDownloading > 0}
									<span>•</span>
									<span>{task.chaptersDownloading} {$_('downloads.downloading').toLowerCase()}</span>
								{/if}
								{#if task.chaptersCompleted > 0}
									<span>•</span>
									<span>{task.chaptersCompleted} {$_('downloads.completed').toLowerCase()}</span>
								{/if}
								{#if task.chaptersFailed > 0}
									<span>•</span>
									<span class="text-[var(--error)]"
										>{task.chaptersFailed} {$_('downloads.failed').toLowerCase()}</span
									>
								{/if}
								<span>•</span>
								<span>{$_(time.key, { values: time.values })}</span>
							</div>
							{#if task.error}
								<p class="mt-1 line-clamp-2 text-xs text-[var(--error)]">{task.error}</p>
							{/if}
						</div>
						{#if activeTab === 'active'}
							<div class="flex items-center">
								<Button
									variant="ghost"
									size="sm"
									onclick={() => togglePause(task.titleId, !task.isPaused)}
									disabled={profileActionTitleId === task.titleId}
									loading={profileActionTitleId === task.titleId}
								>
									{task.isPaused ? $_('downloads.resume') : $_('downloads.pause')}
								</Button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
