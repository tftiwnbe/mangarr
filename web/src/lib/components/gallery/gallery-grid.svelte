<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';

	let {
		children,
		columns = { sm: 2, md: 3, lg: 4, xl: 5 },
		gap = 4,
		class: className
	}: {
		children: Snippet;
		columns?: { sm?: number; md?: number; lg?: number; xl?: number };
		gap?: number;
		class?: string;
	} = $props();

	const gridClass = $derived(
		cn(
			'grid',
			`gap-${gap}`,
			`grid-cols-${columns.sm || 2}`,
			`md:grid-cols-${columns.md || 3}`,
			`lg:grid-cols-${columns.lg || 4}`,
			`xl:grid-cols-${columns.xl || 5}`,
			className
		)
	);
</script>

<div class={gridClass}>
	{@render children()}
</div>
