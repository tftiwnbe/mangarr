<script lang="ts">
	import { tv } from 'tailwind-variants';
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type BadgeColor = 'blue' | 'purple' | 'green' | 'red' | 'yellow';
	type BadgePosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

	const badgeVariants = tv({
		base: 'absolute z-10 pointer-events-none rounded-full border bg-opacity-80 shadow-md',
		variants: {
			color: {
				blue: 'border-blue-500 bg-blue-600',
				purple: 'border-purple-600 bg-purple-600',
				green: 'border-green-600 bg-green-600',
				red: 'border-red-600 bg-red-600',
				yellow: 'border-yellow-600 bg-yellow-600'
			},
			position: {
				'top-left': 'top-2 left-2',
				'top-right': 'top-2 right-2',
				'bottom-left': 'bottom-2 left-2',
				'bottom-right': 'bottom-2 right-2'
			}
		},
		defaultVariants: {
			color: 'blue',
			position: 'top-left'
		}
	});

	interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		ref?: HTMLDivElement | null;
		color?: BadgeColor;
		position?: BadgePosition;
		children?: Snippet;
	}

	let {
		ref = $bindable(null),
		class: className,
		color,
		position,
		children,
		...restProps
	}: Props = $props();

	const mergedProps = $derived({
		class: cn(badgeVariants({ color, position }), className),
		'data-slot': 'manga-card-badge',
		'data-color': color,
		'data-position': position,
		...restProps
	});
</script>

<div bind:this={ref} {...mergedProps}>
	<div
		class="flex h-4 items-center px-2 py-2 text-center text-xs font-medium tracking-wider text-white uppercase sm:h-5"
	>
		{@render children?.()}
	</div>
</div>
