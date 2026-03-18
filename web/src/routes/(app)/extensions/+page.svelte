<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { slide } from 'svelte/transition';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import type { Id } from '$convex/_generated/dataModel';
	import {
		ArrowsClockwiseIcon,
		CaretDownIcon,
		CaretRightIcon,
		CheckIcon,
		GearIcon,
		MagnifyingGlassIcon,
		PlusIcon,
		PuzzlePieceIcon,
		SpinnerIcon,
		XIcon
	} from 'phosphor-svelte';

	import { convexApi } from '$lib/convex/api';
	import { Button } from '$lib/elements/button';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { Switch } from '$lib/elements/switch';
	import { Tabs } from '$lib/elements/tabs';
	import { _ } from '$lib/i18n';
	import { contentLanguages, setKnownContentLanguages } from '$lib/stores/content-languages';
	import { panelOverlayOpen } from '$lib/stores/ui';
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

	type FilterMeta = {
		key: string;
		title: string;
		summary?: string;
		type: string;
		enabled?: boolean;
		visible?: boolean;
		default_value?: unknown;
		current_value?: unknown;
		entries?: string[];
		entry_values?: string[];
	};

	type FilterItem = {
		name: string;
		type: string;
		data: FilterMeta;
	};

	type PreferenceBundle = {
		source: { id: string; name: string; lang: string; supportsLatest: boolean };
		preferences: FilterItem[];
		searchFilters: FilterItem[];
	};

	type SourcePreference = {
		key: string;
		title: string;
		summary?: string;
		type: string;
		enabled: boolean;
		visible: boolean;
		default_value?: unknown;
		current_value?: unknown;
		entries?: string[];
		entry_values?: string[];
	};

	type SourcePreferencesResolved = {
		source_id: string;
		name: string;
		lang: string;
		preferences: SourcePreference[];
		searchFilters: SourcePreference[];
	};

	type InstalledResponse = {
		ok: boolean;
		items: InstalledExtension[];
	};

	const client = useConvexClient();
	const repository = useQuery(convexApi.extensions.getRepository, () => ({}));

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
	let renderLimit = $state(60);
	let renderMoreRaf = 0;

	let installedExtensions = $state<InstalledExtension[]>([]);
	let availableExtensions = $state<RepoItem[]>([]);

	let sourceSettingsOpen = $state(false);
	let sourceSettingsLoading = $state(false);
	let sourceSettingsSaving = $state(false);
	let sourceSettingsError = $state<string | null>(null);
	let sourceSettingsData = $state<SourcePreferencesResolved | null>(null);
	let pendingPreferenceChanges = new SvelteMap<string, unknown>();
	let advancedOpen = $state(false);

	let authImportText = $state('');
	let authImportSaving = $state(false);
	let authImportError = $state<string | null>(null);
	let authImportSuccess = $state<string | null>(null);

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
			list = list.filter(
				(item) => normalizeContentLanguageCode(item.lang) === selectedLang
			);
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

	const importedStoragePreferences = $derived.by(() => {
		if (!sourceSettingsData) return [];
		return sourceSettingsData.preferences.filter(isHiddenStoragePreference);
	});

	$effect(() => {
		panelOverlayOpen.set(sourceSettingsOpen);
		return () => panelOverlayOpen.set(false);
	});

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

	async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
		const response = await fetch(url, init);
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

	function displayExtensionName(name: string) {
		return name.replace(/^tachiyomi:\s*/i, '').trim();
	}

	function scheduleRenderMore() {
		if (typeof window === 'undefined' || renderMoreRaf) return;
		renderMoreRaf = window.requestAnimationFrame(() => {
			renderMoreRaf = 0;
			if (activeTab !== 'available' || availableLoading || renderLimit >= filteredAvailable.length) {
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
		if (icon) return icon;
		const repoUrl = repository.data?.url?.trim() ?? '';
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
		try {
			await loadInstalledExtensions();
			if (repository.data?.configured || repository.data?.url) {
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
			name: displayExtensionName(item.name)
		}));
	}

	async function enqueueCommand(commandType: string, payload: Record<string, unknown>) {
		const { commandId } = await client.mutation(convexApi.commands.enqueue, {
			commandType,
			payload,
			idempotencyKey:
				commandType === 'extensions.repo.search'
					? `extensions.repo.search:${String(payload.query ?? '').trim().toLowerCase()}:${Number(payload.limit ?? 0)}`
					: undefined
		});
		return String(commandId);
	}

	async function pollCommand(commandId: string, timeoutMs = 30_000) {
		const startedAt = Date.now();
		while (Date.now() - startedAt < timeoutMs) {
			const row = await client.query(convexApi.commands.getMineById, {
				commandId: commandId as Id<'commands'>
			});
			if (!row) {
				throw new Error('Queued command was not found');
			}
			if (row.status === 'succeeded') {
				return row;
			}
			if (row.status === 'failed' || row.status === 'dead_letter' || row.status === 'cancelled') {
				throw new Error(row.lastErrorMessage ?? 'Bridge command failed');
			}
			await new Promise((resolve) => setTimeout(resolve, 300));
		}
		throw new Error('Command timed out');
	}

	async function loadAvailableExtensions() {
		availableLoading = true;
		try {
			const commandId = await enqueueCommand('extensions.repo.search', {
				query: '',
				limit: 5000
			});
			const command = await pollCommand(commandId);
			const items = ((command.result?.items ?? []) as RepoItem[]).filter(Boolean);
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

	async function handleInstall(pkg: string) {
		installingPkg = pkg;
		error = null;
		try {
			const commandId = await enqueueCommand('extensions.install', { pkg });
			await pollCommand(commandId);
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
			const commandId = await enqueueCommand('extensions.uninstall', { pkg });
			await pollCommand(commandId);
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
			await fetchJson<{ ok: boolean }>(
				'/api/internal/bridge/extensions/proxy',
				{
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ pkg, useProxy })
				}
			);
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
			error = cause instanceof Error ? cause.message : 'Failed to update source';
		} finally {
			togglingSourceId = null;
		}
	}

	function mapBundle(bundle: PreferenceBundle): SourcePreferencesResolved {
		return {
			source_id: bundle.source.id,
			name: bundle.source.name,
			lang: bundle.source.lang,
			preferences: bundle.preferences.map((item) => ({
				key: item.data.key,
				title: item.data.title || item.name || item.data.key,
				summary: item.data.summary,
				type: item.data.type || item.type || 'text',
				enabled: item.data.enabled !== false,
				visible: item.data.visible !== false,
				default_value: item.data.default_value,
				current_value: item.data.current_value,
				entries: item.data.entries,
				entry_values: item.data.entry_values
			})),
			searchFilters: bundle.searchFilters.map((item) => ({
				key: item.data.key,
				title: item.data.title || item.name || item.data.key,
				summary: item.data.summary,
				type: item.data.type || item.type || 'text',
				enabled: item.data.enabled !== false,
				visible: item.data.visible !== false,
				default_value: item.data.default_value,
				current_value: item.data.current_value,
				entries: item.data.entries,
				entry_values: item.data.entry_values
			}))
		};
	}

	async function openSourceSettings(sourceId: string) {
		sourceSettingsOpen = true;
		sourceSettingsLoading = true;
		sourceSettingsError = null;
		sourceSettingsData = null;
		pendingPreferenceChanges.clear();
		advancedOpen = false;
		try {
			const commandId = await enqueueCommand('sources.preferences.fetch', { sourceId });
			const command = await pollCommand(commandId);
			sourceSettingsData = mapBundle(command.result as PreferenceBundle);
			syncAuthImportTextFromImportedStorage(sourceSettingsData);
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
		pendingPreferenceChanges.clear();
		advancedOpen = false;
		authImportText = '';
		authImportSaving = false;
		authImportError = null;
		authImportSuccess = null;
	}

	function handlePreferenceChange(key: string, value: unknown) {
		pendingPreferenceChanges.set(key, value);
	}

	function getCurrentValue(pref: NonNullable<typeof sourceSettingsData>['preferences'][number]) {
		if (pendingPreferenceChanges.has(pref.key)) return pendingPreferenceChanges.get(pref.key);
		return pref.current_value ?? pref.default_value;
	}

	async function saveSourceSettings() {
		if (!sourceSettingsData || pendingPreferenceChanges.size === 0) return;
		sourceSettingsSaving = true;
		sourceSettingsError = null;
		try {
			const values = Object.fromEntries(pendingPreferenceChanges.entries());
			const commandId = await enqueueCommand('sources.preferences.save', {
				sourceId: sourceSettingsData.source_id,
				values
			});
			await pollCommand(commandId);
			await openSourceSettings(sourceSettingsData.source_id);
		} catch (cause) {
			sourceSettingsError =
				cause instanceof Error ? cause.message : 'Failed to save source preferences';
		} finally {
			sourceSettingsSaving = false;
		}
	}

	function parsePossiblyStringifiedJson(value: unknown): unknown {
		if (typeof value !== 'string') return value;
		const trimmed = value.trim();
		if (!trimmed) return value;
		if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value;
		try {
			return JSON.parse(trimmed);
		} catch {
			return value;
		}
	}

	function parseLooseKeyValueInput(input: string): Record<string, unknown> | null {
		const lines = input
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
		if (lines.length === 0) return null;
		const map: Record<string, unknown> = {};
		for (const line of lines) {
			const separatorIndex = line.search(/\s+/);
			if (separatorIndex <= 0) return null;
			const key = line.slice(0, separatorIndex).trim();
			const rawValue = line.slice(separatorIndex).trim();
			if (!key || !rawValue) return null;
			map[key] = parsePossiblyStringifiedJson(rawValue);
		}
		return map;
	}

	function parseAuthImportInput(input: string): Record<string, unknown> {
		const trimmed = input.trim();
		if (!trimmed) throw new Error('Paste JSON or key-value storage dump first.');
		try {
			const parsed = JSON.parse(trimmed);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw new Error('Top-level JSON must be an object.');
			}
			return parsed as Record<string, unknown>;
		} catch {
			const loose = parseLooseKeyValueInput(trimmed);
			if (loose) return loose;
			throw new Error(
				'Unable to parse input. Expected JSON object or lines in format: key <json/value>.'
			);
		}
	}

	function buildLibGroupTokenStorePayload(raw: Record<string, unknown>): Record<string, unknown> {
		let tokenPayload: Record<string, unknown> | null = null;
		let authPayload: Record<string, unknown> | null = null;
		if (raw.token && raw.auth && typeof raw.token === 'object' && typeof raw.auth === 'object') {
			tokenPayload = raw.token as Record<string, unknown>;
			authPayload = raw.auth as Record<string, unknown>;
		}
		const authEntry = parsePossiblyStringifiedJson(raw.auth);
		if (!tokenPayload && authEntry && typeof authEntry === 'object' && !Array.isArray(authEntry)) {
			const authObj = authEntry as Record<string, unknown>;
			if (authObj.token && authObj.auth) {
				tokenPayload = authObj.token as Record<string, unknown>;
				authPayload = authObj.auth as Record<string, unknown>;
			}
		}
		if (!tokenPayload || !authPayload) {
			throw new Error(
				'Unable to find LibGroup auth payload. Expected object with token/auth fields.'
			);
		}
		const userId = Number(authPayload.id);
		if (!Number.isFinite(userId) || userId <= 0) throw new Error('Invalid auth.id in payload.');
		const tokenType = String(tokenPayload.token_type ?? tokenPayload.tokenType ?? '').trim();
		const accessToken = String(tokenPayload.access_token ?? tokenPayload.accessToken ?? '').trim();
		const expiresIn = Number(tokenPayload.expires_in ?? tokenPayload.expiresIn ?? 0);
		const timestamp = Number(tokenPayload.timestamp ?? Date.now());
		if (!tokenType || !accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
			throw new Error('Invalid token payload. token_type, access_token, expires_in are required.');
		}
		return {
			TokenStore: {
				auth: { id: userId },
				token: {
					token_type: tokenType,
					access_token: accessToken,
					expires_in: Math.trunc(expiresIn),
					timestamp: Math.trunc(Number.isFinite(timestamp) ? timestamp : Date.now())
				}
			}
		};
	}

	function normalizeRawMapPayload(raw: Record<string, unknown>): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(raw)) {
			const normalizedKey = key.trim();
			if (!normalizedKey) continue;
			const parsed = parsePossiblyStringifiedJson(value);
			if (
				typeof parsed === 'string' ||
				typeof parsed === 'number' ||
				typeof parsed === 'boolean' ||
				parsed === null
			) {
				out[normalizedKey] = parsed;
			} else {
				out[normalizedKey] = JSON.stringify(parsed);
			}
		}
		try {
			const maybeTokenStore = buildLibGroupTokenStorePayload(raw);
			for (const [key, value] of Object.entries(maybeTokenStore)) {
				out[key] = JSON.stringify(value);
			}
		} catch {
			/* not a LibGroup payload */
		}
		return out;
	}

	function hasStoredValue(value: unknown): boolean {
		if (value === null || value === undefined) return false;
		if (typeof value === 'string') return value.trim().length > 0;
		if (Array.isArray(value)) return value.length > 0;
		return true;
	}

	function isHiddenStoragePreference(
		pref: NonNullable<typeof sourceSettingsData>['preferences'][number]
	): boolean {
		return !pref.visible && hasStoredValue(pref.current_value);
	}

	function getHiddenStorageKeys(): string[] {
		if (!sourceSettingsData) return [];
		return sourceSettingsData.preferences.filter(isHiddenStoragePreference).map((pref) => pref.key);
	}

	function importedStorageMap(
		data: SourcePreferencesResolved | null = sourceSettingsData
	): Record<string, unknown> {
		const map: Record<string, unknown> = {};
		if (!data) return map;
		for (const pref of data.preferences) {
			if (!isHiddenStoragePreference(pref)) continue;
			map[pref.key] = pref.current_value;
		}
		return map;
	}

	function serializeImportedStorageMap(map: Record<string, unknown>): string {
		if (Object.keys(map).length === 0) return '';
		try {
			return JSON.stringify(map, null, 2);
		} catch {
			return '';
		}
	}

	function syncAuthImportTextFromImportedStorage(
		data: SourcePreferencesResolved | null = sourceSettingsData
	) {
		authImportText = serializeImportedStorageMap(importedStorageMap(data));
	}

	async function importAuthStorage() {
		if (!sourceSettingsData) return;
		authImportSaving = true;
		authImportError = null;
		authImportSuccess = null;
		try {
			let mapped: Record<string, unknown> = {};
			if (authImportText.trim()) {
				const raw = parseAuthImportInput(authImportText);
				mapped = normalizeRawMapPayload(raw);
			}
			const existingKeys = getHiddenStorageKeys();
			if (existingKeys.length === 0 && Object.keys(mapped).length === 0) {
				throw new Error('No imported keys yet. Paste JSON map to import.');
			}
			const deletes = Object.fromEntries(existingKeys.map((key) => [key, null]));
			const commandId = await enqueueCommand('sources.preferences.save', {
				sourceId: sourceSettingsData.source_id,
				values: { ...deletes, ...mapped }
			});
			await pollCommand(commandId);
			await openSourceSettings(sourceSettingsData.source_id);
			authImportSuccess =
				Object.keys(mapped).length === 0
					? `Deleted ${existingKeys.length} imported key${existingKeys.length === 1 ? '' : 's'}.`
					: `Replaced imported storage with ${Object.keys(mapped).length} key${Object.keys(mapped).length === 1 ? '' : 's'}.`;
		} catch (cause) {
			authImportError =
				cause instanceof Error ? cause.message : 'Failed to import auth/storage values';
		} finally {
			authImportSaving = false;
		}
	}
