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

	// Search
	let searchQuery = $state('');
	const trimmedSearch = $derived(searchQuery.trim().toLowerCase());

	// Accordion - track which extensions are expanded
	let expandedExtensions = $state<Set<string>>(new Set());

	// Source settings panel
	let sourceSettingsOpen = $state(false);
	let sourceSettingsLoading = $state(false);
	let sourceSettingsData = $state<SourcePreferencesResolved | null>(null);
	let sourceSettingsError = $state<string | null>(null);
	let sourceSettingsSaving = $state(false);
	let pendingPreferenceChanges = $state<Map<string, unknown>>(new Map());

	// Derived states
	const hasInstalled = $derived(installedExtensions.length > 0);
	const hasAvailable = $derived(availableExtensions.length > 0);

	// Filtered available extensions based on search
	const filteredAvailable = $derived(
		trimmedSearch.length > 0
			? availableExtensions.filter(
					(ext) =>
						ext.name.toLowerCase().includes(trimmedSearch) ||
						ext.lang.toLowerCase().includes(trimmedSearch) ||
						ext.pkg.toLowerCase().includes(trimmedSearch)
				)
			: availableExtensions
	);

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
			expandedExtensions.delete(pkg);
			expandedExtensions = new Set(expandedExtensions);
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

	function toggleExpanded(pkg: string) {
		if (expandedExtensions.has(pkg)) {
			expandedExtensions.delete(pkg);
		} else {
			expandedExtensions.add(pkg);
		}
		expandedExtensions = new Set(expandedExtensions);
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
		if (pendingPreferenceChanges.has(pref.key)) {
			return pendingPreferenceChanges.get(pref.key);
		}
		return pref.current_value ?? pref.default_value;
	}
</script>

