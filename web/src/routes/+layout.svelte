<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { initI18n } from '$lib/i18n';
	import { isLoading } from 'svelte-i18n';

	// Initialize i18n on app start
	initI18n();

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if $isLoading}
	<!-- Minimal loading state while translations load -->
	<div class="flex min-h-svh items-center justify-center">
		<div
			class="border-primary size-8 animate-spin rounded-full border-2 border-t-transparent"
		></div>
	</div>
{:else}
	{@render children()}
{/if}
