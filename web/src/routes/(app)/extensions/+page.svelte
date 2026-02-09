<script lang="ts">
	import Header from '$components/page-header/header.svelte';
	import InstallExtensionDialog from '$dialogs/install-extension-dialog.svelte';
	import ExtensionsPriorityDialog from '$dialogs/extensions-priority-dialog.svelte';
	import SourcePreferencesDialog from '$dialogs/source-preferences-dialog.svelte';
	import Badge from '$elements/badge/badge.svelte';
	import { Button } from '$elements/button/index';
	import {
		getSourcePreferences as getSourcePreferencesApi,
		installExtension as installExtensionApi,
		listAvailableExtensions,
		listInstalledExtensions,
		toggleExtensionProxy as toggleExtensionProxyApi,
		toggleSourceEnabled,
		uninstallExtension,
		updateExtensionsPriority as updateExtensionsPriorityApi,
		updateSourcePreferences as updateSourcePreferencesApi,
		type ExtensionResource,
		type RepoExtensionResource,
		type SourcePreferenceUpdate,
		type SourcePreferencesResolved
	} from '$lib/api/extensions';
	import type { components } from '$lib/api/v2';
	import ExtensionInstalled from '$lib/components/extension/extension-installed.svelte';
	import { RefreshCwIcon, SettingsIcon } from '@lucide/svelte/icons';
	import { onMount } from 'svelte';

	type SourcePreference = components['schemas']['SourcePreference'];

	let installedExtensions: ExtensionResource[] = $state([]);
	let configureMode = $state(false);
	let preferencesSourceId: string | null = $state(null);
	let isSourcePreferencesOpen = $derived(preferencesSourceId !== null);

	// -----------------------------------------------------
	// Fetch data
	// -----------------------------------------------------
	async function fetchInstalledExtensions() {
		installedExtensions = await listInstalledExtensions();
	}
	async function fetchAvailableExtensions(): Promise<RepoExtensionResource[]> {
		return listAvailableExtensions();
	}
	async function fetchSourcePreferences(source_id: string): Promise<SourcePreferencesResolved> {
		return getSourcePreferencesApi(source_id);
	}

	// -----------------------------------------------------
	// Chage data
	// -----------------------------------------------------
	async function installExtension(extension_pkg: string): Promise<boolean> {
		const installedExtension = await installExtensionApi(extension_pkg);
		if (!installedExtensions.some((item) => item.pkg === installedExtension.pkg)) {
			installedExtensions = [...installedExtensions, installedExtension];
		}
		return true;
	}
	async function deleteExtension(extension_pkg: string): Promise<boolean> {
		await uninstallExtension(extension_pkg);
		installedExtensions = installedExtensions.filter((ext) => ext.pkg !== extension_pkg);
		return true;
	}
	async function updateExtensionsPriority(extensions_by_priority: string[]): Promise<boolean> {
		await updateExtensionsPriorityApi(extensions_by_priority);
		return true;
	}
	async function toggleExtensionProxy(extension_pkg: string, use_proxy: boolean): Promise<boolean> {
		await toggleExtensionProxyApi(extension_pkg, use_proxy);
		return use_proxy;
	}
	async function toggleSource(source_id: string, enabled: boolean): Promise<boolean> {
		await toggleSourceEnabled(source_id, enabled);
		return true;
	}
	async function updateSourcePreferences(
		source_id: string,
		preferences: SourcePreference[]
	): Promise<boolean> {
		const updates: SourcePreferenceUpdate[] = preferences.map((preference) => ({
			key: preference.key,
			value: preference.current_value
		}));
		await updateSourcePreferencesApi(source_id, updates);
		return true;
	}

	onMount(async () => {
		await fetchInstalledExtensions();
	});

	type HistoryEntry = {
		status: string;
		commit_day: string;
		name: string;
		lang: string;
		version: string;
		new_version?: string;
		renamed_to?: string;
	};

	const historyExample: HistoryEntry[] = [
		{
			status: 'updated',
			commit_day: 'today',
			name: 'manhuarm',
			lang: 'all',
			version: '1.4.51',
			new_version: '1.4.52'
		},
		{
			status: 'updated',
			commit_day: '1 day ago',
			name: 'mangafreak',
			lang: 'en',
			version: '1.4.11',
			new_version: '1.4.12'
		},
		{
			status: 'updated',
			commit_day: '1 day ago',
			name: 'hiperdex',
			lang: 'en',
			version: '1.4.68',
			new_version: '1.4.69'
		},
		{
			status: 'updated',
			commit_day: '1 day ago',
			name: 'aurorascan',
			lang: 'pt',
			version: '1.4.6',
			new_version: '1.4.7'
		},
		{
			status: 'updated',
			commit_day: '1 day ago',
			name: 'maidscan',
			lang: 'pt',
			version: '1.4.52',
			new_version: '1.4.53'
		},
		{
			status: 'updated',
			commit_day: '1 day ago',
			name: 'mediocretoons',
			lang: 'pt',
			version: '1.4.8',
			new_version: '1.4.9'
		},
		{
			status: 'updated',
			commit_day: '1 day ago',
			name: 'sussyscan',
			lang: 'pt',
			version: '1.4.62',
			new_version: '1.4.63'
		},
		{
			status: 'updated',
			commit_day: '2 days ago',
			name: 'manhuarm',
			lang: 'all',
			version: '1.4.50',
			new_version: '1.4.51'
		},
		{
			status: 'updated',
			commit_day: '2 days ago',
			name: 'templescanesp',
			lang: 'es',
			version: '1.4.51',
			new_version: '1.4.52'
		},
		{
			status: 'updated',
			commit_day: 'today',
			name: 'mangastop',
			lang: 'pt',
			version: '1.4.32',
			new_version: '1.4.33'
		},
		{
			status: 'updated',
			commit_day: '1 day ago',
			name: 'spyfakku',
			lang: 'en',
			version: '1.4.12',
			new_version: '1.4.13'
		},
		{
			status: 'updated',
			commit_day: '1 day ago',
			name: 'mangastop',
			lang: 'pt',
			version: '1.4.31',
			new_version: '1.4.32'
		},
		{
			status: 'added',
			commit_day: '1 day ago',
			name: 'meitoon',
			lang: 'en',
			version: '1.4.18'
		},
		{
			status: 'updated',
			commit_day: '1 day ago',
			name: 'catharsisworld',
			lang: 'es',
			version: '1.4.53',
			new_version: '1.4.54'
		},
		{
			status: 'added',
			commit_day: '1 day ago',
			name: 'piccoma',
			lang: 'ja',
			version: '1.4.1'
		},
		{
			status: 'updated',
			commit_day: '1 day ago',
			name: 'mangaswat',
			lang: 'ar',
			version: '1.4.56',
			new_version: '1.4.57'
		},
		{
			status: 'added',
			commit_day: '2 days ago',
			name: 'yskcomics',
			lang: 'all',
			version: '1.4.1'
		},
		{
			status: 'added',
			commit_day: '2 days ago',
			name: 'comicgrast',
			lang: 'ja',
			version: '1.4.1'
		}
	];