<svelte:head>
	<title>{$_('nav.extensions')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h1 class="text-display text-xl text-[var(--text)]">{$_('nav.extensions').toLowerCase()}</h1>
		<Button variant="ghost" size="sm" onclick={() => loadExtensions()} disabled={loading}>
			<Icon name="refresh" size={16} class={loading ? 'animate-spin' : ''} />
		</Button>
	</div>

	<!-- Tabs -->
	<div class="flex gap-1 border-b border-[var(--line)]">
		<button
			type="button"
			class="px-4 py-2 text-sm transition-colors {activeTab === 'installed'
				? 'border-b-2 border-[var(--text)] text-[var(--text)]'
				: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
			onclick={() => (activeTab = 'installed')}
		>
			{$_('extensions.installed')} ({installedExtensions.length})
		</button>
		<button
			type="button"
			class="px-4 py-2 text-sm transition-colors {activeTab === 'available'
				? 'border-b-2 border-[var(--text)] text-[var(--text)]'
				: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
			onclick={() => (activeTab = 'available')}
		>
			{$_('extensions.available')} ({availableExtensions.length})
		</button>
	</div>

	<!-- Search (available tab only) -->
	{#if activeTab === 'available'}
		<div class="relative">
			<Icon
				name="search"
				size={16}
				class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-ghost)]"
			/>
			<Input
				type="search"
				placeholder={$_('extensions.searchPlaceholder')}
				bind:value={searchQuery}
				class="pl-10"
			/>
			{#if searchQuery.trim()}
				<button
					type="button"
					class="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-ghost)] hover:text-[var(--text-muted)]"
					onclick={() => (searchQuery = '')}
				>
					<Icon name="x" size={16} />
				</button>
			{/if}
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
		<div class="flex flex-col items-center gap-4 py-16">
			<Icon name="loader" size={24} class="text-[var(--text-muted)] animate-spin" />
			<p class="text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
		</div>
	{:else if activeTab === 'installed'}
		<!-- Installed extensions -->
		{#if !hasInstalled}
			<div class="flex flex-col items-center gap-4 py-16 text-center">
				<div class="flex h-16 w-16 items-center justify-center border border-[var(--line)] bg-[var(--void-3)]">
					<Icon name="puzzle" size={24} class="text-[var(--text-ghost)]" />
				</div>
				<div>
					<p class="text-[var(--text)]">{$_('extensions.noExtensions')}</p>
					<p class="mt-1 text-sm text-[var(--text-ghost)]">{$_('extensions.installFromRepo')}</p>
				</div>
				<Button variant="outline" onclick={() => (activeTab = 'available')}>
					{$_('extensions.browseAvailable')}
				</Button>
			</div>
		{:else}
			<div class="flex flex-col gap-3">
				{#each installedExtensions as ext (ext.pkg)}
					{@const isExpanded = expandedExtensions.has(ext.pkg)}
					{@const isUninstalling = uninstallingPkg === ext.pkg}
					{@const isTogglingProxy = togglingProxyPkg === ext.pkg}
					<div class="border border-[var(--line)] bg-[var(--void-2)] transition-all card-glow">
						<!-- Extension header -->
						<div class="flex items-center gap-3 p-4">
							<!-- Icon -->
							{#if ext.icon}
								<img src={ext.icon} alt="" class="h-10 w-10 object-contain" />
							{:else}
								<div class="flex h-10 w-10 items-center justify-center bg-[var(--void-4)]">
									<Icon name="puzzle" size={20} class="text-[var(--text-ghost)]" />
								</div>
							{/if}

							<!-- Info -->
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 flex-wrap">
									<p class="text-sm text-[var(--text)] truncate">{ext.name}</p>
									<span class="text-[10px] text-[var(--text-ghost)] uppercase shrink-0">{ext.lang}</span>
									{#if ext.nsfw}
										<span class="bg-[var(--error-soft)] px-1 text-[10px] text-[var(--error)] shrink-0">18+</span>
									{/if}
								</div>
								<div class="flex items-center gap-3 text-xs text-[var(--text-ghost)]">
									<span>v{ext.version}</span>
									<span>{ext.sources.length} {ext.sources.length === 1 ? $_('extensions.source') : $_('extensions.sources')}</span>
								</div>
							</div>

							<!-- Proxy toggle -->
							<div class="flex items-center gap-2">
								<span class="text-[10px] text-[var(--text-ghost)] uppercase hidden sm:inline">{$_('extensions.proxy')}</span>
								<button
									type="button"
									class="flex h-6 w-10 items-center px-0.5 transition-colors {ext.use_proxy
										? 'justify-end bg-[var(--success)]/20'
										: 'justify-start bg-[var(--void-4)]'}"
									onclick={() => handleToggleProxy(ext.pkg, !ext.use_proxy)}
									disabled={isTogglingProxy}
									title={$_('extensions.toggleProxy')}
								>
									{#if isTogglingProxy}
										<div class="flex h-5 w-5 items-center justify-center bg-[var(--void-6)]">
											<Icon name="loader" size={12} class="animate-spin text-[var(--text-ghost)]" />
										</div>
									{:else}
										<div class="h-5 w-5 {ext.use_proxy ? 'bg-[var(--success)]' : 'bg-[var(--void-6)]'}"></div>
									{/if}
								</button>
							</div>

							<!-- Expand button -->
							<button
								type="button"
								class="flex h-8 w-8 items-center justify-center text-[var(--text-ghost)] transition-all hover:text-[var(--text)] hover:bg-[var(--void-4)]"
								onclick={() => toggleExpanded(ext.pkg)}
								title={isExpanded ? $_('extensions.collapse') : $_('extensions.expand')}
							>
								<Icon
									name="chevron-down"
									size={16}
									class="transition-transform {isExpanded ? 'rotate-180' : ''}"
								/>
							</button>

							<!-- Uninstall -->
							<Button
								variant="ghost"
								size="icon-sm"
								onclick={() => handleUninstall(ext.pkg)}
								disabled={isUninstalling}
								class="text-[var(--error)] hover:text-[var(--error)] hover:bg-[var(--error-soft)]"
								title={$_('extensions.uninstall')}
							>
								{#if isUninstalling}
									<Icon name="loader" size={14} class="animate-spin" />
								{:else}
									<Icon name="trash" size={14} />
								{/if}
							</Button>
						</div>

						<!-- Expanded sources -->
						{#if isExpanded && ext.sources.length > 0}
							<div class="border-t border-[var(--line)] bg-[var(--void-1)]">
								{#each ext.sources as source (source.id)}
									{@const isToggling = togglingSourceId === source.id}
									<div class="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--line)]/50 last:border-b-0 hover:bg-[var(--void-2)] transition-colors">
										<!-- Source info -->
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-2">
												<span class="text-sm text-[var(--text-soft)] truncate">{source.name}</span>
												<span class="text-[10px] text-[var(--text-ghost)] uppercase shrink-0">{source.lang}</span>
											</div>
											{#if source.base_url}
												<p class="text-[10px] text-[var(--text-ghost)] truncate">{source.base_url}</p>
											{/if}
										</div>

										<!-- Settings button -->
										{#if ext.sources_has_prefs}
											<button
												type="button"
												class="flex h-7 w-7 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--text)] hover:bg-[var(--void-4)]"
												onclick={() => openSourceSettings(source.id)}
												title={$_('extensions.sourceSettings')}
											>
												<Icon name="settings" size={14} />
											</button>
										{/if}

										<!-- Enable toggle -->
										<button
											type="button"
											class="flex h-6 w-10 items-center px-0.5 shrink-0 transition-colors {source.enabled
												? 'justify-end bg-[var(--success)]/20'
												: 'justify-start bg-[var(--void-4)]'}"
											onclick={() => handleToggleSource(source.id, !source.enabled)}
											disabled={isToggling}
											title={source.enabled ? $_('extensions.disable') : $_('extensions.enable')}
										>
											{#if isToggling}
												<div class="flex h-5 w-5 items-center justify-center bg-[var(--void-6)]">
													<Icon name="loader" size={12} class="animate-spin text-[var(--text-ghost)]" />
												</div>
											{:else}
												<div class="h-5 w-5 {source.enabled ? 'bg-[var(--success)]' : 'bg-[var(--void-6)]'}"></div>
											{/if}
										</button>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		<!-- Available extensions -->
		{#if !hasAvailable}
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
			<div class="flex flex-col items-center gap-4 py-16 text-center">
				<div class="flex h-16 w-16 items-center justify-center border border-[var(--line)] bg-[var(--void-3)]">
					<Icon name="search" size={24} class="text-[var(--text-ghost)]" />
				</div>
				<div>
					<p class="text-[var(--text)]">{$_('common.noResults')}</p>
					<p class="mt-1 text-sm text-[var(--text-ghost)]">{$_('extensions.tryDifferentSearch')}</p>
				</div>
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#each filteredAvailable as ext (ext.pkg)}
					{@const isInstalling = installingPkg === ext.pkg}
					<div class="flex items-center gap-3 border border-[var(--line)] bg-[var(--void-2)] p-4 transition-colors hover:bg-[var(--void-3)] card-glow">
						{#if ext.icon}
							<img src={ext.icon} alt="" class="h-10 w-10 object-contain" />
						{:else}
							<div class="flex h-10 w-10 items-center justify-center bg-[var(--void-4)]">
								<Icon name="puzzle" size={20} class="text-[var(--text-ghost)]" />
							</div>
						{/if}
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<p class="text-sm text-[var(--text)] truncate">{ext.name}</p>
								<span class="text-[10px] text-[var(--text-ghost)] uppercase shrink-0">{ext.lang}</span>
								{#if ext.nsfw}
									<span class="bg-[var(--error-soft)] px-1 text-[10px] text-[var(--error)] shrink-0">18+</span>
								{/if}
							</div>
							<p class="text-xs text-[var(--text-ghost)]">v{ext.version}</p>
						</div>
						<Button
							variant="outline"
							size="sm"
							onclick={() => handleInstall(ext.pkg)}
							disabled={isInstalling}
						>
							{#if isInstalling}
								<Icon name="loader" size={14} class="animate-spin" />
							{:else}
								<Icon name="plus" size={14} />
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
									aria-label={pref.title}
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
