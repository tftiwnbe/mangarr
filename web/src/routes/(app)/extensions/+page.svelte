<script lang="ts">
	import { browser } from '$app/environment';
	import { useConvexClient } from 'convex-svelte';
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { get } from 'svelte/store';
	import { slide } from 'svelte/transition';
	import {
		ArrowsClockwiseIcon,
		CaretDownIcon,
		CaretRightIcon,
		CheckIcon,
		GearIcon,
		GlobeIcon,
		PlusIcon,
		PuzzlePieceIcon,
		SpinnerIcon
	} from 'phosphor-svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import { type AcceptedCommandResponse, waitForCommand } from '$lib/client/commands';
	import { Alert } from '$lib/elements/alert';
	import WebViewAuthDialog from '$lib/components/webview-auth-dialog.svelte';
	import { Button } from '$lib/elements/button';
	import { EmptyState } from '$lib/elements/empty-state';
	import { Input } from '$lib/elements/input';
	import { SearchInput } from '$lib/elements/search-input';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { Switch } from '$lib/elements/switch';
	import { Tabs } from '$lib/elements/tabs';
	import {
		buildResetPreferenceEntries,
		buildPreferenceEntries,
		mapSourcePreferencesBundle,
		type PreferenceBundle,
		type SourcePreferencesResolved
	} from '$lib/extensions/source-preferences';
	import { _ } from '$lib/i18n';
	import { contentLanguages, setKnownContentLanguages } from '$lib/stores/content-languages';
	import {
		normalizeContentLanguageCode,
		toMainContentLanguages
	} from '$lib/utils/content-languages';

	type TabValue = 'installed' | 'available';

	type SourceMeta = {
		id: string;
		name: string;
		lang: string;
		supportsLatest: boolean;
		enabled?: boolean;
	};

	type InstalledExtension = {
		pkg: string;
		name: string;
		lang: string;
		version: string;
		nsfw: boolean;
		use_proxy: boolean;
		icon?: string | null;
		sources: SourceMeta[];
	};

	type RepoItem = {
		pkg: string;
		name: string;
		version: string;
		lang: string;
		nsfw: boolean;
		icon?: string | null;
		sources: SourceMeta[];
	};

	type InstalledResponse = {
		ok: boolean;
		items: InstalledExtension[];
	};

	type RepositoryState = {
		url?: string;
		configured?: boolean;
		languages?: string[];
		extensionCount?: number;
	};

	type SourcePreferenceEntry = {
		key: string;
		value: unknown;
	};

	type AvailableExtensionsResult = {
		items?: RepoItem[];
	};

	let activeTab = $state<TabValue>('installed');
	let loading = $state(true);
	let availableLoading = $state(false);
	let error = $state<string | null>(null);
	let refreshing = $state(false);
	let searchQuery = $state('');
	let selectedLang = $state<string | null>(null);
	let expandedPkg = $state<string | null>(null);
	let installingPkg = $state<string | null>(null);
	let uninstallingPkg = $state<string | null>(null);
	let togglingProxyPkg = $state<string | null>(null);
	let togglingSourceId = $state<string | null>(null);
	let webViewPackage = $state<string | null>(null);
	let webViewExtensionName = $state<string | null>(null);
	let clearingAuthPkg = $state<string | null>(null);
	let renderLimit = $state(60);
	let renderMoreRaf = 0;
	let availableAutoloadDone = $state(false);

	let repository = $state<RepositoryState | null>(null);
	let installedExtensions = $state<InstalledExtension[]>([]);
	let availableExtensions = $state<RepoItem[]>([]);

	let sourceSettingsOpen = $state(false);
	let sourceSettingsLoading = $state(false);
	let sourceSettingsSaving = $state(false);
	let sourceSettingsAction = $state<'save' | 'reset' | null>(null);
	let sourceSettingsError = $state<string | null>(null);
	let sourceSettingsData = $state<SourcePreferencesResolved | null>(null);
	let pendingPreferenceChanges = new SvelteMap<string, unknown>();
	const convexClient = useConvexClient();

	const trimmedSearch = $derived(searchQuery.trim().toLowerCase());

	const filteredInstalled = $derived.by(() => {
		if (!trimmedSearch) return installedExtensions;
		return installedExtensions.filter(
			(extension) =>
				displayExtensionName(extension.name).toLowerCase().includes(trimmedSearch) ||
				extension.lang.toLowerCase().includes(trimmedSearch) ||
				extension.sources.some(
					(source) =>
						source.name.toLowerCase().includes(trimmedSearch) ||
						source.lang.toLowerCase().includes(trimmedSearch)
				)
		);
	});

	const availableLangs = $derived.by(() => {
		const langs = toMainContentLanguages(availableExtensions.map((item) => item.lang));
		return ['all', ...langs];
	});

	const filteredAvailable = $derived.by(() => {
		let list = availableExtensions;
		if (selectedLang && selectedLang !== 'all') {
			list = list.filter((item) => normalizeContentLanguageCode(item.lang) === selectedLang);
		}
		if (!trimmedSearch) return list;
		return list.filter(
			(item) =>
				displayExtensionName(item.name).toLowerCase().includes(trimmedSearch) ||
				item.lang.toLowerCase().includes(trimmedSearch) ||
				item.pkg.toLowerCase().includes(trimmedSearch)
		);
	});

	const visibleAvailable = $derived(filteredAvailable.slice(0, renderLimit));

	const canResetSourceSettings = $derived.by(
		() => Boolean(sourceSettingsData) && sourceSettingsData!.preferences.length > 0
	);

	$effect(() => {
		const allLangs = [
			...installedExtensions.flatMap((item) => item.sources.map((source) => source.lang)),
			...availableExtensions.map((item) => item.lang)
		];
		if (allLangs.length > 0) {
			setKnownContentLanguages(allLangs);
		}
	});

	$effect(() => {
		void trimmedSearch;
		void selectedLang;
		renderLimit = 60;
	});

	onMount(() => {
		const handleRenderMore = () => scheduleRenderMore();
		window.addEventListener('scroll', handleRenderMore, { passive: true });
		window.addEventListener('resize', handleRenderMore);
		void (async () => {
			await refreshPage();
			scheduleRenderMore();
			loading = false;
		})();
		return () => {
			if (renderMoreRaf) {
				window.cancelAnimationFrame(renderMoreRaf);
				renderMoreRaf = 0;
			}
			window.removeEventListener('scroll', handleRenderMore);
			window.removeEventListener('resize', handleRenderMore);
		};
	});

	function getBrowserFetch(): typeof window.fetch {
		if (!browser) {
			throw new Error('Browser fetch is unavailable during server-side rendering');
		}

		return window.fetch.bind(window);
	}

	async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
		const response = await getBrowserFetch()(url, init);
		const text = await response.text();
		const data = text ? (JSON.parse(text) as T | { message?: string }) : null;
		if (!response.ok) {
			const message =
				typeof data === 'object' && data && 'message' in data && typeof data.message === 'string'
					? data.message
					: `Request failed with ${response.status}`;
			throw new Error(message);
		}
		return data as T;
	}

	async function waitForAcceptedCommand<TResult = Record<string, unknown>>(
		accepted: AcceptedCommandResponse,
		timeoutMs = 30_000
	): Promise<TResult | null> {
		const command = await waitForCommand(convexClient, accepted.commandId as Id<'commands'>, {
			timeoutMs,
			pollIntervalMs: 300
		});
		return (command.result ?? null) as TResult | null;
	}

	function displayExtensionName(name: string) {
		return name.replace(/^tachiyomi:\s*/i, '').trim();
	}

	function scheduleRenderMore() {
		if (typeof window === 'undefined' || renderMoreRaf) return;
		renderMoreRaf = window.requestAnimationFrame(() => {
			renderMoreRaf = 0;
			if (
				activeTab !== 'available' ||
				availableLoading ||
				renderLimit >= filteredAvailable.length
			) {
				return;
			}
			const documentHeight = document.documentElement.scrollHeight;
			const viewportBottom = window.scrollY + window.innerHeight;
			if (documentHeight - viewportBottom <= 960) {
				renderLimit = Math.min(renderLimit + 60, filteredAvailable.length);
			}
		});
	}

	function getExtensionIcon(pkg: string, icon?: string | null) {
		const target = icon ?? deriveRepositoryIconUrl(pkg);
		if (!target) return null;
		const params = new URLSearchParams({
			pkg,
			url: target
		});
		return `/api/extensions/icon?${params.toString()}`;
	}

	function deriveRepositoryIconUrl(pkg: string) {
		const repoUrl = repository?.url?.trim() ?? '';
		if (!repoUrl) return null;
		const separatorIndex = repoUrl.lastIndexOf('/');
		const base = separatorIndex >= 0 ? repoUrl.slice(0, separatorIndex) : repoUrl;
		return `${base}/icon/${pkg}.png`;
	}

	function getFilteredSources(sources: SourceMeta[]) {
		const langs = toMainContentLanguages($contentLanguages);
		if (langs.length === 0) return sources;
		const selected = new Set(langs);
		return sources.filter((source) => {
			const normalized = normalizeContentLanguageCode(source.lang);
			return normalized !== null && selected.has(normalized);
		});
	}

	function installedCountForLabel() {
		return installedExtensions.length;
	}

	function switchTab(tab: TabValue) {
		activeTab = tab;
		searchQuery = '';
		selectedLang = null;
		expandedPkg = null;
	}

	async function refreshPage() {
		refreshing = true;
		error = null;
		availableAutoloadDone = false;
		try {
			await loadRepository();
			await loadInstalledExtensions();
			if (repository?.configured || repository?.url) {
				await loadAvailableExtensions();
			} else {
				availableExtensions = [];
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to load extensions';
		} finally {
			refreshing = false;
		}
	}

	async function loadInstalledExtensions() {
		const result = await fetchJson<InstalledResponse>('/api/internal/bridge/extensions/installed');
		installedExtensions = (result.items ?? []).map((item) => ({
			...item,
			sources: item.sources.map((source) => ({
				...source,
				id: String(source.id)
			})),
			name: displayExtensionName(item.name)
		}));
	}

	async function loadRepository() {
		repository = await fetchJson<RepositoryState>('/api/extensions/repository');
	}

	async function loadAvailableExtensions() {
		availableLoading = true;
		try {
			const accepted = await fetchJson<AcceptedCommandResponse>(
				'/api/extensions/available?limit=5000'
			);
			const result = await waitForAcceptedCommand<AvailableExtensionsResult>(accepted);
			const items = (result?.items ?? []).filter(Boolean);
			availableExtensions = items
				.filter((item) => !isInstalled(item.pkg))
				.map((item) => ({
					...item,
					name: displayExtensionName(item.name)
				}));
			scheduleRenderMore();
		} finally {
			availableLoading = false;
		}
	}

	async function applyPreferredSourceState(extension: InstalledExtension) {
		const enabledLangs = new Set(toMainContentLanguages(get(contentLanguages)));
		for (const source of extension.sources) {
			const normalizedLang = normalizeContentLanguageCode(source.lang);
			const shouldEnable =
				normalizedLang !== null && (enabledLangs.has(normalizedLang) || normalizedLang === 'multi');
			source.enabled = shouldEnable;
			if (shouldEnable) {
				continue;
			}

			try {
				await fetchJson<{ ok: boolean }>('/api/internal/bridge/extensions/source-enabled', {
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						pkg: extension.pkg,
						sourceId: source.id,
						enabled: false
					})
				});
			} catch (cause) {
				if (cause instanceof Error && cause.message === 'Source not found') {
					continue;
				}
				throw cause;
			}
		}
	}

	function isInstalled(pkg: string) {
		return installedExtensions.some((item) => item.pkg === pkg);
	}

	$effect(() => {
		void activeTab;
		void availableLoading;
		void filteredAvailable.length;
		void renderLimit;
		scheduleRenderMore();
	});

	$effect(() => {
		const repositoryReady = Boolean(repository?.configured || repository?.url);
		if (!repositoryReady) return;
		if (availableAutoloadDone) return;
		if (loading || refreshing || availableLoading) return;
		if (availableExtensions.length > 0) return;
		availableAutoloadDone = true;
		void loadAvailableExtensions().catch((cause) => {
			error = cause instanceof Error ? cause.message : 'Failed to load extensions';
		});
	});

	async function handleInstall(pkg: string) {
		installingPkg = pkg;
		error = null;
		try {
			const accepted = await fetchJson<AcceptedCommandResponse>('/api/extensions/install', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ pkg })
			});
			const result = await waitForAcceptedCommand<InstalledExtension>(accepted);
			if (result) {
				await applyPreferredSourceState(result);
			}
			await Promise.all([loadInstalledExtensions(), loadAvailableExtensions()]);
			activeTab = 'installed';
			expandedPkg = pkg;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to install extension';
		} finally {
			installingPkg = null;
		}
	}

	async function handleUninstall(pkg: string) {
		uninstallingPkg = pkg;
		error = null;
		try {
			const accepted = await fetchJson<AcceptedCommandResponse>('/api/extensions/uninstall', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ pkg })
			});
			await waitForAcceptedCommand(accepted);
			if (expandedPkg === pkg) expandedPkg = null;
			await Promise.all([loadInstalledExtensions(), loadAvailableExtensions()]);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to uninstall extension';
		} finally {
			uninstallingPkg = null;
		}
	}

	async function handleToggleProxy(pkg: string, useProxy: boolean) {
		togglingProxyPkg = pkg;
		error = null;
		try {
			await fetchJson<{ ok: boolean }>('/api/internal/bridge/extensions/proxy', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ pkg, useProxy })
			});
			installedExtensions = installedExtensions.map((item) =>
				item.pkg === pkg ? { ...item, use_proxy: useProxy } : item
			);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to update extension proxy';
		} finally {
			togglingProxyPkg = null;
		}
	}

	async function handleToggleSource(pkg: string, sourceId: string, enabled: boolean) {
		sourceId = String(sourceId);
		togglingSourceId = sourceId;
		error = null;
		try {
			await fetchJson<{ ok: boolean }>('/api/internal/bridge/extensions/source-enabled', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ pkg, sourceId, enabled })
			});
			installedExtensions = installedExtensions.map((item) =>
				item.pkg === pkg
					? {
							...item,
							sources: item.sources.map((source) =>
								source.id === sourceId ? { ...source, enabled } : source
							)
						}
					: item
			);
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : 'Failed to update source';
			if (message === 'Source not found') {
				await loadInstalledExtensions();
				error = null;
			} else {
				error = message;
			}
		} finally {
			togglingSourceId = null;
		}
	}

	function openExtensionAuthentication(extension: InstalledExtension) {
		webViewPackage = extension.pkg;
		webViewExtensionName = displayExtensionName(extension.name);
	}

	function closeExtensionAuthentication() {
		webViewPackage = null;
		webViewExtensionName = null;
	}

	async function clearExtensionAuthentication(extension: InstalledExtension) {
		if (!window.confirm($_('extensions.clearAuthConfirm'))) return;
		clearingAuthPkg = extension.pkg;
		error = null;
		try {
			await fetchJson<{ ok: boolean }>('/api/internal/bridge/extensions/webview/cookies', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ packageName: extension.pkg })
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : $_('extensions.clearAuthFailed');
		} finally {
			clearingAuthPkg = null;
		}
	}

	async function openSourceSettings(sourceId: string) {
		sourceId = String(sourceId);
		sourceSettingsOpen = true;
		sourceSettingsLoading = true;
		sourceSettingsError = null;
		sourceSettingsData = null;
		pendingPreferenceChanges.clear();
		try {
			const accepted = await fetchJson<AcceptedCommandResponse>(
				`/api/extensions/source-preferences?sourceId=${encodeURIComponent(sourceId)}`
			);
			const bundle = await waitForAcceptedCommand<PreferenceBundle>(accepted);
			if (!bundle) {
				throw new Error('Source preferences command returned no result');
			}
			sourceSettingsData = mapSourcePreferencesBundle(bundle);
		} catch (cause) {
			sourceSettingsError =
				cause instanceof Error ? cause.message : 'Failed to load source preferences';
		} finally {
			sourceSettingsLoading = false;
		}
	}

	function closeSourceSettings() {
		sourceSettingsOpen = false;
		sourceSettingsData = null;
		sourceSettingsError = null;
		sourceSettingsAction = null;
		pendingPreferenceChanges.clear();
	}

	function handlePreferenceChange(key: string, value: unknown) {
		pendingPreferenceChanges.set(key, value);
	}

	function getCurrentValue(pref: NonNullable<typeof sourceSettingsData>['preferences'][number]) {
		if (pendingPreferenceChanges.has(pref.key)) return pendingPreferenceChanges.get(pref.key);
		return pref.current_value ?? pref.default_value;
	}

	async function resetSourceSettings() {
		if (!sourceSettingsData) return;
		sourceSettingsSaving = true;
		sourceSettingsAction = 'reset';
		sourceSettingsError = null;
		try {
			const visibleEntries = buildResetPreferenceEntries(
				sourceSettingsData
			) as SourcePreferenceEntry[];
			const entries = Object.values(
				visibleEntries.reduce<Record<string, SourcePreferenceEntry>>((acc, entry) => {
					acc[entry.key] = entry;
					return acc;
				}, {})
			);
			if (entries.length === 0) return;
			const accepted = await fetchJson<AcceptedCommandResponse>(
				'/api/extensions/source-preferences',
				{
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						sourceId: sourceSettingsData.source_id,
						entries
					})
				}
			);
			await waitForAcceptedCommand(accepted);
			await openSourceSettings(sourceSettingsData.source_id);
		} catch (cause) {
			sourceSettingsError =
				cause instanceof Error ? cause.message : 'Failed to reset source preferences';
		} finally {
			sourceSettingsAction = null;
			sourceSettingsSaving = false;
		}
	}

	async function saveSourceSettings() {
		if (!sourceSettingsData || pendingPreferenceChanges.size === 0) return;
		sourceSettingsSaving = true;
		sourceSettingsAction = 'save';
		sourceSettingsError = null;
		try {
			const entries = buildPreferenceEntries(
				pendingPreferenceChanges.entries()
			) as SourcePreferenceEntry[];
			const accepted = await fetchJson<AcceptedCommandResponse>(
				'/api/extensions/source-preferences',
				{
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						sourceId: sourceSettingsData.source_id,
						entries
					})
				}
			);
			await waitForAcceptedCommand(accepted);
			await openSourceSettings(sourceSettingsData.source_id);
		} catch (cause) {
			sourceSettingsError =
				cause instanceof Error ? cause.message : 'Failed to save source preferences';
		} finally {
			sourceSettingsAction = null;
			sourceSettingsSaving = false;
		}
	}