</script>

<Header
	title="Extensions"
	description="Manage installed extensions, apply updates, and explore new sites."
>
	<Button size="sm" variant="ghost">
		<RefreshCwIcon />
		<span class="hidden md:flex">Check Updates</span>
	</Button>
	<ExtensionsPriorityDialog bind:installedExtensions {updateExtensionsPriority} />
	<Button
		size="sm"
		variant={!configureMode ? 'ghost' : 'default'}
		onclick={() => {
			configureMode = !configureMode;
		}}
	>
		<SettingsIcon />
		<span class="hidden md:flex" class:animate-wiggle={configureMode}>Configure</span>
	</Button>

	<InstallExtensionDialog {fetchAvailableExtensions} {installExtension} />
</Header>

<div class="flex flex-1 flex-col gap-4 p-4 pt-6 pb-28 md:pb-6">
	<div class="lg:grid lg:grid-cols-2 lg:gap-4">
		{#if installedExtensions.length > 0}
			{#each installedExtensions, i (i)}
				<ExtensionInstalled
					bind:extension={installedExtensions[i]}
					bind:configureMode
					bind:preferencesSourceId
					{deleteExtension}
					{toggleExtensionProxy}
					{toggleSource}
				/>
			{/each}
		{:else}
			{#each Array(5), i (i)}
				<ExtensionInstalled />
			{/each}
		{/if}
	</div>

	<div class="space-y-4 rounded-xl border border-border/60 bg-card/80 p-4 shadow-sm">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h3 class="text-base font-semibold">Repository updates history</h3>
			<div>
				<Badge variant="outline">Updated</Badge>
				<Badge variant="outline">Added</Badge>
				<Badge variant="outline">Renamed</Badge>
				<Badge variant="outline">Deleted</Badge>
			</div>
		</div>
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each historyExample as entry, i (i)}
				<div class="rounded-lg border border-border/60 bg-background/80 p-4">
					<div class="flex items-start justify-between gap-2">
						<h4 class="text-sm font-semibold capitalize">
							{entry.name}
						</h4>
						<p class="text-xs tracking-wide text-muted-foreground uppercase">
							{entry.status} | {entry.commit_day}
						</p>
					</div>
					<p class="text-xs tracking-wide text-muted-foreground uppercase">
						v{entry.version}{#if entry.new_version}
							→ v{entry.new_version}{/if}
					</p>
					{#if entry.renamed_to}
						<p class="mt-1 text-xs text-muted-foreground">Renamed to: {entry.renamed_to}</p>
					{/if}
				</div>
			{/each}
		</div>
	</div>
	{#if preferencesSourceId}
		<SourcePreferencesDialog
			bind:preferencesSourceId
			{isSourcePreferencesOpen}
			{fetchSourcePreferences}
			{updateSourcePreferences}
		/>
	{/if}
</div>
