<script lang="ts">
	import Header from '$components/page-header/header.svelte';
	import InstallExtensionDialog from '$dialogs/install-extension-dialog.svelte';
	import ExtensionsPriorityDialog from '$dialogs/extensions-priority-dialog.svelte';
	import SourcePreferencesDialog from '$dialogs/source-preferences-dialog.svelte';
	import Badge from '$elements/badge/badge.svelte';
	import { Button } from '$elements/button/index';
	import client from '$lib/api';
	import type { components } from '$lib/api/v2';
	import ExtensionInstalled from '$lib/components/extension/extension-installed.svelte';
	import { RefreshCwIcon, SettingsIcon } from '@lucide/svelte/icons';
	import { onMount } from 'svelte';

	type ExtensionResource = components['schemas']['ExtensionResource'];
	type SourcePreference = components['schemas']['SourcePreference'];

	let installedExtensions: ExtensionResource[] = $state([]);
	let configureMode = $state(false);
	let preferencesSourceId: string | null = $state(null);
	let isSourcePreferencesOpen = $derived(preferencesSourceId !== null);

	// -----------------------------------------------------
	// Fetch data
	// -----------------------------------------------------
	async function fetchInstalledExtensions() {
		const { data, error } = await client.GET('/api/v2/extensions/installed', {});
		if (error) {
			const errorMessage = 'Failed to fetch installed extensions.';
			console.error(errorMessage, error);
			throw new Error(errorMessage);
		}
		if (data) {
			installedExtensions = data;
		}
	}
	async function fetchAvailableExtensions() {
		const { data, error } = await client.GET('/api/v2/extensions/available', {});
		if (error) {
			const errorMessage = 'Failed to fetch available extensions.';
			console.error(errorMessage, error);
			throw new Error(errorMessage);
		}
		return data;
	}
	async function fetchSourcePreferences(source_id: string) {
		const { data, error } = await client.GET('/api/v2/extensions/source/{source_id}/preferences', {
			params: { path: { source_id } }
		});
		if (error) {
			const errorMessage = 'Failed to fetch source preferences.';
			console.error(errorMessage, error);
			throw new Error(errorMessage);
		}
		return data;
	}

	// -----------------------------------------------------
	// Chage data
	// -----------------------------------------------------
	async function installExtension(extension_pkg: string): Promise<boolean> {
		const { data, error } = await client.POST('/api/v2/extensions/install/{extension_pkg}', {
			params: { path: { extension_pkg } }
		});
		if (error) {
			const errorMessage = 'Failed to install extension.';
			console.error(errorMessage, error);
			throw new Error(errorMessage);
		}
		if (data) {
			installedExtensions = [...installedExtensions, data];
		}
		return true;
	}
	async function deleteExtension(extension_pkg: string): Promise<boolean> {
		const { error } = await client.DELETE('/api/v2/extensions/uninstall/{extension_pkg}', {
			params: { path: { extension_pkg } }
		});
		if (error) {
			const errorMessage = 'Failed to delete extension.';
			console.error(errorMessage, error);
			throw new Error(errorMessage);
		}
		installedExtensions = installedExtensions.filter((ext) => ext.pkg !== extension_pkg);
		return true;
	}
	async function updateExtensionsPriority(extensions_by_priority: string[]): Promise<boolean> {
		const { error } = await client.PUT('/api/v2/extensions/priority', {
			body: extensions_by_priority
		});
		if (error) {
			const errorMessage = 'Failed to update extension priority.';
			console.error(errorMessage, error);
			throw new Error(errorMessage);
		}
		return true;
	}
	async function toggleExtensionProxy(extension_pkg: string, use_proxy: boolean): Promise<boolean> {
		const { error } = await client.PUT('/api/v2/extensions/{extension_pkg}/proxy', {
			params: { path: { extension_pkg }, query: { use_proxy } }
		});
		if (error) {
			const errorMessage = 'Failed to toggle extension proxy.';
			console.error(errorMessage, error);
			throw new Error(errorMessage);
		}
		return use_proxy;
	}
	async function toggleSource(source_id: string, enabled: boolean): Promise<boolean> {
		const { error } = await client.PUT('/api/v2/extensions/source/{source_id}/enabled', {
			params: { path: { source_id }, query: { enabled } }
		});
		if (error) {
			const errorMessage = 'Failed to toggle source.';
			console.error(errorMessage, error);
			throw new Error(errorMessage);
		}
		return true;
	}
	async function updateSourcePreferences(
		source_id: string,
		preferences: SourcePreference[]
	): Promise<boolean> {
		const { error } = await client.PUT('/api/v2/extensions/source/{source_id}/preferences', {
			params: { path: { source_id } },
			body: preferences
		});
		if (error) {
			const errorMessage = 'Failed to update preferences.';
			console.error(errorMessage, error);
			throw new Error(errorMessage);
		}
		return true;
	}

	onMount(async () => {
		await fetchInstalledExtensions();
	});

	const historyExample = [
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
