<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	onMount(() => {
		goto('/library', { replaceState: true });
	});
</script>

<div class="flex min-h-svh items-center justify-center bg-[var(--void-0)]">
	<div class="h-6 w-6 animate-spin border-2 border-[var(--void-6)] border-t-[var(--text-muted)]"></div>
</div>
