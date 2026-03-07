<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { slide } from 'svelte/transition';

	import {
		listInstalledExtensions,
		listAvailableExtensions,
		listRepositoryChanges,
		installExtension,
		uninstallExtension,
		toggleSourceEnabled,
		toggleExtensionProxy,
		getSourcePreferences,
		updateSourcePreferences,
		type ExtensionResource,
		type RepoExtensionChangesResource,
		type RepoExtensionChangeResource,
		type RepoExtensionResource,
		type SourcePreferencesResolved,
		type SourcePreferenceUpdate
	} from '$lib/api/extensions';
	import { Button } from '$lib/elements/button';
	import { ConfirmDialog } from '$lib/elements/confirm-dialog';
	import { Input } from '$lib/elements/input';
	import { Icon } from '$lib/elements/icon';
	import { Switch } from '$lib/elements/switch';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { _ } from '$lib/i18n';
	import { panelOverlayOpen } from '$lib/stores/ui';
	import {
		contentLanguages,
		setKnownContentLanguages
	} from '$lib/stores/content-languages';
	import {
		normalizeContentLanguageCode,
		toMainContentLanguages
	} from '$lib/utils/content-languages';

	type TabValue = 'installed' | 'available' | 'updates';

	// ── Core state ──────────────────────────────────────────────────────────
	let installedExtensions = $state<ExtensionResource[]>([]);
	let availableExtensions = $state<RepoExtensionResource[]>([]);
	let repoChanges = $state<RepoExtensionChangesResource | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let activeTab = $state<TabValue>('installed');
	let repoChangesLoading = $state(false);
	let repoChangesError = $state<string | null>(null);

	// ── Search & filter ─────────────────────────────────────────────────────
	let searchQuery = $state('');
	const trimmedSearch = $derived(searchQuery.trim().toLowerCase());
	let selectedLang = $state<string | null>(null);

	// ── Extension detail (single expansion) ─────────────────────────────────
	let expandedPkg = $state<string | null>(null);

	// ── Action loading states ───────────────────────────────────────────────
	let installingPkg = $state<string | null>(null);
	let uninstallingPkg = $state<string | null>(null);
	let uninstallConfirmPkg = $state<string | null>(null);
	let togglingSourceId = $state<string | null>(null);
	let togglingProxyPkg = $state<string | null>(null);

	// ── Source settings panel ───────────────────────────────────────────────
	let sourceSettingsOpen = $state(false);
	let sourceSettingsLoading = $state(false);
	let sourceSettingsData = $state<SourcePreferencesResolved | null>(null);
	let sourceSettingsError = $state<string | null>(null);
	let sourceSettingsSaving = $state(false);
	let pendingPreferenceChanges = $state<Map<string, unknown>>(new Map());
	let advancedOpen = $state(false);

	// ── Auth import ─────────────────────────────────────────────────────────
	let authImportText = $state('');
	let authImportSaving = $state(false);
	let authImportError = $state<string | null>(null);
	let authImportSuccess = $state<string | null>(null);

	// ── Progressive rendering (available tab) ───────────────────────────────
	let renderLimit = $state(30);
	let sentinelEl = $state<HTMLDivElement | null>(null);

	const repoChangeItems = $derived(repoChanges?.changes ?? []);

	// ── Derived: filtered lists ─────────────────────────────────────────────
	const filteredInstalled = $derived.by(() => {
		if (!trimmedSearch) return installedExtensions;
		return installedExtensions.filter(
			(ext) =>
				ext.name.toLowerCase().includes(trimmedSearch) ||
				ext.lang.toLowerCase().includes(trimmedSearch) ||
				ext.sources.some(
					(s) =>
						s.name.toLowerCase().includes(trimmedSearch) ||
						s.lang.toLowerCase().includes(trimmedSearch)
				)
		);
	});

	const availableLangs = $derived.by(() => {
		const langs = new Set(availableExtensions.map((e) => e.lang.toLowerCase()));
		return ['all', ...Array.from(langs).filter((lang) => lang !== 'all').sort()];
	});

	const filteredAvailable = $derived.by(() => {
		let list = availableExtensions;
		if (selectedLang && selectedLang !== 'all') {
			list = list.filter((ext) => ext.lang.toLowerCase() === selectedLang);
		}
		if (trimmedSearch) {
			list = list.filter(
				(ext) =>
					ext.name.toLowerCase().includes(trimmedSearch) ||
					ext.lang.toLowerCase().includes(trimmedSearch) ||
					ext.pkg.toLowerCase().includes(trimmedSearch)
			);
		}
		return list;
	});

	const visibleAvailable = $derived(filteredAvailable.slice(0, renderLimit));

	const updatesLangs = $derived.by(() => {
		const langs = new Set(
			repoChangeItems
				.map((change) => (change.lang ?? '').toLowerCase())
				.filter((lang) => lang.length > 0)
		);
		return ['all', ...Array.from(langs).filter((lang) => lang !== 'all').sort()];
	});

	const filteredRepoChanges = $derived.by(() => {
		let list = repoChangeItems;
		if (selectedLang && selectedLang !== 'all') {
			list = list.filter((change) => (change.lang ?? '').toLowerCase() === selectedLang);
		}
		if (!trimmedSearch) return list;
		return list.filter((change) => {
			const haystack = [
				change.extension_name ?? '',
				change.name,
				change.renamed_to ?? '',
				change.extension_pkg ?? '',
				change.commit_message ?? '',
				change.lang ?? ''
			]
				.join(' ')
				.toLowerCase();
			return haystack.includes(trimmedSearch);
		});
	});

	// ── Helpers ─────────────────────────────────────────────────────────────
	function getFilteredSources(sources: ExtensionResource['sources']) {
		const langs = toMainContentLanguages($contentLanguages);
		if (langs.length === 0) return sources;
		const selected = new Set(langs);
		return sources.filter((s) => {
			const sourceLang = normalizeContentLanguageCode(s.lang);
			return sourceLang !== null && selected.has(sourceLang);
		});
	}

	function changeTitle(change: RepoExtensionChangeResource): string {
		return change.extension_name ?? change.name;
	}

	function changeStatusClass(status: RepoExtensionChangeResource['status']): string {
		if (status === 'updated') return 'text-[var(--success)]';
		if (status === 'added') return 'text-[var(--text-muted)]';
		if (status === 'removed') return 'text-[var(--error)]';
		return 'text-[var(--text-soft)]';
	}

	function formatChangeAge(committedAt: string): string {
		const date = new Date(committedAt);
		if (Number.isNaN(date.getTime())) return 'unknown';
		const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
		if (diffSec < 60) return `${diffSec}s ago`;
		if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
		if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
		return `${Math.floor(diffSec / 86400)}d ago`;
	}

	// ── Hide bottom nav when slide panel opens ─────────────────────────────
	$effect(() => {
		panelOverlayOpen.set(sourceSettingsOpen);
		return () => panelOverlayOpen.set(false);
	});

	// ── Core handlers ───────────────────────────────────────────────────────
	onMount(async () => {
		await Promise.all([loadExtensions(), loadRepoChanges()]);
	});

	async function loadExtensions() {
		loading = true;
		error = null;
		try {
			const [installed, available] = await Promise.all([
				listInstalledExtensions(),
				listAvailableExtensions().catch(() => [] as RepoExtensionResource[])
			]);
			installedExtensions = installed;
			availableExtensions = available.filter((ext) => !ext.installed);

			// Update known content languages from all sources
			const allLangs = [
				...installed.flatMap((e) => e.sources.map((s) => s.lang)),
				...available.map((e) => e.lang)
			];
			setKnownContentLanguages(allLangs);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load extensions';
		} finally {
			loading = false;
		}
	}

	async function loadRepoChanges() {
		repoChangesLoading = true;
		repoChangesError = null;
		try {
			repoChanges = await listRepositoryChanges({ days: 3, limit: 120 });
		} catch (e) {
			repoChangesError = e instanceof Error ? e.message : 'Failed to load repository changes';
		} finally {
			repoChangesLoading = false;
		}
	}

	async function handleInstall(pkg: string) {
		installingPkg = pkg;
		error = null;
		try {
			const installed = await installExtension(pkg);
			installedExtensions = [...installedExtensions, installed];
			availableExtensions = availableExtensions.filter((ext) => ext.pkg !== pkg);
			activeTab = 'installed';
			expandedPkg = installed.pkg;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to install extension';
		} finally {
			installingPkg = null;
		}
	}

	async function handleUninstall(pkg: string) {
		uninstallingPkg = pkg;
		error = null;
		try {
			await uninstallExtension(pkg);
			const ext = installedExtensions.find((e) => e.pkg === pkg);
			installedExtensions = installedExtensions.filter((e) => e.pkg !== pkg);
			if (expandedPkg === pkg) expandedPkg = null;
			if (ext) {
				availableExtensions = [
					...availableExtensions,
					{
						pkg: ext.pkg,
						name: ext.name,
						lang: ext.lang,
						version: ext.version,
						icon: ext.icon,
						nsfw: ext.nsfw,
						installed: false,
						sources_has_prefs: ext.sources_has_prefs
					}
				];
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to uninstall extension';
		} finally {
			uninstallingPkg = null;
		}
	}

	async function handleToggleSource(sourceId: string, enabled: boolean) {
		togglingSourceId = sourceId;
		error = null;
		try {
			await toggleSourceEnabled(sourceId, enabled);
			installedExtensions = installedExtensions.map((ext) => ({
				...ext,
				sources: ext.sources.map((s) => (s.id === sourceId ? { ...s, enabled } : s))
			}));
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to toggle source';
		} finally {
			togglingSourceId = null;
		}
	}

	async function handleToggleProxy(pkg: string, useProxy: boolean) {
		togglingProxyPkg = pkg;
		error = null;
		try {
			await toggleExtensionProxy(pkg, useProxy);
			installedExtensions = installedExtensions.map((ext) =>
				ext.pkg === pkg ? { ...ext, use_proxy: useProxy } : ext
			);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to toggle proxy';
		} finally {
			togglingProxyPkg = null;
		}
	}

	// ── Source settings panel ────────────────────────────────────────────────
	async function openSourceSettings(sourceId: string) {
		sourceSettingsOpen = true;
		sourceSettingsLoading = true;
		sourceSettingsError = null;
		sourceSettingsData = null;
		pendingPreferenceChanges = new SvelteMap();
		advancedOpen = false;
		try {
			const resolved = await getSourcePreferences(sourceId);
			sourceSettingsData = resolved;
			syncAuthImportTextFromImportedStorage(resolved);
		} catch (e) {
			sourceSettingsError = e instanceof Error ? e.message : 'Failed to load preferences';
		} finally {
			sourceSettingsLoading = false;
		}
	}

	function closeSourceSettings() {
		sourceSettingsOpen = false;
		sourceSettingsData = null;
		sourceSettingsError = null;
		pendingPreferenceChanges = new SvelteMap();
		advancedOpen = false;
		authImportText = '';
		authImportSaving = false;
		authImportError = null;
		authImportSuccess = null;
	}

	function handlePreferenceChange(key: string, value: unknown) {
		pendingPreferenceChanges.set(key, value);
		pendingPreferenceChanges = new SvelteMap(pendingPreferenceChanges);
	}

	async function saveSourceSettings() {
		if (!sourceSettingsData || pendingPreferenceChanges.size === 0) return;
		sourceSettingsSaving = true;
		sourceSettingsError = null;
		const updates: SourcePreferenceUpdate[] = Array.from(pendingPreferenceChanges.entries()).map(
			([key, value]) => ({ key, value, delete: false })
		);
		try {
			sourceSettingsData = await updateSourcePreferences(sourceSettingsData.source_id, updates);
			pendingPreferenceChanges = new SvelteMap();
		} catch (e) {
			sourceSettingsError = e instanceof Error ? e.message : 'Failed to save preferences';
		} finally {
			sourceSettingsSaving = false;
		}
	}

	function getCurrentValue(pref: NonNullable<typeof sourceSettingsData>['preferences'][number]) {
		if (pendingPreferenceChanges.has(pref.key)) return pendingPreferenceChanges.get(pref.key);
		return pref.current_value ?? pref.default_value;
	}

	const importedStoragePreferences = $derived.by(() => {
		if (!sourceSettingsData) return [];
		return sourceSettingsData.preferences.filter(isHiddenStoragePreference);
	});

	// ── Auth import parsing (preserved) ─────────────────────────────────────
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
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
				throw new Error('Top-level JSON must be an object.');
			return parsed as Record<string, unknown>;
		} catch {
			const loose = parseLooseKeyValueInput(trimmed);
			if (loose) return loose;
			throw new Error(
				'Unable to parse input. Expected JSON object or lines in format: key <json/value>.'
			);
		}
	}

	function buildLibGroupTokenStorePayload(
		raw: Record<string, unknown>
	): Record<string, unknown> {
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
		if (!tokenPayload || !authPayload)
			throw new Error(
				'Unable to find LibGroup auth payload. Expected object with token/auth fields.'
			);
		const userId = Number(authPayload.id);
		if (!Number.isFinite(userId) || userId <= 0) throw new Error('Invalid auth.id in payload.');
		const tokenType = String(tokenPayload.token_type ?? tokenPayload.tokenType ?? '').trim();
		const accessToken = String(
			tokenPayload.access_token ?? tokenPayload.accessToken ?? ''
		).trim();
		const expiresIn = Number(tokenPayload.expires_in ?? tokenPayload.expiresIn ?? 0);
		const timestamp = Number(tokenPayload.timestamp ?? Date.now());
		if (!tokenType || !accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0)
			throw new Error(
				'Invalid token payload. token_type, access_token, expires_in are required.'
			);
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
			for (const [k, v] of Object.entries(maybeTokenStore)) {
				out[k] = JSON.stringify(v);
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
		return sourceSettingsData.preferences
			.filter(isHiddenStoragePreference)
			.map((pref) => pref.key);
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
			const upserts: SourcePreferenceUpdate[] = Object.entries(mapped).map(([key, value]) => ({
				key,
				value,
				delete: false
			}));
			const existingKeys = getHiddenStorageKeys();
			if (existingKeys.length === 0 && upserts.length === 0)
				throw new Error('No imported keys yet. Paste JSON map to import.');
			const deletes: SourcePreferenceUpdate[] = existingKeys.map((key) => ({
				key,
				delete: true
			}));
			sourceSettingsData = await updateSourcePreferences(sourceSettingsData.source_id, [
				...deletes,
				...upserts
			]);
			syncAuthImportTextFromImportedStorage(sourceSettingsData);
			if (upserts.length === 0) {
				authImportSuccess = `Deleted ${deletes.length} imported key${deletes.length === 1 ? '' : 's'}.`;
			} else {
				authImportSuccess = `Replaced imported storage with ${upserts.length} key${upserts.length === 1 ? '' : 's'} (removed ${deletes.length}).`;
			}
		} catch (e) {
			authImportError =
				e instanceof Error ? e.message : 'Failed to import auth/storage values';
		} finally {
			authImportSaving = false;
		}
	}

	// ── Tab / UI helpers ────────────────────────────────────────────────────
	function switchTab(tab: TabValue) {
		activeTab = tab;
		searchQuery = '';
		selectedLang = null;
		expandedPkg = null;
		if (tab === 'updates' && repoChanges === null && !repoChangesLoading) {
			void loadRepoChanges();
		}
	}

	// Reset progressive render on filter change
	$effect(() => {
		void trimmedSearch;
		void selectedLang;
		renderLimit = 30;
	});

	// Progressive render observer
	$effect(() => {
		if (!sentinelEl) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting && renderLimit < filteredAvailable.length) {
					renderLimit += 30;
				}
			},
			{ rootMargin: '200px' }
		);
		observer.observe(sentinelEl);
		return () => observer.disconnect();
	});
