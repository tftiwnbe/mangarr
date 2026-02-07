<script lang="ts">
	import { Button } from '$elements/button/index';
	import * as Item from '$elements/item/index';
	import { Separator } from '$elements/item/index';
	import { ScrollArea } from '$elements/scroll-area/index';
	import { Skeleton } from '$elements/skeleton/index.js';
	import { Spinner } from '$elements/spinner';
	import { Toggle } from '$elements/toggle';
	import type { components } from '$lib/api/v2';
	import { Trash2Icon, Waypoints } from '@lucide/svelte/icons';
	import { fade } from 'svelte/transition';

	type ExtensionResource = components['schemas']['ExtensionResource'];

	interface Props {
		extension?: ExtensionResource;
		configureMode?: boolean;
		preferencesSourceId?: string | null;
		deleteExtension?: (pkg: string) => Promise<boolean>;
		toggleExtensionProxy?: (pkg: string, use_proxy: boolean) => Promise<boolean>;
		toggleSource?: (sourceId: string, enabled: boolean) => Promise<boolean>;
	}

	let {
		extension = $bindable(),
		configureMode = $bindable(false),
		preferencesSourceId = $bindable(null),
		deleteExtension = async () => false,
		toggleExtensionProxy = async () => false,
		toggleSource = async () => false
	}: Props = $props();

	let loading = $state(false);
	let sortedSources = $derived(
		extension?.sources.slice().sort((a, b) => {
			if (a.enabled && !b.enabled) return -1;
			if (!a.enabled && b.enabled) return 1;

			if (!a.enabled && !b.enabled) {
				if (a.lang === 'multi') return -1;
				if (b.lang === 'multi') return 1;
			}

			return 0;
		})
	);

	async function handleToggleProxy(use_proxy: boolean) {
		if (!extension) return;
		loading = true;
		try {
			extension.use_proxy = await toggleExtensionProxy(extension.pkg, use_proxy);
		} finally {
			loading = false;
		}
	}

	async function handleToggleSource(sourceId: string, enabled: boolean) {
		if (!extension) return;
		loading = true;
		try {
			await toggleSource(sourceId, enabled);
			const source = extension.sources.find((s) => s.id === sourceId);
			if (source) source.enabled = enabled;
		} finally {
			loading = false;
		}
	}

	async function handleDelete() {
		if (!extension) return;
		loading = true;
		try {
			await deleteExtension(extension.pkg);
		} finally {
			loading = false;
		}
	}
</script>

{#if extension}
	<div transition:fade|global class="relative w-full sm:rounded-lg md:border md:bg-card">
		<div class="flex flex-row items-center justify-between">
			<Item.Root variant="default">
				<Item.Media variant="image">
					<img src={extension.icon} alt={extension.name} width="96" height="96" />
				</Item.Media>
				<Item.Content class="min-w-0 flex-1">
					<Item.Title class="line-clamp-1 text-sm sm:text-base">
						{extension.name}
					</Item.Title>
					<Item.Description class="flex items-center gap-1.5 overflow-hidden sm:gap-2">
						<span class="text-xs text-muted-foreground">v{extension.version}</span>
						<span class="text-xs text-muted-foreground">•</span>
						<span class="text-xs font-medium uppercase">{extension.lang}</span>
						{#if extension.nsfw}
							<span class="text-xs text-muted-foreground">•</span>
							<span class="text-xs font-medium text-destructive">NSFW</span>
						{/if}
						{#if extension.use_proxy}
							<span transition:fade class="text-xs text-muted-foreground">•</span>
							<span transition:fade class="text-xs font-medium">PROXY</span>
						{/if}
					</Item.Description>
				</Item.Content>
			</Item.Root>

			<div class="m-2 flex justify-center gap-2 pt-2">
				<Toggle
					size="sm"
					bind:pressed={extension.use_proxy}
					onclick={() => handleToggleProxy(!extension.use_proxy)}
				>
					<Waypoints />
					<span class="hidden md:inline">Proxy</span>
				</Toggle>
				<Button
					size="sm"
					variant="ghost"
					onclick={handleDelete}
					disabled={loading}
					class="text-destructive"
				>
					{#if loading}
						<Spinner />
					{:else}
						<Trash2Icon />
					{/if}
				</Button>
			</div>
		</div>

		<div class="hidden md:inline">
			<Separator />
		</div>

		<ScrollArea scrollHideDelay={10} orientation="horizontal">
			<div class="flex space-x-4 p-2">
				{#each sortedSources as source (source.id)}
					<div class:animate-wiggle={extension.sources_has_prefs && configureMode}>
						<Button
							size="sm"
							variant={configureMode && extension.sources_has_prefs
								? 'outline'
								: !source.enabled
									? 'ghost'
									: 'default'}
							onclick={() => {
								if (configureMode) {
									preferencesSourceId = source.id;
									configureMode = false;
								} else {
									handleToggleSource(source.id, !source.enabled);
								}
							}}
							disabled={!extension.sources_has_prefs && configureMode}
						>
							<span class="uppercase">{source.lang}</span>
						</Button>
					</div>
				{/each}
			</div>
		</ScrollArea>
	</div>
	<Separator class="md:hidden" />
{:else}
	<div class="m-2 rounded-lg border bg-card">
		<div class="flex items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
			<Skeleton class="size-9 rounded bg-muted sm:size-10" />
			<div class="min-w-0 flex-1 space-y-1.5 sm:space-y-2">
				<Skeleton class="h-3.5 w-2/3 rounded bg-muted sm:h-4" />
				<div class="flex flex-wrap gap-1.5">
					<Skeleton class="h-3 w-14 animate-pulse rounded bg-muted" />
					<Skeleton class="h-3 w-10 animate-pulse rounded bg-muted" />
					<Skeleton class="h-3 w-8 animate-pulse rounded bg-muted" />
				</div>
			</div>
			<Skeleton class="h-7 w-16 rounded bg-muted" />
		</div>
	</div>
{/if}
