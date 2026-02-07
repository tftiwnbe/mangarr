<script lang="ts">
	import { tv } from 'tailwind-variants';
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type OverlayGradient = 'light' | 'medium' | 'heavy' | 'none';

	const overlayVariants = tv({
		base: 'absolute inset-0 overflow-hidden rounded-xl transition-opacity duration-200',
		variants: {
			gradient: {
				light: '',
				medium: '',
				heavy: '',
				none: 'bg-transparent'
			},
			show: {
				true: 'opacity-100',
				false: 'opacity-0 pointer-events-none'
			}
		},
		defaultVariants: {
			gradient: 'medium',
			show: true
		}
	});

	const gradientStyles = {
		light: 'linear-gradient(180deg, rgba(45, 55, 72, 0.2) 0%, rgba(45, 55, 72, 0.7) 100%)',
		medium: 'linear-gradient(180deg, rgba(45, 55, 72, 0.4) 0%, rgba(45, 55, 72, 0.9) 100%)',
		heavy: 'linear-gradient(180deg, rgba(45, 55, 72, 0.6) 0%, rgba(45, 55, 72, 1) 100%)',
		none: 'none'
	};

	interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		ref?: HTMLDivElement | null;
		show?: boolean;
		gradient?: OverlayGradient;
		children?: Snippet;
	}

	let {
		ref = $bindable(null),
		class: className,
		show = false,
		gradient = 'medium',
		children,
		...restProps
	}: Props = $props();

	const mergedProps = $derived({
		class: cn(overlayVariants({ gradient, show }), className),
		style: `background: ${gradientStyles[gradient]};`,
		'data-slot': 'manga-card-overlay',
		'data-gradient': gradient,
		...restProps
	});
</script>

{#if show}
	<div bind:this={ref} {...mergedProps}>
		{@render children?.()}
	</div>
{/if}