</script>

<svelte:head>
	<title>{$_('nav.extensions')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-4">
	<div class="flex items-center gap-3">
		<h1 class="text-display flex-1 text-xl text-[var(--text)]">{$_('nav.extensions').toLowerCase()}</h1>
		<button
			type="button"
			class="flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
			onclick={() => void refreshPage()}
			disabled={refreshing || availableLoading || loading}
		>
			<ArrowsClockwiseIcon size={15} class={refreshing || availableLoading || loading ? 'animate-spin' : ''} />
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

	<div class="relative">
		<MagnifyingGlassIcon
			size={13}
			class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-ghost)]"
		/>
		<input
			type="search"
			placeholder={activeTab === 'installed'
				? 'search extensions or sources...'
				: $_('extensions.searchPlaceholder')}
			bind:value={searchQuery}
			class="h-9 w-full border-b border-[var(--line-soft)] bg-transparent pr-8 pl-8 text-sm text-[var(--text)] transition-colors placeholder:text-[var(--text-ghost)] focus:border-[var(--void-6)] focus:outline-none"
		/>
		{#if searchQuery}
			<button
				type="button"
				class="absolute top-1/2 right-2 -translate-y-1/2 text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
				onclick={() => (searchQuery = '')}
			>
				<XIcon size={13} />
			</button>
		{/if}
	</div>

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
		<div class="bg-[var(--error-soft)] px-4 py-3 text-xs text-[var(--error)]">{error}</div>
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
			<div class="flex flex-col items-center gap-5 py-20 text-center">
				<div class="flex h-16 w-16 items-center justify-center bg-[var(--void-2)]">
					<PuzzlePieceIcon size={24} class="text-[var(--text-ghost)]" />
				</div>
				<div>
					<p class="text-sm text-[var(--text)]">{$_('extensions.noExtensions')}</p>
					<p class="mt-1.5 text-xs text-[var(--text-ghost)]">{$_('extensions.installFromRepo')}</p>
				</div>
				<Button variant="ghost" size="sm" onclick={() => switchTab('available')}>
					{$_('extensions.browseAvailable')}
				</Button>
			</div>
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
						style="animation: slide-up var(--duration-slow) var(--ease-out) forwards; animation-delay: {Math.min(i * 30, 300)}ms; opacity: 0"
					>
						<button
							type="button"
							class="flex w-full items-center gap-4 px-1 py-4 text-left transition-colors hover:bg-[var(--void-1)] {isExpanded ? '' : 'border-b border-[var(--line-soft)]'}"
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
									<span class="truncate text-[15px] leading-tight text-[var(--text)]">{displayExtensionName(ext.name)}</span>
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
								<div class="flex flex-col gap-6 border-b border-[var(--line-soft)] px-1 pt-2 pb-5">
									<div class="flex flex-col gap-1">
										{#if visibleSources.length === 0}
											<p class="py-1 text-xs text-[var(--text-ghost)]">
												no sources match your language preferences
											</p>
										{:else}
											{#each visibleSources as source (source.id)}
												<div class="flex items-center gap-3 py-2.5 transition-colors {source.enabled === false ? 'opacity-45' : ''}">
													<div class="min-w-0 flex-1">
														<div class="flex items-center gap-2">
															<span class="truncate text-xs text-[var(--text-soft)]">{source.name}</span>
															<span class="shrink-0 text-[10px] tracking-wide text-[var(--text-ghost)] uppercase">
																{source.lang}
															</span>
															{#if source.enabled === false}
																<span class="shrink-0 text-[10px] tracking-wide text-[var(--text-ghost)] uppercase">
																	off
																</span>
															{/if}
														</div>
													</div>
													<Switch
														checked={source.enabled !== false}
														disabled={togglingSourceId === source.id}
														loading={togglingSourceId === source.id}
														onCheckedChange={(enabled) => void handleToggleSource(ext.pkg, source.id, enabled)}
													/>
													<button
														type="button"
														class="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:bg-[var(--void-3)] hover:text-[var(--text)]"
														onclick={() => void openSourceSettings(source.id)}
														title={$_('extensions.sourceSettings')}
													>
														<GearIcon size={14} />
													</button>
												</div>
											{/each}
										{/if}
									</div>

									<div class="flex items-center gap-3">
										<span class="flex-1 text-xs text-[var(--text-muted)]">{$_('extensions.proxy').toLowerCase()}</span>
										<Switch
											checked={ext.use_proxy}
											disabled={isTogglingProxy}
											loading={isTogglingProxy}
											onCheckedChange={(enabled) => void handleToggleProxy(ext.pkg, enabled)}
										/>
									</div>

									<button
										type="button"
										class="self-start text-[11px] text-[var(--text-ghost)] transition-colors hover:text-[var(--error)]"
										onclick={() => void handleUninstall(ext.pkg)}
										disabled={isUninstalling}
									>
										{#if isUninstalling}
											<SpinnerIcon size={12} class="mr-1 inline-block animate-spin" />
										{/if}
										{$_('extensions.uninstall').toLowerCase()}
									</button>
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
	{:else if !repository.data?.configured}
		<div class="flex flex-col items-center gap-5 py-20 text-center">
			<div class="flex h-16 w-16 items-center justify-center bg-[var(--void-2)]">
				<CheckIcon size={24} class="text-[var(--text-muted)]" />
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
					style="animation: slide-up var(--duration-slow) var(--ease-out) forwards; animation-delay: {Math.min(i * 20, 400)}ms; opacity: 0"
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
							<span class="truncate text-[15px] leading-tight text-[var(--text)]">{displayExtensionName(ext.name)}</span>
							<span class="shrink-0 text-[10px] tracking-wider text-[var(--text-ghost)] uppercase">{ext.lang}</span>
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

<SlidePanel
	open={sourceSettingsOpen}
	title={sourceSettingsData ? `${sourceSettingsData.name} settings` : $_('extensions.sourceSettings')}
	onclose={closeSourceSettings}
>
	{#if sourceSettingsLoading}
		<div class="flex flex-col items-center gap-4 py-16">
			<SpinnerIcon size={20} class="animate-spin text-[var(--text-muted)]" />
			<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
		</div>
	{:else if sourceSettingsError}
		<div class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-4 py-3 text-xs text-[var(--error)]">
			{sourceSettingsError}
		</div>
	{:else if sourceSettingsData}
		{@const visiblePrefs = sourceSettingsData.preferences.filter((pref) => pref.visible)}
		{@const hasAnyPrefs = visiblePrefs.length > 0 || importedStoragePreferences.length > 0}

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
							<div class="mt-3 flex flex-col gap-1">
								{#each pref.entries as entry, i (entry)}
									{@const entryVal = pref.entry_values?.[i] ?? entry}
									<button
										type="button"
										class="flex items-center gap-2 px-3 py-2.5 text-xs transition-colors {val === entryVal ? 'bg-[var(--void-3)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--void-2)]'}"
										onclick={() => handlePreferenceChange(pref.key, entryVal)}
										disabled={!pref.enabled}
									>
										<div class="h-3 w-3 border border-[var(--void-6)] {val === entryVal ? 'bg-[var(--text)]' : ''}"></div>
										{entry}
									</button>
								{/each}
							</div>
						{/if}

						{#if pref.type === 'multi_select' && pref.entries && pref.entry_values}
							{@const val = ((getCurrentValue(pref) as string[]) ?? []).map(String)}
							<div class="mt-3 flex flex-col gap-1">
								{#each pref.entries as entry, i (entry)}
									{@const entryVal = pref.entry_values?.[i] ?? entry}
									{@const isSelected = val.includes(entryVal)}
									<button
										type="button"
										class="flex items-center gap-2 px-3 py-2.5 text-xs transition-colors {isSelected ? 'bg-[var(--void-3)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--void-2)]'}"
										onclick={() => {
											const next = isSelected ? val.filter((item) => item !== entryVal) : [...val, entryVal];
											handlePreferenceChange(pref.key, next);
										}}
										disabled={!pref.enabled}
									>
										<div class="flex h-4 w-4 items-center justify-center border border-[var(--void-6)] {isSelected ? 'bg-[var(--text)]' : ''}">
											{#if isSelected}
												<CheckIcon size={10} class="text-[var(--void-0)]" />
											{/if}
										</div>
										{entry}
									</button>
								{/each}
							</div>
						{/if}

						{#if pref.type === 'text'}
							<div class="mt-3">
								<input
									type="text"
									class="h-10 w-full border-b border-[var(--line)] bg-transparent px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--text-muted)] disabled:opacity-40"
									value={String(getCurrentValue(pref) ?? '')}
									disabled={!pref.enabled}
									oninput={(event) => handlePreferenceChange(pref.key, event.currentTarget.value)}
								/>
							</div>
						{/if}
					</div>
				{/each}

				{#if sourceSettingsData.preferences.length > 0}
					<div class="pt-4">
						<button
							type="button"
							class="flex w-full items-center gap-2 py-2 text-xs text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
							onclick={() => (advancedOpen = !advancedOpen)}
						>
							{#if advancedOpen}
								<CaretDownIcon size={12} />
							{:else}
								<CaretRightIcon size={12} />
							{/if}
							advanced
						</button>

						{#if advancedOpen}
							<div class="flex flex-col gap-3 pt-2" transition:slide={{ duration: 120 }}>
								<div class="py-3">
									<div class="flex flex-col gap-3">
										<div>
											<p class="text-xs text-[var(--text-soft)]">auth / storage import</p>
											<p class="mt-0.5 text-[11px] text-[var(--text-ghost)]">
												Replace hidden extension storage values. Leave empty and apply to clear all.
											</p>
										</div>

										<textarea
											class="min-h-24 w-full resize-y border-b border-[var(--line)] bg-transparent p-3 text-xs text-[var(--text)] outline-none focus:border-[var(--text-muted)]"
											placeholder="JSON object or key-value pairs"
											bind:value={authImportText}
										></textarea>

										<p class="text-[11px] text-[var(--text-ghost)]">
											{#if importedStoragePreferences.length > 0}
												{importedStoragePreferences.length} imported key{importedStoragePreferences.length === 1 ? '' : 's'} loaded
											{:else}
												no imported keys
											{/if}
										</p>

										{#if authImportError}
											<div class="bg-[var(--error-soft)] px-3 py-2 text-[11px] text-[var(--error)]">
												{authImportError}
											</div>
										{/if}

										{#if authImportSuccess}
											<div class="bg-[var(--success)]/10 px-3 py-2 text-[11px] text-[var(--success)]">
												{authImportSuccess}
											</div>
										{/if}

										<Button
											variant="ghost"
											size="sm"
											onclick={() => void importAuthStorage()}
											disabled={authImportSaving || (!authImportText.trim() && importedStoragePreferences.length === 0)}
											loading={authImportSaving}
										>
											apply
										</Button>
									</div>
								</div>
							</div>
						{/if}
					</div>
				{/if}

				{#if pendingPreferenceChanges.size > 0}
					<Button
						variant="solid"
						size="md"
						onclick={() => void saveSourceSettings()}
						disabled={sourceSettingsSaving}
						loading={sourceSettingsSaving}
						class="sticky bottom-0"
					>
						{$_('common.save')} ({pendingPreferenceChanges.size})
					</Button>
				{/if}
			</div>
		{/if}
	{/if}
</SlidePanel>
