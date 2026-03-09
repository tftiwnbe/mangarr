<script lang="ts">
	import type { Snippet } from 'svelte';
	import { SpinnerIcon } from 'phosphor-svelte';

	interface Props {
		isLoading: boolean;
		error?: string | null;
		/** Rendered when loading for the first time (no data yet). */
		loadingSnippet?: Snippet;
		/** Rendered in place of the error message when an error is set. */
		errorSnippet?: Snippet<[string]>;
		children: Snippet;
	}

	let { isLoading, error = null, loadingSnippet, errorSnippet, children }: Props = $props();
</script>

{#if isLoading}
	{#if loadingSnippet}
		{@render loadingSnippet()}
	{:else}
		<div class="flex justify-center py-12">
			<SpinnerIcon size={18} class="animate-spin text-[var(--text-ghost)]" />
		</div>
	{/if}
{:else if error}
	{#if errorSnippet}
		{@render errorSnippet(error)}
	{:else}
		<div class="flex flex-col items-center gap-2 py-12">
			<p class="text-sm text-[var(--error)]">{error}</p>
		</div>
	{/if}
{:else}
	{@render children()}
{/if}
