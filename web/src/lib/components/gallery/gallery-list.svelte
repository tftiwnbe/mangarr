<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';

	let {
		children,
		gap = 2,
		class: className
	}: {
		children: Snippet;
		gap?: number;
		class?: string;
	} = $props();
</script>

<div class={cn(`space-y-${gap}`, className)}>
	{@render children()}
</div>
