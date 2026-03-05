<script lang="ts">
	import { onMount } from 'svelte';

	import { listSources, searchFeed, type SourceSummary } from '$lib/api/explore';
	import {
		importExternalDownloadTitle,
		reconcileDownloads,
		updateDownloadProfile,
		type DownloadExternalTitleResource,
		type DownloadReconcileResource
	} from '$lib/api/downloads';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';

	import { Button } from '$lib/elements/button';
	import { Icon } from '$lib/elements/icon';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { Select } from '$lib/elements/select';
	import { Switch } from '$lib/elements/switch';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { downloadsDashboardStore, runDownloadCycle } from '$lib/stores/downloads';
	import { wsManager } from '$lib/stores/ws';
	import type { DownloadStatus, DownloadTaskItem } from '$lib/utils/download-mappers';
	import { _ } from '$lib/i18n';
	import { buildTitlePath } from '$lib/utils/routes';
	import { panelOverlayOpen } from '$lib/stores/ui';

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
	let importDialogItem = $state<DownloadExternalTitleResource | null>(null);
	$effect(() => {
		panelOverlayOpen.set(importDialogItem !== null);
		return () => panelOverlayOpen.set(false);
	});
	let importDialogSourceId = $state('');
	let importDialogQuery = $state('');
	let importDialogSearchError = $state<string | null>(null);
	let importDialogCandidates = $state<ImportCandidate[]>([]);
	let importDialogSearching = $state(false);
	let importDialogSelectedTitleUrl = $state<string | null>(null);
	let importDialogSubmitting = $state(false);
	let importSearchRequestId = $state(0);

	type ImportCandidate = {
		title: string;
		titleUrl: string;
		thumbnailUrl: string;
		sourceName: string;
		sourceLang: string | null;
	};
	type ExploreSearchItem = Awaited<ReturnType<typeof searchFeed>>['items'][number];

	const dashboard = $derived($downloadsDashboardStore.data);
	const isLoading = $derived($downloadsDashboardStore.isLoading);
	const numberFormatter = new Intl.NumberFormat();

	const monitoredByTitleId = $derived.by(() => {
		const map = new SvelteMap<number, (typeof dashboard.monitoredTitles)[number]>();
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

		// Refresh immediately on download events; debounce so bursts merge.
		let debounceTimer: ReturnType<typeof setTimeout> | null = null;
		function scheduleRefresh() {
			if (document.hidden) return;
			if (debounceTimer !== null) return;
			debounceTimer = setTimeout(() => {
				debounceTimer = null;
				void downloadsDashboardStore.refresh();
			}, 800);
		}

		const unsubscribeDone = wsManager.on('task.done', scheduleRefresh);
		const unsubscribeMonitor = wsManager.on('monitor.run', scheduleRefresh);
		const unsubscribeWorker = wsManager.on('worker.run', scheduleRefresh);

		// Fallback poll every 60 s in case the WS is disconnected.
		const interval = setInterval(() => {
			if (document.hidden) return;
			void downloadsDashboardStore.refresh();
		}, 60_000);

		return () => {
			clearInterval(interval);
			if (debounceTimer !== null) clearTimeout(debounceTimer);
			unsubscribeDone();
			unsubscribeMonitor();
			unsubscribeWorker();
		};
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

	function sourceLabel(source: SourceSummary): string {
		return `${source.name}${source.lang ? ` [${source.lang}]` : ''}`;
	}

	function normalizeImportText(value: string): string {
		return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
	}

	function buildImportCandidates(items: ExploreSearchItem[], sourceId: string): ImportCandidate[] {
		const candidates: ImportCandidate[] = [];
		const seen = new SvelteSet<string>();
		for (const item of items) {
			const sourceLink =
				item.links.find((entry) => (entry.source.id ?? '').trim() === sourceId) ?? item.links[0];
			const titleUrl = sourceLink?.title_url?.trim() ?? '';
			if (!titleUrl || seen.has(titleUrl)) continue;
			seen.add(titleUrl);
			candidates.push({
				title: item.title,
				titleUrl,
				thumbnailUrl: item.thumbnail_url ?? '',
				sourceName: sourceLink?.source.name ?? '',
				sourceLang: sourceLink?.source.lang ?? null
			});
		}
		return candidates;
	}

	function pickImportCandidate(
		candidates: ImportCandidate[],
		query: string,
		preferredTitleUrl: string | null
	): string | null {
		if (preferredTitleUrl && candidates.some((entry) => entry.titleUrl === preferredTitleUrl)) {
			return preferredTitleUrl;
		}
		const normalizedQuery = normalizeImportText(query);
		if (normalizedQuery) {
			const exact = candidates.find((entry) => normalizeImportText(entry.title) === normalizedQuery);
			if (exact) return exact.titleUrl;
			const partial = candidates.find((entry) => normalizeImportText(entry.title).includes(normalizedQuery));
			if (partial) return partial.titleUrl;
		}
		return candidates[0]?.titleUrl ?? null;
	}

	function resolveInitialImportSourceId(item: DownloadExternalTitleResource): string {
		const direct = (item.source_id ?? '').trim();
		if (direct) return direct;

		const sourceName = item.source_name.trim().toLowerCase();
		const sourceLang = (item.source_lang ?? '').trim().toLowerCase();
		if (!sourceName || sourceName === 'unknown source' || sourceName === 'local') {
			return '';
		}

		const strict = availableSources.find(
			(source) =>
				source.name.trim().toLowerCase() === sourceName &&
				(source.lang ?? '').trim().toLowerCase() === sourceLang
		);
		if (strict) return strict.id;

		const byNameOnly = availableSources.find(
			(source) => source.name.trim().toLowerCase() === sourceName
		);
		return byNameOnly?.id ?? '';
	}

	async function runImportSearch() {
		const sourceId = importDialogSourceId.trim();
		const query = importDialogQuery.trim();
		importSearchRequestId += 1;
		const requestId = importSearchRequestId;
		if (!sourceId) {
			importDialogSearchError = $_('downloads.selectSourceToImport');
			importDialogCandidates = [];
			importDialogSelectedTitleUrl = null;
			importDialogSearching = false;
			return;
		}
		if (!query) {
			importDialogSearchError = $_('downloads.importDialogTitleRequired');
			importDialogCandidates = [];
			importDialogSelectedTitleUrl = null;
			importDialogSearching = false;
			return;
		}

		importDialogSearching = true;
		importDialogSearchError = null;
		try {
			const feed = await searchFeed({
				query,
				source_id: sourceId,
				page: 1,
				limit: 20
			});
			if (requestId !== importSearchRequestId) return;
			const candidates = buildImportCandidates(feed.items, sourceId);
			const fallbackTitleUrl =
				importDialogItem?.source_id?.trim() === sourceId
					? (importDialogItem.title_url ?? '').trim() || null
					: null;
			if (fallbackTitleUrl && !candidates.some((entry) => entry.titleUrl === fallbackTitleUrl)) {
				const source = availableSources.find((entry) => entry.id === sourceId);
				candidates.unshift({
					title: importDialogItem?.title ?? query,
					titleUrl: fallbackTitleUrl,
					thumbnailUrl: '',
					sourceName: source?.name ?? importDialogItem?.source_name ?? '',
					sourceLang: source?.lang ?? importDialogItem?.source_lang ?? null
				});
			}
			importDialogCandidates = candidates;
			importDialogSelectedTitleUrl = pickImportCandidate(candidates, query, fallbackTitleUrl);
			if (candidates.length === 0) {
				importDialogSearchError = $_('downloads.importDialogNoMatches');
			}
		} catch (error) {
			if (requestId !== importSearchRequestId) return;
			importDialogCandidates = [];
			importDialogSelectedTitleUrl = null;
			importDialogSearchError =
				error instanceof Error ? error.message : $_('downloads.importDialogSearchFailed');
		} finally {
			if (requestId === importSearchRequestId) {
				importDialogSearching = false;
			}
		}
	}

	async function openImportDialog(item: DownloadExternalTitleResource) {
		importDialogItem = item;
		importDialogSourceId = resolveInitialImportSourceId(item);
		importDialogQuery = item.title;
		importDialogSearchError = null;
		importDialogCandidates = [];
		importDialogSelectedTitleUrl = (item.title_url ?? '').trim() || null;
		importDialogSubmitting = false;
		importSearchRequestId += 1;
		if (importDialogSourceId) {
			await runImportSearch();
		}
	}

	function closeImportDialog() {
		if (importDialogSubmitting) return;
		importDialogItem = null;
		importDialogSourceId = '';
		importDialogQuery = '';
		importDialogSearchError = null;
		importDialogCandidates = [];
		importDialogSearching = false;
		importDialogSelectedTitleUrl = null;
		importDialogSubmitting = false;
		importSearchRequestId += 1;
	}

	async function submitImportDialog() {
		if (!importDialogItem) return;
		const sourceId = importDialogSourceId.trim();
		if (!sourceId) {
			importDialogSearchError = $_('downloads.selectSourceToImport');
			return;
		}
		importDialogSubmitting = true;
		try {
			await handleImportExternalTitle(importDialogItem, sourceId, importDialogSelectedTitleUrl);
			closeImportDialog();
		} finally {
			importDialogSubmitting = false;
		}
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
		sourceIdOverride?: string | null,
		titleUrlOverride?: string | null
	) {
		if (importingExternalKey === item.key) return;
		const sourceId = sourceIdOverride?.trim() || item.source_id?.trim() || '';
		if (!sourceId) {
			reconcileError = $_('downloads.selectSourceToImport');
			return;
		}
		const titleUrl = titleUrlOverride?.trim() || item.title_url?.trim() || null;
		importingExternalKey = item.key;
		reconcileError = null;
		try {
			await importExternalDownloadTitle({
				source_id: sourceId,
				title: item.title,
				title_url: titleUrl,
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
			{#each dashboard.overview as stat (stat.key)}
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

	<!-- Reconcile results -->
	{#if reconcileResult || reconcileLoading || reconcileError}
		<div class="flex flex-col gap-4">
			{#if reconcileResult}
				<p class="text-[10px] tracking-wide text-[var(--text-ghost)]">
					{$_('downloads.reconcileSummary', {
						values: {
							fixed: reconcileResult.reconciled_missing_chapters,
							external: reconcileResult.external_titles.length
						}
					})}
				</p>
			{/if}
			<div class="relative">
				<div class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-ghost)]">
					<Icon name="search" size={13} />
				</div>
				<input
					type="search"
					placeholder={$_('downloads.externalSearchPlaceholder')}
					bind:value={externalSearch}
					class="h-11 w-full bg-[var(--void-2)] border border-[var(--void-4)] pl-9 pr-3 text-sm text-[var(--text)] placeholder:text-[var(--text-ghost)] transition-colors hover:border-[var(--void-5)] focus:border-[var(--void-6)] focus:outline-none"
				/>
			</div>
			{#if reconcileLoading}
				<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
			{:else if reconcileResult}
				{#if filteredExternalTitles.length === 0}
					<p class="text-xs text-[var(--text-ghost)]">{$_('downloads.noExternalTitles')}</p>
				{:else}
					<div class="flex flex-col">
						{#each filteredExternalTitles as item (item.key)}
							<div class="flex items-center justify-between gap-4 border-b border-[var(--void-3)] py-3.5">
								<div class="min-w-0 flex-1">
									<p class="line-clamp-1 text-sm text-[var(--text)]">{item.title}</p>
									<div class="mt-1 flex items-center gap-2 text-[10px] text-[var(--text-ghost)]">
										<span>{item.source_name}{#if item.source_lang}&thinsp;[{item.source_lang}]{/if}</span>
										<span class="opacity-30">·</span>
										<span class="tabular-nums">{item.chapters_count} ch</span>
										{#if item.reason}
											<span class="opacity-30">·</span>
											<span class="line-clamp-1 opacity-70">{item.reason}</span>
										{/if}
									</div>
								</div>
								<button
									type="button"
									class="shrink-0 text-[10px] tracking-widest uppercase text-[var(--text-ghost)] transition-colors hover:text-[var(--text)] disabled:opacity-30 disabled:pointer-events-none"
									onclick={() => openImportDialog(item)}
									disabled={importingExternalKey === item.key}
								>
									{#if importingExternalKey === item.key}
										<Icon name="loader" size={12} class="animate-spin" />
									{:else}
										{item.in_library ? $_('downloads.linkChapters') : $_('downloads.importTitle')}
									{/if}
								</button>
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
							<!-- Row 3: Queue alerts -->
							{#if item.queuedTasks > 0}
								<div class="mt-0.5 flex items-center gap-2 text-[10px]">
									<span class="text-[var(--text-ghost)]"
										>{item.queuedTasks} {$_('downloads.queued').toLowerCase()}</span
									>
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
						<!-- Toggle action -->
						<Switch
							checked={item.enabled}
							disabled={profileActionTitleId === item.titleId}
							loading={profileActionTitleId === item.titleId}
							variant="success"
							class="self-center"
							onCheckedChange={(enabled) => void toggleMonitoring(item.titleId, enabled)}
						/>
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

<SlidePanel
	open={importDialogItem !== null}
	title={$_('downloads.importDialogTitle')}
	onclose={closeImportDialog}
>
	{#if importDialogItem}
		<div class="flex flex-col">

			<!-- Title context -->
			<div class="pb-5 mb-5 border-b border-[var(--void-3)]">
				<p class="text-base font-medium text-[var(--text)] leading-snug line-clamp-2">
					{importDialogItem.title}
				</p>
				<div class="mt-2 flex items-baseline gap-2 text-[10px] text-[var(--text-ghost)]">
					<span class="tabular-nums">{importDialogItem.chapters_count} {$_('title.chapters').toLowerCase()}</span>
					<span class="opacity-30">·</span>
					<span class="line-clamp-1 opacity-60 break-all">{importDialogItem.path}</span>
				</div>
			</div>

			<!-- Source selector -->
			<div class="mb-5">
				<p class="mb-2 text-[10px] tracking-widest text-[var(--text-ghost)] uppercase">
					{$_('downloads.importDialogSourceLabel')}
				</p>
				<Select
					bind:value={importDialogSourceId}
					options={availableSources.map((s) => ({ value: s.id, label: sourceLabel(s) }))}
					placeholder={$_('downloads.selectSource')}
					disabled={sourcesLoading || importDialogSubmitting}
					onValueChange={() => {
						importDialogCandidates = [];
						importDialogSelectedTitleUrl = null;
						importDialogSearchError = null;
						importSearchRequestId += 1;
						importDialogSearching = false;
						if (importDialogSourceId.trim() && importDialogQuery.trim()) {
							void runImportSearch();
						}
					}}
				/>
			</div>

			<!-- Search -->
			<div class="mb-5">
				<p class="mb-2 text-[10px] tracking-widest text-[var(--text-ghost)] uppercase">
					{$_('downloads.importDialogSearchLabel')}
				</p>
				<div class="flex gap-2">
					<input
						type="text"
						class="h-11 flex-1 min-w-0 bg-[var(--void-2)] border border-[var(--void-4)] px-3 text-sm text-[var(--text)] placeholder:text-[var(--text-ghost)] transition-colors hover:border-[var(--void-5)] focus:border-[var(--void-6)] focus:outline-none disabled:opacity-40 disabled:pointer-events-none"
						placeholder={$_('downloads.importDialogSearchPlaceholder')}
						bind:value={importDialogQuery}
						onkeydown={(event) => {
							if (event.key !== 'Enter') return;
							event.preventDefault();
							void runImportSearch();
						}}
						disabled={importDialogSubmitting}
					/>
					<button
						type="button"
						class="h-11 w-11 shrink-0 flex items-center justify-center border border-[var(--void-4)] text-[var(--text-ghost)] transition-colors hover:text-[var(--text)] hover:border-[var(--void-6)] disabled:opacity-30 disabled:pointer-events-none"
						onclick={runImportSearch}
						disabled={!importDialogSourceId.trim() || importDialogSearching || importDialogSubmitting}
						title={$_('common.search')}
					>
						{#if importDialogSearching}
							<Icon name="loader" size={14} class="animate-spin" />
						{:else}
							<Icon name="search" size={14} />
						{/if}
					</button>
				</div>
			</div>

			<!-- Error -->
			{#if importDialogSearchError}
				<p class="mb-4 text-[10px] text-[var(--error)]">{importDialogSearchError}</p>
			{/if}

			<!-- Candidates -->
			{#if importDialogSearching && importDialogCandidates.length === 0}
				<div class="flex items-center justify-center py-8">
					<Icon name="loader" size={16} class="animate-spin text-[var(--text-ghost)]" />
				</div>
			{:else if importDialogCandidates.length > 0}
				<div class="flex flex-col -mx-4 mb-5">
					{#each importDialogCandidates as candidate (`${candidate.titleUrl}`)}
						{@const isSelected = importDialogSelectedTitleUrl === candidate.titleUrl}
						<button
							type="button"
							class="flex items-center gap-3 px-4 py-3.5 text-left border-b border-[var(--void-3)] transition-all {isSelected ? 'bg-[var(--void-2)]' : 'hover:bg-[var(--void-3)]'}"
							onclick={() => (importDialogSelectedTitleUrl = candidate.titleUrl)}
						>
							{#if candidate.thumbnailUrl}
								<LazyImage
									src={candidate.thumbnailUrl}
									alt={candidate.title}
									class="h-16 w-11 shrink-0 transition-opacity {isSelected ? 'opacity-100' : 'opacity-40'}"
								/>
							{:else}
								<div class="h-16 w-11 shrink-0 flex items-center justify-center bg-[var(--void-3)] transition-opacity {isSelected ? 'opacity-100' : 'opacity-40'}">
									<Icon name="book-open" size={14} class="text-[var(--text-ghost)]" />
								</div>
							{/if}
							<div class="min-w-0 flex-1 transition-opacity {isSelected ? 'opacity-100' : 'opacity-50'}">
								<p class="line-clamp-2 text-sm {isSelected ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}">{candidate.title}</p>
								<p class="mt-1 text-[10px] text-[var(--text-ghost)]">
									{candidate.sourceName}{#if candidate.sourceLang}&thinsp;[{candidate.sourceLang}]{/if}
								</p>
							</div>
							<div class="shrink-0 w-0.5 self-stretch transition-all {isSelected ? 'bg-[var(--text-muted)]' : 'bg-transparent'}"></div>
						</button>
					{/each}
				</div>
			{:else if importDialogSourceId.trim() && importDialogQuery.trim() && !importDialogSearchError}
				<p class="mb-5 text-xs text-[var(--text-ghost)]">{$_('downloads.importDialogNoMatches')}</p>
			{/if}

			<!-- Hint -->
			<p class="mb-5 text-[10px] leading-relaxed text-[var(--text-ghost)]">
				{$_('downloads.importDialogFallbackHint')}
			</p>

			<!-- Actions -->
			<div class="flex gap-2">
				<Button variant="ghost" size="sm" onclick={closeImportDialog} disabled={importDialogSubmitting}>
					{$_('common.cancel')}
				</Button>
				<Button
					variant="solid"
					size="sm"
					class="flex-1"
					onclick={submitImportDialog}
					disabled={!importDialogSourceId.trim() || importDialogSubmitting}
					loading={importDialogSubmitting}
				>
					{$_('downloads.importDialogConfirm')}
				</Button>
			</div>

		</div>
	{/if}
</SlidePanel>
