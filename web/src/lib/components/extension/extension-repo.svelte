<script lang="ts">
	import { Button } from '$elements/button/index';
	import * as Dialog from '$elements/dialog/index';
	import * as Item from '$elements/item/index';
	import { Skeleton } from '$elements/skeleton/index.js';
	import { Spinner } from '$elements/spinner';
	import type { components } from '$lib/api/v2';
	import { CheckIcon, DownloadIcon } from '@lucide/svelte/icons';
	import type { ComponentProps } from 'svelte';

	type RepoExtensionResource = components['schemas']['RepoExtensionResource'];
	interface Props extends ComponentProps<typeof Dialog.Root> {
		extension?: RepoExtensionResource;
		installExtension?: (pkg: string) => Promise<boolean>;
	}
	let { extension = $bindable(), installExtension = async () => false }: Props = $props();
	let installingPkg: boolean = $state(false);
	let installError: string | null = $state(null);
	let errorTimeout: ReturnType<typeof setTimeout> | null = null;

	function clearErrorTimeout() {
		if (errorTimeout) {
			clearTimeout(errorTimeout);
			errorTimeout = null;
		}
	}

	function setErrorWithTimeout(message: string, duration: number = 5000) {
		clearErrorTimeout();
		installError = message;
		errorTimeout = setTimeout(() => {
			installError = null;
			errorTimeout = null;
		}, duration);
	}

	async function handleInstall(pkg: string) {
		if (extension) {
			installingPkg = true;
			clearErrorTimeout();
			installError = null;
			try {
				const result = await installExtension(pkg);
				if (!result) {
					setErrorWithTimeout('Failed to install extension. Please try again.');
				} else {
					extension.installed = true;
				}
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : 'An unexpected error occurred';
				setErrorWithTimeout(errorMessage);
				console.error('Extension installation failed:', error);
			} finally {
				installingPkg = false;
			}
		}
	}
</script>

{#if extension}
	<Item.Root variant="default" class="transition-colors hover:bg-accent/50">
		<Item.Media variant="image" class="flex-shrink-0">
			<img src={extension.icon} alt={extension.name} width="96" height="96" />
		</Item.Media>
		<Item.Content class="min-w-0 flex-1">
			<Item.Title class="line-clamp-1 text-sm sm:text-base">
				{extension.name}
			</Item.Title>
			<Item.Description class="flex flex-wrap items-center gap-1.5 sm:gap-2">
				{#if !installError}
					<span class="text-xs text-muted-foreground">Unknown</span>
					<span class="text-xs text-muted-foreground">•</span>
					<span class="text-xs text-muted-foreground">v{extension.version}</span>
					<span class="text-xs text-muted-foreground">•</span>
					<span class="text-xs font-medium uppercase">{extension.lang}</span>
					{#if extension.nsfw}
						<span class="text-xs text-muted-foreground">•</span>
						<span class="text-xs font-medium text-destructive">NSFW</span>
					{/if}
				{:else}
					<span class="text-xs text-destructive">
						{installError}
					</span>
				{/if}
			</Item.Description>
		</Item.Content>
		<Item.Actions>
			{#if extension.installed}
				<Button size="sm" variant="ghost" disabled>
					<CheckIcon />
					<span class="hidden sm:inline">Installed</span>
				</Button>
			{:else}
				<Button
					size="sm"
					variant="default"
					onclick={() => handleInstall(extension.pkg)}
					disabled={installingPkg || installError != null}
				>
					{#if installingPkg}
						<Spinner />
						<span class="hidden text-xs sm:inline sm:text-sm">Installing...</span>
					{:else}
						<DownloadIcon />
						<span class="hidden text-xs sm:inline sm:text-sm">Install</span>
					{/if}
				</Button>
			{/if}
		</Item.Actions>
	</Item.Root>
{:else}
	<div class="flex items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
		<Skeleton class="size-9 flex-shrink-0 rounded bg-muted sm:size-10" />
		<div class="min-w-0 flex-1 space-y-1.5 sm:space-y-2">
			<Skeleton class="h-3.5 w-2/3 rounded bg-muted sm:h-4" />
			<div class="flex flex-wrap gap-1.5">
				<Skeleton class="h-3 w-14 animate-pulse rounded bg-muted" />
				<Skeleton class="h-3 w-10 animate-pulse rounded bg-muted" />
				<Skeleton class="h-3 w-8 animate-pulse rounded bg-muted" />
			</div>
		</div>
		<Skeleton class="h-7 w-8 flex-shrink-0 rounded bg-muted sm:h-8 sm:w-20" />
	</div>
{/if}
