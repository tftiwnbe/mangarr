<script lang="ts" module>
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	export type PageHeaderProps = WithElementRef<HTMLAttributes<HTMLElement>> & {
		title: string;
		description: string;
	};
</script>

<script lang="ts">
	let {
		class: className,
		title,
		description,
		ref = $bindable(null),
		children,
		...restProps
	}: PageHeaderProps = $props();
</script>

<header
	bind:this={ref}
	class={cn('sticky top-0 z-50 flex flex-col gap-2 rounded-lg bg-background  py-4', className)}
	{...restProps}
>
	<div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
		<div class="flex items-center justify-between gap-2 px-4 sm:block sm:gap-1">
			<h2 class="text-3xl font-semibold lg:text-xl">{title}</h2>
			<div class="flex gap-2 sm:hidden">
				{@render children?.()}
			</div>
			<p class="hidden text-sm text-muted-foreground lg:block">
				{description}
			</p>
		</div>
		<div class="hidden gap-2 px-4 sm:flex">
			{@render children?.()}
		</div>
	</div>
</header>
