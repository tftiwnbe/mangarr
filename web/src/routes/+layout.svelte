<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { setupConvexClient } from '$lib/convex/client';
	import { initI18n } from '$lib/i18n';
	import { initTheme } from '$lib/stores/theme';
	import { isLoading } from 'svelte-i18n';

	// Initialize i18n on app start
	initI18n();

	// Wire up theme reactivity (media query listener + DOM sync)
	initTheme();

	// Setup Convex client only on client-side to avoid SSR fetch warnings
	onMount(() => {
		setupConvexClient();
	});

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
