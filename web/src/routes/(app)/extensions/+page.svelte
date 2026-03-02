<script lang="ts">
	import { onMount } from 'svelte';

	import {
		listInstalledExtensions,
		listAvailableExtensions,
		installExtension,
		uninstallExtension,
		toggleSourceEnabled,
		toggleExtensionProxy,
		getSourcePreferences,
		updateSourcePreferences,
		type ExtensionResource,
		type RepoExtensionResource,
		type SourcePreferencesResolved,
		type SourcePreferenceUpdate
	} from '$lib/api/extensions';
	import { Button } from '$lib/elements/button';
	import { Input } from '$lib/elements/input';
	import { Icon } from '$lib/elements/icon';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { _ } from '$lib/i18n';

	type TabValue = 'installed' | 'available';

	let installedExtensions = $state<ExtensionResource[]>([]);
	let availableExtensions = $state<RepoExtensionResource[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let activeTab = $state<TabValue>('installed');
	let installingPkg = $state<string | null>(null);
	let uninstallingPkg = $state<string | null>(null);
	let togglingSourceId = $state<string | null>(null);
	let togglingProxyPkg = $state<string | null>(null);
	let expandedExtensions = $state<Set<string>>(new Set());

	// Search — shared across tabs
	let searchQuery = $state('');
	const trimmedSearch = $derived(searchQuery.trim().toLowerCase());

	// Language filter for available extensions
	let selectedLang = $state<string | null>(null);

	// Source settings panel
	let sourceSettingsOpen = $state(false);
	let sourceSettingsLoading = $state(false);
	let sourceSettingsData = $state<SourcePreferencesResolved | null>(null);
	let sourceSettingsError = $state<string | null>(null);
	let sourceSettingsSaving = $state(false);
	let pendingPreferenceChanges = $state<Map<string, unknown>>(new Map());
	let authImportText = $state('');
	let authImportSaving = $state(false);
	let authImportError = $state<string | null>(null);
	let authImportSuccess = $state<string | null>(null);

	// Filtered installed — matches extension name OR any source name/lang
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

	// All unique languages in available extensions (sorted)
	const availableLangs = $derived.by(() => {
		const langs = new Set(availableExtensions.map((e) => e.lang.toLowerCase()));
		return ['all', ...Array.from(langs).sort()];
	});

	// Filtered available — by search + language chip
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

	onMount(async () => {
		await loadExtensions();
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
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load extensions';
		} finally {
			loading = false;
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

	async function openSourceSettings(sourceId: string) {
		sourceSettingsOpen = true;
		sourceSettingsLoading = true;
		sourceSettingsError = null;
		sourceSettingsData = null;
		pendingPreferenceChanges = new Map();
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
		pendingPreferenceChanges = new Map();
		authImportText = '';
		authImportSaving = false;
		authImportError = null;
		authImportSuccess = null;
	}

	function handlePreferenceChange(key: string, value: unknown) {
		pendingPreferenceChanges.set(key, value);
		pendingPreferenceChanges = new Map(pendingPreferenceChanges);
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
		if (!trimmed) {
			throw new Error('Paste JSON or key-value storage dump first.');
		}

		try {
			const parsed = JSON.parse(trimmed);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw new Error('Top-level JSON must be an object.');
			}
			return parsed as Record<string, unknown>;
		} catch {
			const loose = parseLooseKeyValueInput(trimmed);
			if (loose) return loose;
			throw new Error('Unable to parse input. Expected JSON object or lines in format: key <json/value>.');
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
			throw new Error('Unable to find LibGroup auth payload. Expected object with token/auth fields.');
		}

		const userId = Number(authPayload.id);
		if (!Number.isFinite(userId) || userId <= 0) {
			throw new Error('Invalid auth.id in payload.');
		}

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

		// Generic mode convenience:
		// if user pasted browser localStorage auth payload ("auth", or "token"+"auth"),
		// auto-generate LibGroup TokenStore entry required by HentaiLib/MangaLib sources.
		try {
			const maybeTokenStore = buildLibGroupTokenStorePayload(raw);
			for (const [k, v] of Object.entries(maybeTokenStore)) {
				out[k] = JSON.stringify(v);
			}
		} catch {
			// Ignore when input is not LibGroup-style auth payload.
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

			const upserts: SourcePreferenceUpdate[] = Object.entries(mapped).map(([key, value]) => ({
				key,
				value
			}));
			const existingKeys = getHiddenStorageKeys();
			if (existingKeys.length === 0 && upserts.length === 0) {
				throw new Error('No imported keys yet. Paste JSON map to import.');
			}
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
			authImportError = e instanceof Error ? e.message : 'Failed to import auth/storage values';
		} finally {
			authImportSaving = false;
		}
	}

	async function saveSourceSettings() {
		if (!sourceSettingsData || pendingPreferenceChanges.size === 0) return;
		sourceSettingsSaving = true;
		sourceSettingsError = null;
		const updates: SourcePreferenceUpdate[] = Array.from(pendingPreferenceChanges.entries()).map(
			([key, value]) => ({ key, value })
		);
		try {
			sourceSettingsData = await updateSourcePreferences(sourceSettingsData.source_id, updates);
			pendingPreferenceChanges = new Map();
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

	function switchTab(tab: TabValue) {
		activeTab = tab;
		searchQuery = '';
		selectedLang = null;
	}

	function toggleExtensionExpanded(pkg: string) {
		const next = new Set(expandedExtensions);
		if (next.has(pkg)) next.delete(pkg);
		else next.add(pkg);
		expandedExtensions = next;
	}
</script>

<svelte:head>
	<title>{$_('nav.extensions')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-3">
	<!-- Header -->
	<div class="flex items-center gap-2">
		<h1 class="text-display text-xl text-[var(--text)] flex-1">{$_('nav.extensions').toLowerCase()}</h1>
		<button
			type="button"
			class="flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)] hover:bg-[var(--void-3)]"
			onclick={() => loadExtensions()}
			disabled={loading}
			title="Refresh"
		>
			<Icon name="refresh-cw" size={15} class={loading ? 'animate-spin' : ''} />
		</button>
	</div>

	<!-- Tabs -->
	<div class="flex gap-1">
		<button
			type="button"
			class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors {activeTab === 'installed'
				? 'bg-[var(--void-4)] text-[var(--text)]'
				: 'text-[var(--text-ghost)] hover:bg-[var(--void-3)] hover:text-[var(--text-muted)]'}"
			onclick={() => switchTab('installed')}
		>
			{$_('extensions.installed')}
			{#if installedExtensions.length > 0}
				<span class="text-[10px] {activeTab === 'installed' ? 'text-[var(--text-muted)]' : 'text-[var(--void-6)]'}">{installedExtensions.length}</span>
			{/if}
		</button>
		<button
			type="button"
			class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors {activeTab === 'available'
				? 'bg-[var(--void-4)] text-[var(--text)]'
				: 'text-[var(--text-ghost)] hover:bg-[var(--void-3)] hover:text-[var(--text-muted)]'}"
			onclick={() => switchTab('available')}
		>
			{$_('extensions.available')}
			{#if availableExtensions.length > 0}
				<span class="text-[10px] {activeTab === 'available' ? 'text-[var(--text-muted)]' : 'text-[var(--void-6)]'}">{availableExtensions.length}</span>
			{/if}
		</button>
	</div>

	<!-- Search — always visible -->
	<div class="relative">
		<Icon
			name="search"
			size={14}
			class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-ghost)]"
		/>
		<Input
			type="search"
			placeholder={activeTab === 'installed' ? 'search extensions or sources...' : $_('extensions.searchPlaceholder')}
			bind:value={searchQuery}
			class="pl-9 h-9 text-sm"
		/>
		{#if searchQuery}
			<button
				type="button"
				class="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-ghost)] hover:text-[var(--text-muted)] transition-colors"
				onclick={() => (searchQuery = '')}
			>
				<Icon name="x" size={14} />
			</button>
		{/if}
	</div>

	<!-- Language filter chips (available tab only) -->
	{#if activeTab === 'available' && availableLangs.length > 2}
		<div class="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar">
			{#each availableLangs.slice(0, 20) as lang}
				<button
					type="button"
					class="shrink-0 px-2.5 py-1 text-xs uppercase tracking-wide transition-colors {
						(lang === 'all' && !selectedLang) || selectedLang === lang
							? 'bg-[var(--void-3)] border border-[var(--line)] text-[var(--text)]'
							: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'
					}"
					onclick={() => (selectedLang = lang === 'all' ? null : lang)}
				>
					{lang}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Error -->
	{#if error}
		<div class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-4 py-3 text-sm text-[var(--error)]">
			{error}
		</div>
	{/if}

	<!-- Loading -->
	{#if loading}
		<div class="flex flex-col gap-2">
			{#each Array(3) as _, i}
				<div class="border border-[var(--line)] bg-[var(--void-2)] p-4">
					<div class="flex items-center gap-3">
						<div class="h-10 w-10 animate-pulse bg-[var(--void-4)]" style="animation-delay: {i * 60}ms"></div>
						<div class="flex-1 flex flex-col gap-2">
							<div class="h-3 w-32 animate-pulse bg-[var(--void-4)]" style="animation-delay: {i * 60}ms"></div>
							<div class="h-2.5 w-20 animate-pulse bg-[var(--void-5)]" style="animation-delay: {i * 60 + 30}ms"></div>
						</div>
					</div>
				</div>
			{/each}
		</div>

	{:else if activeTab === 'installed'}
		<!-- ── INSTALLED TAB ── -->
		{#if installedExtensions.length === 0}
			<div class="flex flex-col items-center gap-4 py-16 text-center">
				<div class="flex h-16 w-16 items-center justify-center border border-[var(--line)] bg-[var(--void-3)]">
					<Icon name="puzzle" size={24} class="text-[var(--text-ghost)]" />
				</div>
				<div>
					<p class="text-[var(--text)]">{$_('extensions.noExtensions')}</p>
					<p class="mt-1 text-sm text-[var(--text-ghost)]">{$_('extensions.installFromRepo')}</p>
				</div>
				<Button variant="outline" onclick={() => switchTab('available')}>
					{$_('extensions.browseAvailable')}
				</Button>
			</div>
		{:else if filteredInstalled.length === 0}
			<div class="py-8 text-center">
				<p class="text-sm text-[var(--text-muted)]">{$_('common.noResults')}</p>
			</div>
		{:else}
			<div class="flex flex-col gap-0 border border-[var(--line)]">
				{#each filteredInstalled as ext (ext.pkg)}
					{@const isUninstalling = uninstallingPkg === ext.pkg}
					{@const isTogglingProxy = togglingProxyPkg === ext.pkg}

					<!-- Extension header row -->
					<div class="border-b border-[var(--line)] last:border-b-0">
						<div class="flex items-center gap-3 bg-[var(--void-2)] px-3 py-2.5">
							<!-- Icon -->
							{#if ext.icon}
								<img src={ext.icon} alt="" class="h-8 w-8 shrink-0 object-contain" />
							{:else}
								<div class="flex h-8 w-8 shrink-0 items-center justify-center bg-[var(--void-4)]">
									<Icon name="puzzle" size={16} class="text-[var(--text-ghost)]" />
								</div>
							{/if}

							<!-- Name + meta -->
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-1.5">
									<span class="text-sm text-[var(--text)] truncate">{ext.name}</span>
									<span class="text-[10px] uppercase tracking-wide text-[var(--text-ghost)]">{ext.lang}</span>
									{#if ext.nsfw}
										<span class="bg-[var(--error-soft)] px-1 text-[10px] text-[var(--error)]">18+</span>
									{/if}
								</div>
								<p class="text-[11px] text-[var(--text-ghost)]">
									v{ext.version} · {ext.sources.filter(s => s.enabled).length}/{ext.sources.length} enabled
								</p>
							</div>

							<!-- Proxy toggle (compact) -->
							<div class="flex items-center gap-1.5 shrink-0">
								<span class="text-[10px] uppercase tracking-wide text-[var(--text-ghost)] hidden sm:block">proxy</span>
								<button
									type="button"
									class="flex h-5 w-9 items-center px-0.5 transition-colors {ext.use_proxy
										? 'justify-end bg-[var(--success)]/20'
										: 'justify-start bg-[var(--void-5)]'}"
									onclick={() => handleToggleProxy(ext.pkg, !ext.use_proxy)}
									disabled={isTogglingProxy}
									title={$_('extensions.toggleProxy')}
								>
									{#if isTogglingProxy}
										<div class="flex h-4 w-4 items-center justify-center bg-[var(--void-6)]">
											<Icon name="loader" size={10} class="animate-spin text-[var(--text-ghost)]" />
										</div>
									{:else}
										<div class="h-4 w-4 {ext.use_proxy ? 'bg-[var(--success)]' : 'bg-[var(--void-6)]'}"></div>
									{/if}
								</button>
							</div>

							<!-- Uninstall — always visibly red -->
							<button
								type="button"
								class="flex h-7 w-7 shrink-0 items-center justify-center text-[var(--error)]/50 transition-colors hover:text-[var(--error)] hover:bg-[var(--error-soft)]"
								onclick={() => handleUninstall(ext.pkg)}
								disabled={isUninstalling}
								title={$_('extensions.uninstall')}
							>
								{#if isUninstalling}
									<Icon name="loader" size={13} class="animate-spin" />
								{:else}
									<Icon name="trash-2" size={13} />
								{/if}
							</button>
						</div>

						<!-- Sources list — enabled by default, collapsible -->
						{#if ext.sources.length > 0}
							{@const isExpanded = expandedExtensions.has(ext.pkg)}
							{@const disabledSources = ext.sources.filter(s => !s.enabled)}
							<div class="bg-[var(--void-1)] divide-y divide-[var(--line)]/40">
								{#each ext.sources as source (source.id)}
									{@const matchesSearch = !trimmedSearch || ext.name.toLowerCase().includes(trimmedSearch) || ext.lang.toLowerCase().includes(trimmedSearch) || source.name.toLowerCase().includes(trimmedSearch) || source.lang.toLowerCase().includes(trimmedSearch)}
									{@const show = trimmedSearch ? matchesSearch : (source.enabled || isExpanded)}
									{#if show}
										{@const isToggling = togglingSourceId === source.id}
										<div class="flex items-center gap-2 px-3 py-2 hover:bg-[var(--void-2)] transition-colors">
											<!-- Enabled indicator dot -->
											<div class="h-1.5 w-1.5 shrink-0 {source.enabled ? 'bg-[var(--success)]' : 'bg-[var(--void-6)]'}"></div>

											<!-- Source name -->
											<div class="min-w-0 flex-1">
												<div class="flex items-center gap-2">
													<span class="text-xs {source.enabled ? 'text-[var(--text-soft)]' : 'text-[var(--text-ghost)]'} truncate">{source.name}</span>
													<span class="text-[10px] uppercase tracking-wide text-[var(--text-ghost)] shrink-0">{source.lang}</span>
												</div>
											</div>

											<!-- Settings button — always visible -->
											<button
												type="button"
												class="flex h-6 w-6 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text)] hover:bg-[var(--void-3)]"
												onclick={() => openSourceSettings(source.id)}
												title={$_('extensions.sourceSettings')}
											>
												<Icon name="settings" size={12} />
											</button>

											<!-- Enable toggle -->
											<button
												type="button"
												class="flex h-5 w-9 shrink-0 items-center px-0.5 transition-colors {source.enabled
													? 'justify-end bg-[var(--success)]/20'
													: 'justify-start bg-[var(--void-5)]'}"
												onclick={() => handleToggleSource(source.id, !source.enabled)}
												disabled={isToggling}
												title={source.enabled ? $_('extensions.disable') : $_('extensions.enable')}
											>
												{#if isToggling}
													<div class="flex h-4 w-4 items-center justify-center bg-[var(--void-6)]">
														<Icon name="loader" size={10} class="animate-spin text-[var(--text-ghost)]" />
													</div>
												{:else}
													<div class="h-4 w-4 {source.enabled ? 'bg-[var(--success)]' : 'bg-[var(--void-6)]'}"></div>
												{/if}
											</button>
										</div>
									{/if}
								{/each}

								<!-- Expand / collapse disabled sources -->
								{#if !trimmedSearch && disabledSources.length > 0}
									<button
										type="button"
										class="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-wide text-[var(--text-ghost)] hover:text-[var(--text-muted)] hover:bg-[var(--void-2)] transition-colors"
										onclick={() => toggleExtensionExpanded(ext.pkg)}
									>
										<Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={10} />
										{isExpanded ? $_('common.less') : `${disabledSources.length} disabled`}
									</button>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

	{:else}
		<!-- ── AVAILABLE TAB ── -->
		{#if availableExtensions.length === 0}
			<div class="flex flex-col items-center gap-4 py-16 text-center">
				<div class="flex h-16 w-16 items-center justify-center border border-[var(--line)] bg-[var(--void-3)]">
					<Icon name="check" size={24} class="text-[var(--success)]" />
				</div>
				<div>
					<p class="text-[var(--text)]">{$_('extensions.allInstalled')}</p>
					<p class="mt-1 text-sm text-[var(--text-ghost)]">{$_('extensions.noRepoConfigured')}</p>
				</div>
			</div>
		{:else if filteredAvailable.length === 0}
			<div class="py-8 text-center">
				<p class="text-sm text-[var(--text-muted)]">{$_('common.noResults')}</p>
			</div>
		{:else}
			<div class="flex flex-col gap-0 border border-[var(--line)]">
				{#each filteredAvailable as ext (ext.pkg)}
					{@const isInstalling = installingPkg === ext.pkg}
					<div class="flex items-center gap-3 border-b border-[var(--line)] last:border-b-0 bg-[var(--void-2)] px-3 py-2.5 transition-colors hover:bg-[var(--void-3)]">
						{#if ext.icon}
							<img src={ext.icon} alt="" class="h-8 w-8 shrink-0 object-contain" />
						{:else}
							<div class="flex h-8 w-8 shrink-0 items-center justify-center bg-[var(--void-4)]">
								<Icon name="puzzle" size={16} class="text-[var(--text-ghost)]" />
							</div>
						{/if}
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-1.5">
								<span class="text-sm text-[var(--text)] truncate">{ext.name}</span>
								<span class="text-[10px] uppercase tracking-wide text-[var(--text-ghost)] shrink-0">{ext.lang}</span>
								{#if ext.nsfw}
									<span class="bg-[var(--error-soft)] px-1 text-[10px] text-[var(--error)] shrink-0">18+</span>
								{/if}
							</div>
							<p class="text-[11px] text-[var(--text-ghost)]">v{ext.version}</p>
						</div>
						<Button
							variant="ghost"
							size="sm"
							onclick={() => handleInstall(ext.pkg)}
							disabled={isInstalling}
						>
							{#if isInstalling}
								<Icon name="loader" size={13} class="animate-spin" />
							{:else}
								<Icon name="plus" size={13} />
								{$_('extensions.install')}
							{/if}
						</Button>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- Source Settings Panel -->
<SlidePanel
	open={sourceSettingsOpen}
	title={sourceSettingsData ? `${sourceSettingsData.name} ${$_('extensions.settings')}` : $_('extensions.sourceSettings')}
	onclose={closeSourceSettings}
>
	{#if sourceSettingsLoading}
		<div class="flex flex-col items-center gap-4 py-12">
			<Icon name="loader" size={24} class="text-[var(--text-muted)] animate-spin" />
			<p class="text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
		</div>
	{:else if sourceSettingsError}
		<div class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-4 py-3 text-sm text-[var(--error)]">
			{sourceSettingsError}
		</div>
	{:else if sourceSettingsData}
		{#if sourceSettingsData.preferences.length === 0}
			<div class="flex flex-col items-center gap-4 py-12 text-center">
				<Icon name="settings" size={32} class="text-[var(--text-ghost)]" />
				<p class="text-sm text-[var(--text-ghost)]">{$_('extensions.noPreferences')}</p>
			</div>
		{:else}
			<div class="flex flex-col gap-4">
				<div class="border border-[var(--line)] bg-[var(--void-2)] p-4">
						<div class="flex flex-col gap-3">
							<div>
								<p class="text-sm text-[var(--text)]">Advanced Auth / Storage Import</p>
								<p class="mt-0.5 text-xs text-[var(--text-ghost)]">
									Single replace editor for hidden extension storage values (no WebView login). Existing imported keys are loaded here; applying replaces all imported keys.
								</p>
							</div>

							<p class="text-xs text-[var(--text-muted)]">Generic key/value map</p>

							<textarea
								class="min-h-40 w-full border border-[var(--line)] bg-[var(--void-1)] p-3 text-xs text-[var(--text)] outline-none focus:border-[var(--text-ghost)]"
								placeholder="JSON object. Leave empty and apply to delete all imported keys."
								bind:value={authImportText}
							></textarea>
							<p class="text-[11px] text-[var(--text-ghost)]">
								{#if importedStoragePreferences.length > 0}
									Loaded {importedStoragePreferences.length} imported key{importedStoragePreferences.length === 1 ? '' : 's'} into this editor.
								{:else}
									No imported keys yet.
								{/if}
							</p>

						{#if authImportError}
							<div class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-3 py-2 text-xs text-[var(--error)]">
								{authImportError}
							</div>
						{/if}
						{#if authImportSuccess}
							<div class="border border-[var(--success)]/20 bg-[var(--success)]/10 px-3 py-2 text-xs text-[var(--success)]">
								{authImportSuccess}
							</div>
						{/if}

							<div class="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onclick={importAuthStorage}
									disabled={authImportSaving || (!authImportText.trim() && importedStoragePreferences.length === 0)}
									loading={authImportSaving}
								>
									Apply replacement
								</Button>
							</div>
						</div>
					</div>

				{#each sourceSettingsData.preferences.filter(p => p.visible) as pref (pref.key)}
					<div class="border border-[var(--line)] bg-[var(--void-2)] p-4">
						<div class="flex items-start justify-between gap-3">
							<div class="flex-1">
								<p class="text-sm text-[var(--text)]">{pref.title}</p>
								{#if pref.summary}
									<p class="mt-0.5 text-xs text-[var(--text-ghost)]">{pref.summary}</p>
								{/if}
							</div>

							{#if pref.type === 'toggle'}
								{@const val = getCurrentValue(pref) as boolean}
								<button
									type="button"
									class="flex h-6 w-10 items-center px-0.5 shrink-0 transition-colors {val
										? 'justify-end bg-[var(--success)]/20'
										: 'justify-start bg-[var(--void-4)]'}"
									onclick={() => handlePreferenceChange(pref.key, !val)}
									disabled={!pref.enabled}
								>
									<div class="h-5 w-5 {val ? 'bg-[var(--success)]' : 'bg-[var(--void-6)]'}"></div>
								</button>
							{/if}
						</div>

						{#if pref.type === 'list' && pref.entries && pref.entry_values}
							{@const val = getCurrentValue(pref) as string}
							<div class="mt-3 flex flex-col gap-1">
								{#each pref.entries as entry, i (entry)}
									{@const entryVal = pref.entry_values?.[i] ?? entry}
									<button
										type="button"
										class="flex items-center gap-2 px-3 py-2 text-sm transition-colors {val === entryVal
											? 'bg-[var(--void-4)] text-[var(--text)]'
											: 'text-[var(--text-muted)] hover:bg-[var(--void-3)]'}"
										onclick={() => handlePreferenceChange(pref.key, entryVal)}
										disabled={!pref.enabled}
									>
										<div class="h-3 w-3 border border-[var(--line)] {val === entryVal ? 'bg-[var(--text)]' : ''}"></div>
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
										class="flex items-center gap-2 px-3 py-2 text-sm transition-colors {isSelected
											? 'bg-[var(--void-4)] text-[var(--text)]'
											: 'text-[var(--text-muted)] hover:bg-[var(--void-3)]'}"
										onclick={() => {
											const newVal = isSelected
												? val.filter(v => v !== entryVal)
												: [...val, entryVal];
											handlePreferenceChange(pref.key, newVal);
										}}
										disabled={!pref.enabled}
									>
										<div class="flex h-4 w-4 items-center justify-center border border-[var(--line)] {isSelected ? 'bg-[var(--text)]' : ''}">
											{#if isSelected}
												<Icon name="check" size={10} class="text-[var(--void-0)]" />
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
									oninput={(e) => handlePreferenceChange(pref.key, e.currentTarget.value)}
									disabled={!pref.enabled}
								/>
							</div>
						{/if}
					</div>
				{/each}

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
