<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import {
		CloudArrowDownIcon,
		FadersHorizontalIcon,
		LinkIcon,
		MagnifyingGlassIcon,
		SpinnerIcon,
		TrashIcon,
		ArrowClockwiseIcon
	} from 'phosphor-svelte';

	import { convexApi } from '$lib/convex/api';
	import { Button } from '$lib/elements/button';
	import { Input } from '$lib/elements/input';
	import { Select } from '$lib/elements/select';
	import { Tabs } from '$lib/elements/tabs';
	import { _ } from '$lib/i18n';

	type SourceMeta = {
		id: string;
		name: string;
		lang: string;
		supportsLatest: boolean;
	};

	type InstalledExtension = {
		_id: string;
		pkg: string;
		name: string;
		lang: string;
		version: string;
		status: string;
		sources?: SourceMeta[];
		sourceIds: string[];
	};

	type InstalledSource = SourceMeta & {
		extensionPkg: string;
		extensionName: string;
		extensionVersion: string;
	};

	type CommandItem = {
		id: string;
		commandType: string;
		status: string;
		payload?: Record<string, unknown> | null;
		result?: Record<string, unknown> | null;
		lastErrorMessage?: string | null;
	};

	type RepoItem = {
		pkg: string;
		name: string;
		version: string;
		lang: string;
		nsfw: boolean;
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

	const client = useConvexClient();

	const repository = useQuery(convexApi.extensions.getRepository, () => ({}));
	const installed = useQuery(convexApi.extensions.listInstalled, () => ({}));
	const sources = useQuery(convexApi.extensions.listSources, () => ({}));
	const commands = useQuery(convexApi.commands.listMine, () => ({ limit: 100 }));

	const tabs = [
		{ value: 'installed', label: 'Installed' },
		{ value: 'available', label: 'Available' },
		{ value: 'sources', label: 'Sources' }
	];

	let activeTab = $state('installed');
	let repoUrl = $state('');
	let repoQuery = $state('');
	let selectedSourceId = $state('');
	let error = $state<string | null>(null);
	let busy = $state<string | null>(null);
	let preferenceDrafts = $state<Record<string, unknown>>({});

	const installedExtensions = $derived((installed.data ?? []) as InstalledExtension[]);
	const installedSources = $derived((sources.data ?? []) as InstalledSource[]);
	const allCommands = $derived((commands.data ?? []) as CommandItem[]);

	const sourceOptions = $derived(
		installedSources.map((source) => ({
			value: source.id,
			label: `${source.extensionName} · ${source.name} (${source.lang})`
		}))
	);

	const latestRepoSearch = $derived.by(() => {
		for (const item of allCommands) {
			if (item.commandType !== 'extensions.repo.search' || item.status !== 'succeeded') continue;
			return ((item.result?.items ?? []) as RepoItem[]).filter(Boolean);
		}
		return [] as RepoItem[];
	});

	const selectedPreferenceBundle = $derived.by(() => {
		if (!selectedSourceId) return null;
		for (const item of allCommands) {
			if (item.commandType !== 'sources.preferences.fetch' || item.status !== 'succeeded') continue;
			const payloadSourceId = String(item.payload?.sourceId ?? '');
			if (payloadSourceId !== selectedSourceId) continue;
			return item.result as PreferenceBundle;
		}
		return null;
	});

	const recentAdminCommands = $derived.by(() =>
		allCommands.filter((item) =>
			item.commandType.startsWith('extensions.') || item.commandType.startsWith('sources.preferences.')
		)
	);

	$effect(() => {
		if (!repoUrl && repository.data?.url) {
			repoUrl = repository.data.url;
		}
	});

	$effect(() => {
		if (!selectedSourceId && installedSources.length > 0) {
			selectedSourceId = installedSources[0].id;
		}
	});

	$effect(() => {
		const bundle = selectedPreferenceBundle;
		if (!bundle) return;
		const nextDrafts: Record<string, unknown> = {};
		for (const filter of bundle.preferences) {
			const meta = filter.data;
			nextDrafts[meta.key] = structuredCloneValue(meta.current_value);
		}
		preferenceDrafts = nextDrafts;
	});

	function structuredCloneValue(value: unknown) {
		if (Array.isArray(value)) return [...value];
		if (value && typeof value === 'object') return { ...(value as Record<string, unknown>) };
		return value;
	}

	async function enqueueCommand(
		commandType: string,
		payload: Record<string, unknown>,
		busyKey: string
	) {
		busy = busyKey;
		error = null;
		try {
			await client.mutation(convexApi.commands.enqueue, {
				commandType,
				payload
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to queue command';
		} finally {
			busy = null;
		}
	}

	async function syncRepo(event: SubmitEvent) {
		event.preventDefault();
		const url = repoUrl.trim();
		if (!url) return;
		await enqueueCommand('extensions.repo.sync', { url }, 'repo-sync');
	}

	async function searchRepository(event: SubmitEvent) {
		event.preventDefault();
		await enqueueCommand(
			'extensions.repo.search',
			{ query: repoQuery.trim(), limit: 60 },
			'repo-search'
		);
	}

	async function installExtension(pkg: string) {
		await enqueueCommand('extensions.install', { pkg }, `install:${pkg}`);
	}

	async function updateExtension(pkg: string) {
		await enqueueCommand('extensions.update', { pkg }, `update:${pkg}`);
	}

	async function uninstallExtension(pkg: string) {
		await enqueueCommand('extensions.uninstall', { pkg }, `uninstall:${pkg}`);
	}

	async function fetchPreferences(sourceId: string) {
		await enqueueCommand('sources.preferences.fetch', { sourceId }, `prefs:${sourceId}`);
	}

	async function savePreferences(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedSourceId) return;
		await enqueueCommand(
			'sources.preferences.save',
			{
				sourceId: selectedSourceId,
				values: preferenceDrafts
			},
			`prefs-save:${selectedSourceId}`
		);
	}

	function updateDraft(key: string, value: unknown) {
		preferenceDrafts = { ...preferenceDrafts, [key]: value };
	}

	function toggleMultiSelectValue(key: string, option: string, checked: boolean) {
		const current = Array.isArray(preferenceDrafts[key]) ? [...(preferenceDrafts[key] as string[])] : [];
		const next = checked ? [...new Set([...current, option])] : current.filter((item) => item !== option);
		updateDraft(key, next);
	}

	function isInstalled(pkg: string) {
		return installedExtensions.some((item) => item.pkg === pkg);
	}

	function selectedSource() {
		return installedSources.find((item) => item.id === selectedSourceId) ?? null;
	}

	function filterVisibility(filter: FilterItem) {
		return filter.data.visible !== false && filter.data.enabled !== false && filter.data.key;
	}
</script>

<svelte:head>
	<title>{$_('nav.extensions')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex items-center gap-3">
		<h1 class="text-display flex-1 text-xl text-[var(--text)]">{$_('nav.extensions').toLowerCase()}</h1>
	</div>

	<div class="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
		<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
			<div class="mb-4 flex items-center gap-2 text-[var(--text)]">
				<LinkIcon size={16} />
				<h2 class="text-sm tracking-wider uppercase">Repository</h2>
			</div>
			<form class="flex flex-col gap-3" onsubmit={syncRepo}>
				<Input
					type="url"
					label="Repository URL"
					bind:value={repoUrl}
					placeholder="https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json"
				/>
				<Button type="submit" size="sm" disabled={busy === 'repo-sync' || !repoUrl.trim()}>
					{busy === 'repo-sync' ? 'Queuing…' : 'Sync repository'}
				</Button>
			</form>
			{#if repository.isLoading}
				<p class="mt-3 text-xs text-[var(--text-ghost)]">Loading repository state…</p>
			{:else if repository.data?.configured}
				<p class="mt-3 text-xs text-[var(--text-ghost)]">Configured: {repository.data.url}</p>
			{:else}
				<p class="mt-3 text-xs text-[var(--text-ghost)]">No repository configured yet.</p>
			{/if}
		</div>

		<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
			<div class="mb-4 flex items-center gap-2 text-[var(--text)]">
				<FadersHorizontalIcon size={16} />
				<h2 class="text-sm tracking-wider uppercase">Source Preferences</h2>
			</div>
			<div class="flex flex-col gap-3">
				<Select
					value={selectedSourceId}
					options={sourceOptions}
					placeholder={installedSources.length === 0 ? 'No installed sources' : 'Choose a source'}
					disabled={installedSources.length === 0}
					onValueChange={(value) => {
						selectedSourceId = value;
						void fetchPreferences(value);
					}}
				/>
				<Button
					type="button"
					size="sm"
					disabled={!selectedSourceId || busy === `prefs:${selectedSourceId}`}
					onclick={() => selectedSourceId && fetchPreferences(selectedSourceId)}
				>
					{busy === `prefs:${selectedSourceId}` ? 'Loading…' : 'Load preferences'}
				</Button>
			</div>
			{#if selectedSource()}
				<p class="mt-3 text-xs text-[var(--text-ghost)]">
					{selectedSource()?.extensionName} · {selectedSource()?.name} · {selectedSource()?.lang}
				</p>
			{/if}
		</div>
	</div>

	{#if error}
		<p class="text-sm text-[var(--error)]">{error}</p>
	{/if}

	<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
		<Tabs tabs={tabs} value={activeTab} onValueChange={(value) => (activeTab = value)} />

		{#if activeTab === 'installed'}
			<div class="mt-4 flex flex-col gap-3">
				{#if installed.isLoading}
					<div class="flex items-center gap-2 text-[var(--text-ghost)]">
						<SpinnerIcon size={14} class="animate-spin" />
						<span>Loading extensions…</span>
					</div>
				{:else if installedExtensions.length === 0}
					<p class="text-sm text-[var(--text-ghost)]">No extensions installed yet.</p>
				{:else}
					{#each installedExtensions as ext (ext._id)}
						<div class="border border-[var(--line)] p-3">
							<div class="flex flex-wrap items-start justify-between gap-3">
								<div>
									<p class="text-sm text-[var(--text)]">{ext.name}</p>
									<p class="mt-1 text-xs text-[var(--text-ghost)]">
										{ext.pkg} · {ext.lang} · v{ext.version}
									</p>
									{#if ext.sources && ext.sources.length > 0}
										<p class="mt-2 text-[10px] text-[var(--text-muted)] uppercase">
											{ext.sources.map((source) => `${source.name} (${source.lang})`).join(' · ')}
										</p>
									{/if}
								</div>
								<div class="flex gap-2">
									<Button
										size="sm"
										disabled={busy === `update:${ext.pkg}`}
										onclick={() => updateExtension(ext.pkg)}
									>
										<ArrowClockwiseIcon size={12} />
										{busy === `update:${ext.pkg}` ? 'Queuing…' : 'Update'}
									</Button>
									<Button
										size="sm"
										disabled={busy === `uninstall:${ext.pkg}`}
										onclick={() => uninstallExtension(ext.pkg)}
									>
										<TrashIcon size={12} />
										{busy === `uninstall:${ext.pkg}` ? 'Queuing…' : 'Uninstall'}
									</Button>
								</div>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		{:else if activeTab === 'available'}
			<div class="mt-4 flex flex-col gap-4">
				<form class="flex items-end gap-3" onsubmit={searchRepository}>
					<div class="relative flex-1">
						<div class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-ghost)]">
							<MagnifyingGlassIcon size={14} />
						</div>
						<Input
							type="search"
							label="Search repository"
							bind:value={repoQuery}
							placeholder="Search by package, title, source, or language"
							class="pl-9"
						/>
					</div>
					<Button type="submit" size="sm" disabled={busy === 'repo-search'}>
						{busy === 'repo-search' ? 'Searching…' : 'Search'}
					</Button>
				</form>

				{#if latestRepoSearch.length === 0}
					<p class="text-sm text-[var(--text-ghost)]">
						Search the configured repository to browse available extensions.
					</p>
				{:else}
					<div class="flex flex-col gap-3">
						{#each latestRepoSearch as item (item.pkg)}
							<div class="border border-[var(--line)] p-3">
								<div class="flex flex-wrap items-start justify-between gap-3">
									<div>
										<p class="text-sm text-[var(--text)]">{item.name}</p>
										<p class="mt-1 text-xs text-[var(--text-ghost)]">
											{item.pkg} · {item.lang} · v{item.version}
										</p>
										<p class="mt-2 text-[10px] text-[var(--text-muted)] uppercase">
											{item.sources.map((source) => `${source.name} (${source.lang})`).join(' · ')}
										</p>
									</div>
									<Button
										size="sm"
										disabled={isInstalled(item.pkg) || busy === `install:${item.pkg}`}
										onclick={() => installExtension(item.pkg)}
									>
										<CloudArrowDownIcon size={12} />
										{#if isInstalled(item.pkg)}
											Installed
										{:else if busy === `install:${item.pkg}`}
											Queuing…
										{:else}
											Install
										{/if}
									</Button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{:else}
			<div class="mt-4 grid gap-4 md:grid-cols-[0.85fr_1.15fr]">
				<div class="flex flex-col gap-3">
					{#if installedSources.length === 0}
						<p class="text-sm text-[var(--text-ghost)]">Install an extension to expose sources.</p>
					{:else}
						{#each installedSources as source (source.id)}
							<button
								type="button"
								class="border border-[var(--line)] p-3 text-left transition-colors {selectedSourceId === source.id
									? 'bg-[var(--void-2)] text-[var(--text)]'
									: 'text-[var(--text-ghost)] hover:bg-[var(--void-2)] hover:text-[var(--text)]'}"
								onclick={() => {
									selectedSourceId = source.id;
									void fetchPreferences(source.id);
								}}
							>
								<p class="text-sm">{source.name}</p>
								<p class="mt-1 text-xs">{source.extensionName} · {source.lang}</p>
							</button>
						{/each}
					{/if}
				</div>

				<div class="border border-[var(--line)] p-4">
					{#if !selectedPreferenceBundle}
						<p class="text-sm text-[var(--text-ghost)]">
							Choose a source and load its preferences to configure it.
						</p>
					{:else}
						<form class="flex flex-col gap-4" onsubmit={savePreferences}>
							<div>
								<h3 class="text-sm uppercase tracking-wider text-[var(--text)]">Preferences</h3>
								<p class="mt-1 text-xs text-[var(--text-ghost)]">
									{selectedPreferenceBundle.source.name} · {selectedPreferenceBundle.source.lang}
								</p>
							</div>

							{#if selectedPreferenceBundle.preferences.filter(filterVisibility).length === 0}
								<p class="text-sm text-[var(--text-ghost)]">This source exposes no configurable preferences.</p>
							{:else}
								{#each selectedPreferenceBundle.preferences.filter(filterVisibility) as filter (filter.data.key)}
									{@const meta = filter.data}
									<div class="flex flex-col gap-2 border-b border-[var(--line)] pb-4">
										<div>
											<p class="text-sm text-[var(--text)]">{meta.title || meta.key}</p>
											{#if meta.summary}
												<p class="mt-1 text-xs text-[var(--text-ghost)]">{meta.summary}</p>
											{/if}
										</div>

										{#if meta.type === 'toggle'}
											<label class="flex items-center gap-3 text-sm text-[var(--text)]">
												<input
													type="checkbox"
													checked={Boolean(preferenceDrafts[meta.key])}
													onchange={(event) => updateDraft(meta.key, event.currentTarget.checked)}
												/>
												<span>Enabled</span>
											</label>
										{:else if meta.type === 'list'}
											<select
												class="h-11 border border-[var(--void-4)] bg-[var(--void-2)] px-3 text-sm text-[var(--text)]"
												value={String(preferenceDrafts[meta.key] ?? '')}
												onchange={(event) => updateDraft(meta.key, event.currentTarget.value)}
											>
												{#each meta.entry_values ?? [] as value, index}
													<option value={value}>{meta.entries?.[index] ?? value}</option>
												{/each}
											</select>
										{:else if meta.type === 'multi_select'}
											<div class="grid gap-2">
												{#each meta.entry_values ?? [] as value, index}
													<label class="flex items-center gap-3 text-sm text-[var(--text)]">
														<input
															type="checkbox"
															checked={Array.isArray(preferenceDrafts[meta.key]) &&
																(preferenceDrafts[meta.key] as string[]).includes(value)}
															onchange={(event) =>
																toggleMultiSelectValue(meta.key, value, event.currentTarget.checked)}
														/>
														<span>{meta.entries?.[index] ?? value}</span>
													</label>
												{/each}
											</div>
										{:else}
											<input
												class="h-11 border border-[var(--void-4)] bg-[var(--void-2)] px-3 text-sm text-[var(--text)]"
												type="text"
												value={String(preferenceDrafts[meta.key] ?? '')}
												oninput={(event) => updateDraft(meta.key, event.currentTarget.value)}
											/>
										{/if}
									</div>
								{/each}
							{/if}

							<Button type="submit" size="sm" disabled={!selectedSourceId || busy === `prefs-save:${selectedSourceId}`}>
								{busy === `prefs-save:${selectedSourceId}` ? 'Saving…' : 'Save preferences'}
							</Button>

							{#if selectedPreferenceBundle.searchFilters.length > 0}
								<div class="pt-2">
									<h3 class="text-sm uppercase tracking-wider text-[var(--text)]">Search Filters</h3>
									<p class="mt-1 text-xs text-[var(--text-ghost)]">
										These filters are available to Explore for this source.
									</p>
									<div class="mt-3 flex flex-wrap gap-2">
										{#each selectedPreferenceBundle.searchFilters as filter (filter.data.key)}
											<span class="border border-[var(--line)] px-2 py-1 text-[10px] uppercase text-[var(--text-muted)]">
												{filter.data.title || filter.name}
											</span>
										{/each}
									</div>
								</div>
							{/if}
						</form>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
		<h2 class="mb-3 text-sm tracking-wider text-[var(--text)] uppercase">Recent Admin Commands</h2>
		{#if commands.isLoading}
			<p class="text-sm text-[var(--text-ghost)]">Loading command history…</p>
		{:else if recentAdminCommands.length === 0}
			<p class="text-sm text-[var(--text-ghost)]">No extension or source commands yet.</p>
		{:else}
			<div class="flex flex-col gap-2">
				{#each recentAdminCommands as cmd (cmd.id)}
					<div class="flex items-center justify-between gap-4 border-b border-[var(--line)] pb-2">
						<div class="min-w-0">
							<p class="truncate text-xs text-[var(--text-muted)]">{cmd.commandType}</p>
							{#if cmd.lastErrorMessage}
								<p class="mt-1 text-xs text-[var(--error)]">{cmd.lastErrorMessage}</p>
							{/if}
						</div>
						<span
							class="text-xs uppercase {cmd.status === 'failed' || cmd.status === 'dead_letter'
								? 'text-[var(--error)]'
								: 'text-[var(--text-ghost)]'}"
						>
							{cmd.status}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
