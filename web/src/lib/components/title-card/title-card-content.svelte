<script lang="ts">
	import { tv } from 'tailwind-variants';
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type ContentPosition = 'top' | 'center' | 'bottom';
	type ContentPadding = 'sm' | 'md' | 'lg';

	const contentVariants = tv({
		base: 'flex h-full w-full',
		variants: {
			position: {
				top: 'items-start',
				center: 'items-center',
				bottom: 'items-end'
			},
			padding: {
				sm: 'p-1',
				md: 'p-2',
				lg: 'p-4'
			}
		},
		defaultVariants: {
			position: 'bottom',
			padding: 'md'
		}
	});

	interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		ref?: HTMLDivElement | null;
		position?: ContentPosition;
		padding?: ContentPadding;
		children?: Snippet;
	}

	let {
		ref = $bindable(null),
		class: className,
		position,
		padding,
		children,
		...restProps
	}: Props = $props();

	const wrapperProps = $derived({
		class: cn(contentVariants({ position, padding }), className),
		'data-slot': 'manga-card-content-wrapper',
		'data-position': position,
		...restProps
	});
</script>

<div bind:this={ref} {...wrapperProps}>
	<div class="text-white" data-slot="manga-card-content">
		{@render children?.()}
	</div>
</div>
