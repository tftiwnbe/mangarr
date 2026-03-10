<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { setupConvexClient } from '$lib/convex/client';

	let { children } = $props();

	setupConvexClient();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
