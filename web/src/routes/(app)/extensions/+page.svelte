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
			sourceSettingsData = await getSourcePreferences(sourceId);
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
	}

	function handlePreferenceChange(key: string, value: unknown) {
		pendingPreferenceChanges.set(key, value);
		pendingPreferenceChanges = new Map(pendingPreferenceChanges);
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
