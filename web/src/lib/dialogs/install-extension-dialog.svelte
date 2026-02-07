<script lang="ts">
	import * as Dialog from '$elements/dialog/index';
	import { ScrollArea } from '$elements/scroll-area/index';
	import { SearchInput } from '$elements/search-input';
	import * as Select from '$elements/select/index';
	import type { components } from '$lib/api/v2';
	import ExtensionRepo from '$lib/components/extension/extension-repo.svelte';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import InstallIcon from '@lucide/svelte/icons/package-plus';
	import type { ComponentProps } from 'svelte';

	type RepoExtensionResource = components['schemas']['RepoExtensionResource'];

	interface Props extends ComponentProps<typeof Dialog.Root> {
		fetchAvailableExtensions?: () => Promise<RepoExtensionResource[]>;
		installExtension?: (pkg: string) => Promise<boolean>;
	}

	let { fetchAvailableExtensions, installExtension }: Props = $props();

	let extensions: RepoExtensionResource[] | null = $state(null);
	let error: string | null = $state(null);
	let filteredExtensions = $state<RepoExtensionResource[]>([]);
	let isFiltering = $state(false);
	let searchValue = $state('');
	let selectedLanguage = $state('');
	let debouncedSearchValue = $state('');

	let availableLanguages = $derived.by(() => {
		if (!extensions) return [];
		return Array.from(
			new Set(extensions.map((ext) => (ext.lang === 'multi' ? 'multi' : ext.lang.slice(0, 2))))
		).sort();
	});

	let debounceTimeout: ReturnType<typeof setTimeout>;
	$effect(() => {
		const value = searchValue;
		clearTimeout(debounceTimeout);

		isFiltering = true;

		debounceTimeout = setTimeout(() => {
			debouncedSearchValue = value;
			isFiltering = false;
		}, 150);
	});

	$effect(() => {
		if (!extensions || error) {
			filteredExtensions = [];
			return;
		}

		let filtered = extensions;

		if (selectedLanguage) {
			filtered = filtered.filter((ext) =>
				selectedLanguage === 'multi' ? true : ext.lang.slice(0, 2) === selectedLanguage
			);
		}

		if (debouncedSearchValue.length >= 3) {
			const q = debouncedSearchValue.toLowerCase();
			filtered = filtered.filter((ext) => {
				const matchesName = ext.name?.toLowerCase().includes(q);
				const matchesLang = ext.lang?.toLowerCase().includes(q);
				return matchesName || matchesLang;
			});
		}

		filteredExtensions = filtered;
	});

	async function handleOpenChange(open: boolean) {
		if (fetchAvailableExtensions && open) {
			try {
				error = null;
				extensions = await fetchAvailableExtensions();
			} catch (err) {
				error = err instanceof Error ? err.message : String(err);
				extensions = [];
			}
		}
	}
</script>

<Dialog.Root onOpenChange={handleOpenChange}>
	<Dialog.Trigger>
		<div
			class="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-primary-foreground shadow-xs hover:bg-primary/90 has-[>svg]:px-2.5"
		>
			<InstallIcon />
			<span class="hidden md:inline">Install Extension</span>
		</div>
	</Dialog.Trigger>
	<Dialog.Content
		class="flex h-full max-w-full flex-col gap-3 rounded-none border-none sm:h-[85vh] sm:max-w-2xl sm:gap-4 sm:rounded-lg lg:max-w-4xl"
	>
		<Dialog.Header class="flex-shrink-0">
			<Dialog.Title>Install Extension</Dialog.Title>
			<Dialog.Description>Find your favorite source of titles</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
			<SearchInput bind:value={searchValue} placeholder="Search" class="flex-1" />
			<Select.Root type="single" bind:value={selectedLanguage}>
				<Select.Trigger class="w-full sm:w-[180px]">
					{selectedLanguage.toUpperCase() || 'Language'}
				</Select.Trigger>
				<Select.Content class="h-[40vh]">
					<Select.Item value="" label="All Languages">All Languages</Select.Item>
					<Select.Item value="multi" label="Multi">MULTI</Select.Item>
					{#each availableLanguages.filter((lang) => lang !== 'multi') as language (language)}
						<Select.Item value={language} label={language.toUpperCase()}>
							{language.toUpperCase()}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		{#if error}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
				<AlertTriangleIcon class="size-12 text-destructive" />
				<div class="space-y-1">
					<p class="font-medium text-destructive">Failed to load extensions</p>
					<p class="text-sm text-muted-foreground">{error}</p>
				</div>
			</div>
		{:else if extensions}
			<div class="-mx-4 flex-1 overflow-y-auto">
				{#if (selectedLanguage || searchValue.length > 2) && isFiltering}
					<div class="flex-1 space-y-2 overflow-hidden">
						{#each Array(5), i (i)}
							<ExtensionRepo />
						{/each}
					</div>
				{:else if filteredExtensions.length > 0}
					<ScrollArea>
						{#each filteredExtensions, i (i)}
							<ExtensionRepo bind:extension={filteredExtensions[i]} {installExtension} />
						{/each}
					</ScrollArea>
				{:else}
					<div class="flex flex-col items-center justify-center py-12 text-center">
						<AlertTriangleIcon class="mb-4 size-12 text-muted-foreground" />
						<p class="text-muted-foreground">No extensions found</p>
						{#if searchValue || selectedLanguage}
							<p class="mt-2 text-sm text-muted-foreground">Try adjusting your filters</p>
						{/if}
					</div>
				{/if}
			</div>
		{:else}
			<div class="flex-1 space-y-2 overflow-hidden">
				{#each Array(5), i (i)}
					<ExtensionRepo />
				{/each}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
