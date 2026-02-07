<script lang="ts">
	import { tv } from 'tailwind-variants';
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type ActionsPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

	const actionsVariants = tv({
		base: 'absolute z-20 flex flex-col gap-1',
		variants: {
			position: {
				'top-right': 'top-2 right-2',
				'top-left': 'top-2 left-2',
				'bottom-right': 'bottom-2 right-2',
				'bottom-left': 'bottom-2 left-2'
			}
		},
		defaultVariants: {
			position: 'top-right'
		}
	});

	interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		ref?: HTMLDivElement | null;
		position?: ActionsPosition;
		children?: Snippet;
	}

	let {
		ref = $bindable(null),
		class: className,
		position,
		children,
		...restProps
	}: Props = $props();

	const mergedProps = $derived({
		class: cn(actionsVariants({ position }), className),
		'data-slot': 'manga-card-actions',
		'data-position': position,
		...restProps
	});
</script>

<div bind:this={ref} {...mergedProps}>
	{@render children?.()}
</div>