</script>

<svelte:head>
	<title>{$_('nav.extensions')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-4">
	<div class="flex items-center gap-3">
		<h1 class="text-display flex-1 text-xl text-[var(--text)]">
			{$_('nav.extensions').toLowerCase()}
		</h1>
		<button
			type="button"
			class="flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
			onclick={() => void refreshPage()}
			disabled={refreshing || availableLoading || loading}
		>
			<ArrowsClockwiseIcon
				size={15}
				class={refreshing || availableLoading || loading ? 'animate-spin' : ''}
			/>
		</button>
	</div>

	<Tabs
		tabs={[
			{ value: 'installed', label: $_('extensions.installed'), count: installedCountForLabel() },
			{ value: 'available', label: $_('extensions.available'), count: availableExtensions.length }
		]}
		value={activeTab}
		onValueChange={(value) => switchTab(value as TabValue)}
	/>

	<SearchInput
		bind:value={searchQuery}
		placeholder={activeTab === 'installed'
			? 'search extensions or sources...'
			: $_('extensions.searchPlaceholder')}
		inputSize="sm"
	/>

	{#if activeTab === 'available' && availableLangs.length > 2}
		<div class="no-scrollbar -mx-1 flex items-center gap-0.5 overflow-x-auto px-1 py-1">
			{#each availableLangs.slice(0, 24) as lang (lang)}
				{@const isActive = (lang === 'all' && !selectedLang) || selectedLang === lang}
				<button
					type="button"
					class="h-7 shrink-0 px-2.5 text-[10px] tracking-wider uppercase transition-colors
						{isActive
						? 'bg-[var(--void-3)] text-[var(--text)]'
						: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
					onclick={() => (selectedLang = lang === 'all' ? null : lang)}
				>
					{lang}
				</button>
			{/each}
		</div>
	{/if}

	{#if error}
		<Alert variant="error">{error}</Alert>
	{/if}

	{#if loading}
		<div class="flex flex-col gap-4 pt-4">
			{#each Array(3) as _, i (i)}
				<div
					class="animate-slide-up px-1 opacity-0"
					style="animation-delay: {i * 80}ms; animation-fill-mode: forwards"
				>
					<div class="flex items-center gap-4">
						<div class="h-11 w-11 shrink-0 animate-pulse bg-[var(--void-3)]"></div>
						<div class="flex flex-1 flex-col gap-2.5">
							<div class="h-3 w-32 animate-pulse bg-[var(--void-3)]"></div>
							<div class="h-2 w-16 animate-pulse bg-[var(--void-2)]"></div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{:else if activeTab === 'installed'}
		{#if installedExtensions.length === 0}
			<EmptyState
				icon={PuzzlePieceIcon}
				title={$_('extensions.noExtensions')}
				description={$_('extensions.installFromRepo')}
				actionLabel={$_('extensions.browseAvailable')}
				onAction={() => switchTab('available')}
			/>
		{:else if filteredInstalled.length === 0}
			<div class="py-12 text-center">
				<p class="text-xs text-[var(--text-muted)]">{$_('common.noResults')}</p>
			</div>
		{:else}
			<div class="flex flex-col gap-0">
				{#each filteredInstalled as ext, i (ext.pkg)}
					{@const isExpanded = expandedPkg === ext.pkg}
					{@const visibleSources = getFilteredSources(ext.sources)}
					{@const enabledCount = ext.sources.filter((source) => source.enabled !== false).length}
					{@const isUninstalling = uninstallingPkg === ext.pkg}
					{@const isTogglingProxy = togglingProxyPkg === ext.pkg}

					<div
						class="transition-all duration-200"
						style="animation: slide-up var(--duration-slow) var(--ease-out) forwards; animation-delay: {Math.min(
							i * 30,
							300
						)}ms; opacity: 0"
					>
						<button
							type="button"
							class="flex w-full items-center gap-4 px-1 py-4 text-left transition-colors hover:bg-[var(--void-1)] {isExpanded
								? ''
								: 'border-b border-[var(--line-soft)]'}"
							onclick={() => (expandedPkg = isExpanded ? null : ext.pkg)}
						>
							{#if getExtensionIcon(ext.pkg, ext.icon)}
								<img
									src={getExtensionIcon(ext.pkg, ext.icon) ?? undefined}
									alt=""
									class="h-11 w-11 shrink-0 object-contain"
								/>
							{:else}
								<div class="flex h-11 w-11 shrink-0 items-center justify-center bg-[var(--void-2)]">
									<PuzzlePieceIcon size={20} class="text-[var(--text-ghost)]" />
								</div>
							{/if}

							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="truncate text-[15px] leading-tight text-[var(--text)]"
										>{displayExtensionName(ext.name)}</span
									>
									{#if ext.nsfw}
										<span class="shrink-0 text-[10px] text-[var(--text-ghost)]">18+</span>
									{/if}
								</div>
								<p class="mt-1 text-[11px] text-[var(--text-ghost)]">
									v{ext.version} · {enabledCount} active
								</p>
							</div>

							{#if isExpanded}
								<CaretDownIcon size={14} class="shrink-0 text-[var(--text-ghost)]" />
							{:else}
								<CaretRightIcon size={14} class="shrink-0 text-[var(--text-ghost)]" />
							{/if}
						</button>

						{#if isExpanded}
							<div transition:slide={{ duration: 150 }}>
								<div class="border-b border-[var(--line-soft)] px-1 pt-1 pb-4">
									<!-- Sources -->
									<div class="mb-4">
										{#if visibleSources.length === 0}
											<p class="py-3 text-xs text-[var(--text-ghost)]">
												no sources match your language preferences
											</p>
										{:else}
											{#each visibleSources as source (source.id)}
												<div
													class="flex items-center gap-3 py-2 transition-opacity {source.enabled ===
													false
														? 'opacity-40'
														: ''}"
												>
													<div class="min-w-0 flex-1">
														<div class="flex items-center gap-2">
															<span class="truncate text-xs text-[var(--text-soft)]"
																>{source.name}</span
															>
															<span
																class="shrink-0 border border-[var(--void-4)] px-1 py-px text-[9px] tracking-wider text-[var(--text-ghost)] uppercase"
															>
																{source.lang}
															</span>
														</div>
													</div>
													<button
														type="button"
														class="flex h-7 w-7 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:bg-[var(--void-3)] hover:text-[var(--text-soft)]"
														onclick={() => void openSourceSettings(source.id)}
														title={$_('extensions.sourceSettings')}
													>
														<GearIcon size={13} />
													</button>
													<Switch
														checked={source.enabled !== false}
														disabled={togglingSourceId === source.id}
														loading={togglingSourceId === source.id}
														onCheckedChange={(enabled) =>
															void handleToggleSource(ext.pkg, source.id, enabled)}
													/>
												</div>
											{/each}
										{/if}
									</div>

									<!-- Extension controls -->
									<div
										class="grid gap-3 border-t border-[var(--line-soft)] pt-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-4"
									>
										<div class="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:flex-wrap">
											<Button
												variant="outline"
												size="sm"
												class="w-full whitespace-nowrap md:w-auto"
												onclick={() => openExtensionAuthentication(ext)}
											>
												<GlobeIcon size={13} />
												{$_('extensions.authenticate')}
											</Button>
											<Button
												variant="ghost"
												size="sm"
												class="w-full whitespace-nowrap md:w-auto"
												onclick={() => void clearExtensionAuthentication(ext)}
												loading={clearingAuthPkg === ext.pkg}
												disabled={clearingAuthPkg === ext.pkg}
											>
												{$_('extensions.clearAuth')}
											</Button>
										</div>
										<div
											class="flex items-center justify-between border-t border-[var(--line-soft)] pt-3 md:ml-auto md:justify-start md:gap-4 md:border-t-0 md:pt-0"
										>
											<div class="flex items-center gap-3">
												<span class="text-[11px] text-[var(--text-ghost)]"
													>{$_('extensions.proxy').toLowerCase()}</span
												>
												<Switch
													checked={ext.use_proxy}
													disabled={isTogglingProxy}
													loading={isTogglingProxy}
													onCheckedChange={(enabled) => void handleToggleProxy(ext.pkg, enabled)}
												/>
											</div>
											<div class="h-4 w-px bg-[var(--line-soft)]"></div>
											<button
												type="button"
												class="flex items-center gap-1.5 text-[11px] text-[var(--text-ghost)] transition-colors hover:text-[var(--error)] disabled:pointer-events-none disabled:opacity-40"
												onclick={() => void handleUninstall(ext.pkg)}
												disabled={isUninstalling}
											>
												{#if isUninstalling}
													<SpinnerIcon size={11} class="animate-spin" />
												{/if}
												{$_('extensions.uninstall').toLowerCase()}
											</button>
										</div>
									</div>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{:else if availableLoading}
		<div class="flex items-center justify-center py-20">
			<SpinnerIcon size={16} class="animate-spin text-[var(--text-ghost)]" />
		</div>
	{:else if !repository?.configured}
		<div class="flex flex-col items-center gap-5 py-20 text-center">
			<div class="flex h-16 w-16 items-center justify-center bg-[var(--void-2)]">
				<PuzzlePieceIcon size={24} class="text-[var(--text-muted)]" />
			</div>
			<div>
				<p class="text-sm text-[var(--text)]">{$_('extensions.allInstalled')}</p>
				<p class="mt-1.5 text-xs text-[var(--text-ghost)]">{$_('extensions.noRepoConfigured')}</p>
			</div>
		</div>
	{:else if filteredAvailable.length === 0}
		<div class="py-12 text-center">
			<p class="text-xs text-[var(--text-muted)]">{$_('common.noResults')}</p>
		</div>
	{:else}
		<p class="text-[10px] tracking-wider text-[var(--text-ghost)] uppercase">
			{filteredAvailable.length} extensions
		</p>

		<div class="flex flex-col">
			{#each visibleAvailable as ext, i (ext.pkg)}
				{@const isInstalling = installingPkg === ext.pkg}
				<div
					class="flex items-center gap-4 border-b border-[var(--line-soft)] px-1 py-3.5 transition-colors hover:bg-[var(--void-1)]"
					style="animation: slide-up var(--duration-slow) var(--ease-out) forwards; animation-delay: {Math.min(
						i * 20,
						400
					)}ms; opacity: 0"
				>
					{#if getExtensionIcon(ext.pkg, ext.icon)}
						<img
							src={getExtensionIcon(ext.pkg, ext.icon) ?? undefined}
							alt=""
							class="h-10 w-10 shrink-0 object-contain"
						/>
					{:else}
						<div class="flex h-10 w-10 shrink-0 items-center justify-center bg-[var(--void-2)]">
							<PuzzlePieceIcon size={16} class="text-[var(--text-ghost)]" />
						</div>
					{/if}
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="truncate text-[15px] leading-tight text-[var(--text)]"
								>{displayExtensionName(ext.name)}</span
							>
							<span class="shrink-0 text-[10px] tracking-wider text-[var(--text-ghost)] uppercase"
								>{ext.lang}</span
							>
							{#if ext.nsfw}
								<span class="shrink-0 text-[10px] text-[var(--text-ghost)]">18+</span>
							{/if}
						</div>
						<p class="text-[11px] text-[var(--text-ghost)]">v{ext.version}</p>
					</div>
					<button
						type="button"
						class="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text)] disabled:pointer-events-none disabled:opacity-40"
						onclick={() => void handleInstall(ext.pkg)}
						disabled={isInstalling}
						title={$_('extensions.install')}
					>
						{#if isInstalling}
							<SpinnerIcon size={14} class="animate-spin" />
						{:else}
							<PlusIcon size={16} />
						{/if}
					</button>
				</div>
			{/each}
		</div>

		{#if visibleAvailable.length < filteredAvailable.length}
			<div class="flex flex-col items-center gap-3 py-4">
				<SpinnerIcon size={16} class="animate-spin text-[var(--text-ghost)]" />
				<Button
					variant="outline"
					size="sm"
					onclick={() => {
						renderLimit = Math.min(renderLimit + 60, filteredAvailable.length);
						scheduleRenderMore();
					}}
				>
					Load more
				</Button>
			</div>
		{/if}
	{/if}
</div>

<WebViewAuthDialog
	open={webViewPackage !== null}
	packageName={webViewPackage}
	extensionName={webViewExtensionName}
	onclose={closeExtensionAuthentication}
/>

<SlidePanel
	open={sourceSettingsOpen}
	title={sourceSettingsData
		? `${sourceSettingsData.name} settings`
		: $_('extensions.sourceSettings')}
	onclose={closeSourceSettings}
>
	{#snippet footer()}
		{#if canResetSourceSettings || pendingPreferenceChanges.size > 0}
			<div class="flex w-full gap-3">
				{#if canResetSourceSettings}
					<Button
						variant="outline"
						size="md"
						onclick={() => void resetSourceSettings()}
						disabled={sourceSettingsSaving}
						loading={sourceSettingsSaving && sourceSettingsAction === 'reset'}
						class="flex-1"
					>
						{$_('common.reset')}
					</Button>
				{/if}
				{#if pendingPreferenceChanges.size > 0}
					<Button
						variant="solid"
						size="md"
						onclick={() => void saveSourceSettings()}
						disabled={sourceSettingsSaving}
						loading={sourceSettingsSaving && sourceSettingsAction === 'save'}
						class="flex-1"
					>
						{$_('common.save')} ({pendingPreferenceChanges.size})
					</Button>
				{/if}
			</div>
		{/if}
	{/snippet}
	{#if sourceSettingsLoading}
		<div class="flex flex-col items-center gap-4 py-16">
			<SpinnerIcon size={20} class="animate-spin text-[var(--text-muted)]" />
			<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
		</div>
	{:else if sourceSettingsError}
		<Alert variant="error" class="mt-4">{sourceSettingsError}</Alert>
	{:else if sourceSettingsData}
		{@const visiblePrefs = sourceSettingsData.preferences.filter((pref) => pref.visible)}
		{@const hasAnyPrefs = visiblePrefs.length > 0}

		{#if !hasAnyPrefs}
			<div class="flex flex-col items-center gap-4 py-16 text-center">
				<GearIcon size={28} class="text-[var(--text-ghost)]" />
				<p class="text-xs text-[var(--text-ghost)]">{$_('extensions.noPreferences')}</p>
			</div>
		{:else}
			<div class="flex flex-col gap-4">
				{#each visiblePrefs as pref (pref.key)}
					<div class="border-b border-[var(--line-soft)] py-4">
						<div class="flex items-start justify-between gap-3">
							<div class="flex-1">
								<p class="text-sm text-[var(--text)]">{pref.title}</p>
								{#if pref.summary}
									<p class="mt-0.5 text-xs text-[var(--text-ghost)]">{pref.summary}</p>
								{/if}
							</div>
							{#if pref.type === 'toggle'}
								{@const val = Boolean(getCurrentValue(pref))}
								<Switch
									checked={val}
									disabled={!pref.enabled}
									onCheckedChange={(enabled) => handlePreferenceChange(pref.key, enabled)}
								/>
							{/if}
						</div>

						{#if pref.type === 'list' && pref.entries && pref.entry_values}
							{@const val = String(getCurrentValue(pref) ?? '')}
							<div class="mt-3 flex flex-col">
								{#each pref.entries as entry, i (entry)}
									{@const entryVal = pref.entry_values?.[i] ?? entry}
									{@const isSelected = val === entryVal}
									<button
										type="button"
										class="flex items-center gap-3 px-2 py-2 text-xs transition-colors {isSelected
											? 'text-[var(--text)]'
											: 'text-[var(--text-muted)] hover:bg-[var(--void-2)] hover:text-[var(--text-soft)]'}"
										onclick={() => handlePreferenceChange(pref.key, entryVal)}
										disabled={!pref.enabled}
									>
										<span
											class="group-radio relative flex h-3.5 w-3.5 shrink-0 items-center justify-center border transition-colors {isSelected
												? 'border-[var(--cosmic)] bg-[var(--cosmic-soft)]'
												: 'border-[var(--void-6)]'}"
										>
											{#if isSelected}
												<span
													class="h-1.5 w-1.5 bg-[var(--cosmic)] shadow-[0_0_4px_var(--cosmic-glow)]"
												></span>
											{/if}
										</span>
										{entry}
									</button>
								{/each}
							</div>
						{/if}

						{#if pref.type === 'multi_select' && pref.entries && pref.entry_values}
							{@const val = ((getCurrentValue(pref) as string[]) ?? []).map(String)}
							<div class="mt-3 flex flex-col">
								{#each pref.entries as entry, i (entry)}
									{@const entryVal = pref.entry_values?.[i] ?? entry}
									{@const isSelected = val.includes(entryVal)}
									<button
										type="button"
										class="flex items-center gap-3 px-2 py-2 text-xs transition-colors {isSelected
											? 'text-[var(--text)]'
											: 'text-[var(--text-muted)] hover:bg-[var(--void-2)] hover:text-[var(--text-soft)]'}"
										onclick={() => {
											const next = isSelected
												? val.filter((item) => item !== entryVal)
												: [...val, entryVal];
											handlePreferenceChange(pref.key, next);
										}}
										disabled={!pref.enabled}
									>
										<span
											class="flex h-3.5 w-3.5 shrink-0 items-center justify-center border transition-colors {isSelected
												? 'border-[var(--cosmic)] bg-[var(--cosmic)] shadow-[0_0_4px_var(--cosmic-glow)]'
												: 'border-[var(--void-6)]'}"
										>
											{#if isSelected}
												<CheckIcon size={9} class="text-[var(--void-0)]" />
											{/if}
										</span>
										{entry}
									</button>
								{/each}
							</div>
						{/if}

						{#if pref.type === 'text'}
							<div class="mt-3">
								<Input
									value={String(getCurrentValue(pref) ?? '')}
									disabled={!pref.enabled}
									oninput={(event) =>
										handlePreferenceChange(
											pref.key,
											(event.currentTarget as HTMLInputElement).value
										)}
								/>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</SlidePanel>