</script>

<svelte:head>
	<title>{$_('nav.extensions')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-4">
	<!-- ── Header ───────────────────────────────────────────────────────── -->
	<div class="flex items-center gap-3">
		<h1 class="text-display text-xl text-[var(--text)] flex-1 tracking-tight">
			{$_('nav.extensions').toLowerCase()}
		</h1>
		<button
			type="button"
			class="flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
			onclick={() => Promise.all([loadExtensions(), loadRepoChanges()])}
			disabled={loading || repoChangesLoading}
		>
			<Icon
				name="refresh-cw"
				size={15}
				class={loading || repoChangesLoading ? 'animate-spin' : ''}
			/>
		</button>
	</div>

	<!-- ── Tab bar ──────────────────────────────────────────────────────── -->
	<div class="flex gap-6">
		{#each ['installed', 'available', 'updates'] as tab (tab)}
			{@const isActive = activeTab === tab}
			{@const count = tab === 'installed'
				? installedExtensions.length
				: tab === 'available'
					? availableExtensions.length
					: repoChangeItems.length}
			<button
				type="button"
				class="relative pb-2 text-xs font-medium uppercase tracking-wide transition-colors
					{isActive
					? 'text-[var(--text)]'
					: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
				onclick={() => switchTab(tab as TabValue)}
			>
				<span class="flex items-center gap-1.5">
					{$_(`extensions.${tab}`).toLowerCase()}
					{#if count > 0}
						<span
							class="text-[10px] {isActive ? 'text-[var(--text-muted)]' : 'text-[var(--void-7)]'}"
							>{count}</span
						>
					{/if}
				</span>
				{#if isActive}
					<span class="absolute inset-x-0 bottom-0 h-px bg-[var(--text-muted)]"></span>
				{/if}
			</button>
		{/each}
	</div>

	<!-- ── Search ───────────────────────────────────────────────────────── -->
	<div class="relative">
		<Icon
			name="search"
			size={13}
			class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-ghost)]"
		/>
		<input
			type="search"
			placeholder={activeTab === 'installed'
				? 'search extensions or sources...'
				: activeTab === 'updates'
					? $_('extensions.updatesSearchPlaceholder')
					: $_('extensions.searchPlaceholder')}
			bind:value={searchQuery}
			class="w-full h-9 pl-8 pr-8 bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--text-ghost)] border-b border-[var(--line-soft)] transition-colors focus:border-[var(--void-6)] focus:outline-none"
		/>
		{#if searchQuery}
			<button
				type="button"
				class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-ghost)] hover:text-[var(--text-muted)] transition-colors"
				onclick={() => (searchQuery = '')}
			>
				<Icon name="x" size={13} />
			</button>
		{/if}
	</div>

	<!-- ── Language filter chips (available tab) ────────────────────────── -->
	{#if activeTab === 'available' && availableLangs.length > 2}
		<div class="flex items-center gap-0.5 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
			{#each availableLangs.slice(0, 24) as lang (lang)}
				{@const isActive = (lang === 'all' && !selectedLang) || selectedLang === lang}
				<button
					type="button"
					class="shrink-0 h-7 px-2.5 text-[10px] uppercase tracking-wider transition-colors
						{isActive
						? 'text-[var(--text)] bg-[var(--void-3)]'
						: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
					onclick={() => (selectedLang = lang === 'all' ? null : lang)}
				>
					{lang}
				</button>
			{/each}
		</div>
	{:else if activeTab === 'updates' && updatesLangs.length > 2}
		<div class="flex items-center gap-0.5 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
			{#each updatesLangs.slice(0, 24) as lang (lang)}
				{@const isActive = (lang === 'all' && !selectedLang) || selectedLang === lang}
				<button
					type="button"
					class="shrink-0 h-7 px-2.5 text-[10px] uppercase tracking-wider transition-colors
						{isActive
						? 'text-[var(--text)] bg-[var(--void-3)]'
						: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
					onclick={() => (selectedLang = lang === 'all' ? null : lang)}
				>
					{lang}
				</button>
			{/each}
		</div>
	{/if}

	<!-- ── Error ────────────────────────────────────────────────────────── -->
	{#if error}
		<div class="bg-[var(--error-soft)] px-4 py-3 text-xs text-[var(--error)]">
			{error}
		</div>
	{/if}

	<!-- ── Loading ──────────────────────────────────────────────────────── -->
	{#if loading}
		<div class="flex flex-col gap-4 pt-4">
			{#each Array(3) as _, i (i)}
				<div class="px-1 opacity-0 animate-slide-up" style="animation-delay: {i * 80}ms; animation-fill-mode: forwards">
					<div class="flex items-center gap-4">
						<div
							class="h-11 w-11 shrink-0 animate-pulse bg-[var(--void-3)]"
							style="animation-delay: {i * 60}ms"
						></div>
						<div class="flex-1 flex flex-col gap-2.5">
							<div
								class="h-3 w-32 animate-pulse bg-[var(--void-3)]"
								style="animation-delay: {i * 60}ms"
							></div>
							<div
								class="h-2 w-16 animate-pulse bg-[var(--void-2)]"
								style="animation-delay: {i * 60 + 40}ms"
							></div>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- ════════════════════════════════════════════════════════════════
		     INSTALLED TAB
		     ════════════════════════════════════════════════════════════════ -->
	{:else if activeTab === 'installed'}
		{#if installedExtensions.length === 0}
			<div class="flex flex-col items-center gap-5 py-20 text-center">
				<div
					class="flex h-16 w-16 items-center justify-center bg-[var(--void-2)]"
				>
					<Icon name="puzzle" size={24} class="text-[var(--text-ghost)]" />
				</div>
				<div>
					<p class="text-sm text-[var(--text)]">{$_('extensions.noExtensions')}</p>
					<p class="mt-1.5 text-xs text-[var(--text-ghost)]">
						{$_('extensions.installFromRepo')}
					</p>
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
					{@const enabledCount = ext.sources.filter((s) => s.enabled).length}
					{@const isUninstalling = uninstallingPkg === ext.pkg}
					{@const isTogglingProxy = togglingProxyPkg === ext.pkg}

					<div
						class="transition-all duration-200"
						style="animation: slide-up var(--duration-slow) var(--ease-out) forwards; animation-delay: {Math.min(i * 30, 300)}ms; opacity: 0"
					>
						<!-- Card header (clickable to expand) -->
						<button
							type="button"
							class="flex w-full items-center gap-4 px-1 py-4 text-left transition-colors hover:bg-[var(--void-1)]
								{isExpanded ? '' : 'border-b border-[var(--line-soft)]'}"
							onclick={() => (expandedPkg = isExpanded ? null : ext.pkg)}
						>
							<!-- Icon -->
							{#if ext.icon}
								<img
									src={ext.icon}
									alt=""
									class="h-11 w-11 shrink-0 object-contain"
								/>
							{:else}
								<div
									class="flex h-11 w-11 shrink-0 items-center justify-center bg-[var(--void-2)]"
								>
									<Icon
										name="puzzle"
										size={20}
										class="text-[var(--text-ghost)]"
									/>
								</div>
							{/if}

							<!-- Name + meta -->
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="text-[15px] text-[var(--text)] truncate leading-tight"
										>{ext.name}</span
									>
									{#if ext.nsfw}
										<span
											class="text-[10px] text-[var(--text-ghost)] shrink-0"
											>18+</span
										>
									{/if}
								</div>
								<p class="text-[11px] text-[var(--text-ghost)] mt-1">
									v{ext.version} · {enabledCount} active
								</p>
							</div>

							<!-- Chevron -->
							<Icon
								name={isExpanded ? 'chevron-down' : 'chevron-right'}
								size={14}
								class="text-[var(--text-ghost)] shrink-0"
							/>
						</button>

						<!-- ── Expanded detail ─────────────────────────────────── -->
						{#if isExpanded}
							<div
								transition:slide={{ duration: 150 }}
							>
								<div class="flex flex-col gap-6 px-1 pt-2 pb-5 border-b border-[var(--line-soft)]">
									<!-- Sources (filtered by global content language preferences) -->
									<div class="flex flex-col gap-1">
										{#if getFilteredSources(ext.sources).length === 0}
											<p class="text-xs text-[var(--text-ghost)] py-1">
												no sources match your language preferences
											</p>
										{:else}
											{#each getFilteredSources(ext.sources) as source (source.id)}
												{@const isToggling =
													togglingSourceId === source.id}
												<div
													class="flex items-center gap-3 py-2.5 transition-colors"
												>
													<div class="min-w-0 flex-1">
														<div class="flex items-center gap-2">
															<span
																class="text-xs text-[var(--text-soft)] truncate"
																>{source.name}</span
															>
															<span
																class="text-[10px] uppercase tracking-wide text-[var(--text-ghost)] shrink-0"
																>{source.lang}</span
															>
														</div>
													</div>
													<button
														type="button"
														class="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text)] hover:bg-[var(--void-3)]"
														onclick={() =>
															openSourceSettings(source.id)}
														title={$_(
															'extensions.sourceSettings'
														)}
													>
														<Icon name="settings" size={14} />
													</button>
													<Switch
														checked={source.enabled}
														disabled={isToggling}
														loading={isToggling}
														onCheckedChange={(enabled) =>
															void handleToggleSource(source.id, enabled)}
													/>
												</div>
											{/each}
										{/if}
									</div>

									<!-- Proxy toggle -->
									<div class="flex items-center gap-3">
										<span class="flex-1 text-xs text-[var(--text-muted)]"
											>proxy</span
										>
										<Switch
											checked={ext.use_proxy}
											disabled={isTogglingProxy}
											loading={isTogglingProxy}
											onCheckedChange={(enabled) =>
												void handleToggleProxy(ext.pkg, enabled)}
										/>
									</div>

									<!-- Uninstall -->
									<button
										type="button"
										class="self-start text-[11px] text-[var(--text-ghost)] transition-colors hover:text-[var(--error)]"
										onclick={() => (uninstallConfirmPkg = ext.pkg)}
										disabled={isUninstalling}
									>
										{#if isUninstalling}
											<Icon
												name="loader"
												size={12}
												class="animate-spin inline-block mr-1"
											/>
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

		<!-- ════════════════════════════════════════════════════════════════
		     UPDATES TAB
		     ════════════════════════════════════════════════════════════════ -->
	{:else if activeTab === 'updates'}
		{#if repoChangesLoading && repoChangeItems.length === 0}
			<div class="flex items-center justify-center py-20">
				<Icon name="loader" size={16} class="animate-spin text-[var(--text-ghost)]" />
			</div>
		{:else if repoChangesError}
			<div class="bg-[var(--error-soft)] px-4 py-3 text-xs text-[var(--error)]">
				{repoChangesError}
			</div>
		{:else if repoChanges?.error}
			<div class="bg-[var(--error-soft)] px-4 py-3 text-xs text-[var(--error)]">
				{repoChanges.error}
			</div>
		{:else if repoChangeItems.length === 0}
			<div class="flex flex-col items-center gap-5 py-20 text-center">
				<div class="flex h-16 w-16 items-center justify-center bg-[var(--void-2)]">
					<Icon name="git-commit-horizontal" size={24} class="text-[var(--text-ghost)]" />
				</div>
				<div>
					<p class="text-sm text-[var(--text)]">{$_('extensions.noRecentUpdates')}</p>
					<p class="mt-1.5 text-xs text-[var(--text-ghost)]">
						{$_('extensions.noRecentUpdatesDescription')}
					</p>
				</div>
			</div>
		{:else if filteredRepoChanges.length === 0}
			<div class="py-12 text-center">
				<p class="text-xs text-[var(--text-muted)]">{$_('common.noResults')}</p>
			</div>
		{:else}
			<div class="flex flex-col gap-1">
				{#if repoChanges}
					<p class="px-1 text-[10px] uppercase tracking-wider text-[var(--text-ghost)]">
						{$_('extensions.updatesWindow', { values: { count: filteredRepoChanges.length } })}
					</p>
				{/if}
				{#each filteredRepoChanges as change, i (`${change.commit_sha}:${change.extension_pkg ?? change.name}:${i}`)}
					<div
						class="flex items-start gap-4 border-b border-[var(--line-soft)] px-1 py-3.5"
						style="animation: slide-up var(--duration-slow) var(--ease-out) forwards; animation-delay: {Math.min(i * 20, 300)}ms; opacity: 0"
					>
						{#if change.icon}
							<img src={change.icon} alt="" class="h-10 w-10 shrink-0 object-contain" />
						{:else}
							<div class="flex h-10 w-10 shrink-0 items-center justify-center bg-[var(--void-2)]">
								<Icon name="puzzle" size={16} class="text-[var(--text-ghost)]" />
							</div>
						{/if}
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate text-[15px] leading-tight text-[var(--text)]">
									{changeTitle(change)}
								</span>
								<span class="text-[10px] uppercase tracking-wider text-[var(--text-ghost)] shrink-0">
									{change.lang ?? '??'}
								</span>
								<span class="text-[10px] uppercase tracking-wider shrink-0 {changeStatusClass(change.status)}">
									{change.status}
								</span>
								{#if change.installed}
									<span class="text-[10px] uppercase tracking-wider text-[var(--text-muted)] shrink-0">
										installed
									</span>
								{/if}
							</div>
							<p class="mt-1 text-[11px] text-[var(--text-ghost)]">
								{#if change.status === 'updated' && change.version && change.new_version}
									v{change.version} -> v{change.new_version}
								{:else if change.status === 'renamed' && change.renamed_to}
									{change.name} -> {change.renamed_to}
								{:else if change.new_version}
									v{change.new_version}
								{:else if change.version}
									v{change.version}
								{:else}
									{change.extension_pkg ?? change.commit_sha.slice(0, 7)}
								{/if}
							</p>
							<div class="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--text-ghost)]">
								<span>{formatChangeAge(change.committed_at)}</span>
								<span class="opacity-30">·</span>
								<span>{change.commit_sha.slice(0, 7)}</span>
								{#if change.commit_message}
									<span class="opacity-30">·</span>
									<span class="line-clamp-1">{change.commit_message}</span>
								{/if}
							</div>
						</div>
						{#if change.extension_pkg && change.known && !change.installed && change.status !== 'removed'}
							<button
								type="button"
								class="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text)] disabled:pointer-events-none disabled:opacity-40"
								onclick={() => handleInstall(change.extension_pkg!)}
								disabled={installingPkg === change.extension_pkg}
								title={$_('extensions.install')}
							>
								{#if installingPkg === change.extension_pkg}
									<Icon name="loader" size={14} class="animate-spin" />
								{:else}
									<Icon name="plus" size={16} />
								{/if}
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<!-- ════════════════════════════════════════════════════════════════
		     AVAILABLE TAB
		     ════════════════════════════════════════════════════════════════ -->
	{:else}
		{#if availableExtensions.length === 0}
			<div class="flex flex-col items-center gap-5 py-20 text-center">
				<div
					class="flex h-16 w-16 items-center justify-center bg-[var(--void-2)]"
				>
					<Icon name="check" size={24} class="text-[var(--text-muted)]" />
				</div>
				<div>
					<p class="text-sm text-[var(--text)]">{$_('extensions.allInstalled')}</p>
					<p class="mt-1.5 text-xs text-[var(--text-ghost)]">
						{$_('extensions.noRepoConfigured')}
					</p>
				</div>
			</div>
		{:else if filteredAvailable.length === 0}
			<div class="py-12 text-center">
				<p class="text-xs text-[var(--text-muted)]">{$_('common.noResults')}</p>
			</div>
		{:else}
			<!-- Result count -->
			<p class="text-[10px] text-[var(--text-ghost)] uppercase tracking-wider">
				{filteredAvailable.length} extensions
			</p>

			<div class="flex flex-col">
				{#each visibleAvailable as ext, i (ext.pkg)}
					{@const isInstalling = installingPkg === ext.pkg}
					<div
						class="flex items-center gap-4 border-b border-[var(--line-soft)] px-1 py-3.5 transition-colors hover:bg-[var(--void-1)]"
						style="animation: slide-up var(--duration-slow) var(--ease-out) forwards; animation-delay: {Math.min(i * 20, 400)}ms; opacity: 0"
					>
						{#if ext.icon}
							<img
								src={ext.icon}
								alt=""
								class="h-10 w-10 shrink-0 object-contain"
							/>
						{:else}
							<div
								class="flex h-10 w-10 shrink-0 items-center justify-center bg-[var(--void-2)]"
							>
								<Icon name="puzzle" size={16} class="text-[var(--text-ghost)]" />
							</div>
						{/if}
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="text-[15px] text-[var(--text)] truncate leading-tight">{ext.name}</span>
								<span
									class="text-[10px] uppercase tracking-wider text-[var(--text-ghost)] shrink-0"
									>{ext.lang}</span
								>
								{#if ext.nsfw}
									<span
										class="text-[10px] text-[var(--text-ghost)] shrink-0"
										>18+</span
									>
								{/if}
							</div>
							<p class="text-[11px] text-[var(--text-ghost)]">v{ext.version}</p>
						</div>
						<button
							type="button"
							class="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text)] disabled:pointer-events-none disabled:opacity-40"
							onclick={() => handleInstall(ext.pkg)}
							disabled={isInstalling}
							title={$_('extensions.install')}
						>
							{#if isInstalling}
								<Icon name="loader" size={14} class="animate-spin" />
							{:else}
								<Icon name="plus" size={16} />
							{/if}
						</button>
					</div>
				{/each}
			</div>

			<!-- Progressive render sentinel -->
			{#if visibleAvailable.length < filteredAvailable.length}
				<div bind:this={sentinelEl} class="flex justify-center py-4">
					<Icon name="loader" size={16} class="animate-spin text-[var(--text-ghost)]" />
				</div>
			{/if}
		{/if}
	{/if}
</div>

<!-- ════════════════════════════════════════════════════════════════════════
     Source Settings Panel
     ════════════════════════════════════════════════════════════════════════ -->
<SlidePanel
	open={sourceSettingsOpen}
	title={sourceSettingsData
		? `${sourceSettingsData.name} settings`
		: $_('extensions.sourceSettings')}
	onclose={closeSourceSettings}
>
	{#if sourceSettingsLoading}
		<div class="flex flex-col items-center gap-4 py-16">
			<Icon name="loader" size={20} class="text-[var(--text-muted)] animate-spin" />
			<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
		</div>
	{:else if sourceSettingsError}
		<div
			class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-4 py-3 text-xs text-[var(--error)]"
		>
			{sourceSettingsError}
		</div>
	{:else if sourceSettingsData}
		{@const visiblePrefs = sourceSettingsData.preferences.filter((p) => p.visible)}
		{@const hasAnyPrefs =
			visiblePrefs.length > 0 || importedStoragePreferences.length > 0}

		{#if !hasAnyPrefs}
			<div class="flex flex-col items-center gap-4 py-16 text-center">
				<Icon name="settings" size={28} class="text-[var(--text-ghost)]" />
				<p class="text-xs text-[var(--text-ghost)]">
					{$_('extensions.noPreferences')}
				</p>
			</div>
		{:else}
			<div class="flex flex-col gap-4">
				<!-- Visible preferences -->
				{#each visiblePrefs as pref (pref.key)}
					<div class="py-4 border-b border-[var(--line-soft)]">
						<div class="flex items-start justify-between gap-3">
							<div class="flex-1">
								<p class="text-sm text-[var(--text)]">{pref.title}</p>
								{#if pref.summary}
									<p class="mt-0.5 text-xs text-[var(--text-ghost)]">
										{pref.summary}
									</p>
								{/if}
							</div>
							{#if pref.type === 'toggle'}
								{@const val = getCurrentValue(pref) as boolean}
								<Switch
									checked={val}
									disabled={!pref.enabled}
									onCheckedChange={(enabled) =>
										handlePreferenceChange(pref.key, enabled)}
								/>
							{/if}
						</div>

						{#if pref.type === 'list' && pref.entries && pref.entry_values}
							{@const val = getCurrentValue(pref) as string}
							<div class="mt-3 flex flex-col gap-1">
								{#each pref.entries as entry, i (entry)}
									{@const entryVal = pref.entry_values?.[i] ?? entry}
									<button
										type="button"
										class="flex items-center gap-2 px-3 py-2.5 text-xs transition-colors
											{val === entryVal
											? 'bg-[var(--void-3)] text-[var(--text)]'
											: 'text-[var(--text-muted)] hover:bg-[var(--void-2)]'}"
										onclick={() =>
											handlePreferenceChange(pref.key, entryVal)}
										disabled={!pref.enabled}
									>
										<div
											class="h-3 w-3 border border-[var(--void-6)] {val ===
											entryVal
												? 'bg-[var(--text)]'
												: ''}"
										></div>
										{entry}
									</button>
								{/each}
							</div>
						{/if}

						{#if pref.type === 'multi_select' && pref.entries && pref.entry_values}
							{@const val = (getCurrentValue(pref) as string[]) ?? []}
							<div class="mt-3 flex flex-col gap-1">
								{#each pref.entries as entry, i (entry)}
									{@const entryVal = pref.entry_values?.[i] ?? entry}
									{@const isSelected = val.includes(entryVal)}
									<button
										type="button"
										class="flex items-center gap-2 px-3 py-2.5 text-xs transition-colors
											{isSelected
											? 'bg-[var(--void-3)] text-[var(--text)]'
											: 'text-[var(--text-muted)] hover:bg-[var(--void-2)]'}"
										onclick={() => {
											const newVal = isSelected
												? val.filter((v) => v !== entryVal)
												: [...val, entryVal];
											handlePreferenceChange(pref.key, newVal);
										}}
										disabled={!pref.enabled}
									>
										<div
											class="flex h-4 w-4 items-center justify-center border border-[var(--void-6)] {isSelected
												? 'bg-[var(--text)]'
												: ''}"
										>
											{#if isSelected}
												<Icon
													name="check"
													size={10}
													class="text-[var(--void-0)]"
												/>
											{/if}
										</div>
										{entry}
									</button>
								{/each}
							</div>
						{/if}

						{#if pref.type === 'text'}
							{@const val = (getCurrentValue(pref) as string) ?? ''}
							<div class="mt-3">
								<Input
									type="text"
									value={val}
									oninput={(e) =>
										handlePreferenceChange(
											pref.key,
											e.currentTarget.value
										)}
									disabled={!pref.enabled}
								/>
							</div>
						{/if}
					</div>
				{/each}

				<!-- Advanced section (collapsed) -->
				{#if sourceSettingsData.preferences.length > 0}
					<div class="pt-4">
						<button
							type="button"
							class="flex w-full items-center gap-2 py-2 text-xs text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
							onclick={() => (advancedOpen = !advancedOpen)}
						>
							<Icon
								name={advancedOpen ? 'chevron-down' : 'chevron-right'}
								size={12}
							/>
							advanced
						</button>

						{#if advancedOpen}
							<div
								class="flex flex-col gap-3 pt-2"
								transition:slide={{ duration: 120 }}
							>
								<div class="py-3">
									<div class="flex flex-col gap-3">
										<div>
											<p class="text-xs text-[var(--text-soft)]">
												auth / storage import
											</p>
											<p
												class="mt-0.5 text-[11px] text-[var(--text-ghost)]"
											>
												Replace hidden extension storage values. Leave
												empty and apply to clear all.
											</p>
										</div>

										<textarea
											class="min-h-24 w-full border-b border-[var(--line)] bg-transparent p-3 text-xs text-[var(--text)] outline-none focus:border-[var(--text-muted)] resize-y"
											placeholder="JSON object or key-value pairs"
											bind:value={authImportText}
										></textarea>

										<p class="text-[11px] text-[var(--text-ghost)]">
											{#if importedStoragePreferences.length > 0}
												{importedStoragePreferences.length} imported key{importedStoragePreferences.length ===
												1
													? ''
													: 's'} loaded
											{:else}
												no imported keys
											{/if}
										</p>

										{#if authImportError}
											<div
												class="bg-[var(--error-soft)] px-3 py-2 text-[11px] text-[var(--error)]"
											>
												{authImportError}
											</div>
										{/if}
										{#if authImportSuccess}
											<div
												class="bg-[var(--success)]/10 px-3 py-2 text-[11px] text-[var(--success)]"
											>
												{authImportSuccess}
											</div>
										{/if}

										<Button
											variant="ghost"
											size="sm"
											onclick={importAuthStorage}
											disabled={authImportSaving ||
												(!authImportText.trim() &&
													importedStoragePreferences.length === 0)}
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

				<!-- Save button -->
				{#if pendingPreferenceChanges.size > 0}
					<Button
						variant="solid"
						size="md"
						onclick={saveSourceSettings}
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


<ConfirmDialog
	open={uninstallConfirmPkg !== null}
	title="Uninstall extension"
	description="This will remove the extension and all its sources. This action cannot be undone."
	confirmLabel="uninstall"
	variant="danger"
	loading={uninstallingPkg !== null}
	onConfirm={async () => {
		if (uninstallConfirmPkg !== null) {
			const pkg = uninstallConfirmPkg;
			uninstallConfirmPkg = null;
			await handleUninstall(pkg);
		}
	}}
	onCancel={() => (uninstallConfirmPkg = null)}
/>
