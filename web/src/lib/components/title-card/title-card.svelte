<script lang="ts">
	import { setContext } from 'svelte';
	import { tv } from 'tailwind-variants';
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type MangaCardVariant = 'jellyseerr' | 'mangadex' | 'mangalib' | 'compact';
	type MangaCardSize = 'sm' | 'md' | 'lg';

	const mangaCardVariants = tv({
		base: 'group/manga-card relative transform-gpu cursor-pointer overflow-hidden bg-gray-800 bg-cover outline-none transition duration-300',
		variants: {
			variant: {
				jellyseerr:
					'rounded-xl shadow ring-1 ring-gray-700 hover:scale-105 hover:shadow-lg hover:ring-gray-500',
				mangadex: 'rounded-lg shadow-md hover:shadow-xl',
				mangalib: 'rounded-lg overflow-hidden hover:shadow-lg',
				compact: 'rounded-md shadow-sm hover:shadow-md'
			},
			size: {
				sm: 'w-28 sm:w-32',
				md: 'w-36 sm:w-36 md:w-44',
				lg: 'w-44 sm:w-48 md:w-56'
			},
			interactive: {
				true: 'cursor-pointer',
				false: 'cursor-default'
			}
		},
		defaultVariants: {
			variant: 'jellyseerr',
			size: 'md',
			interactive: true
		}
	});

	interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		ref?: HTMLDivElement | null;
		variant?: MangaCardVariant;
		size?: MangaCardSize;
		interactive?: boolean;
		href?: string;
		children?: Snippet;
	}

	let {
		ref = $bindable(null),
		class: className,
		variant,
		size,
		interactive = true,
		href,
		children,
		...restProps
	}: Props = $props();

	// Share context with child components
	setContext('manga-card', { variant, size, interactive, href });

	let showDetail = $state(false);

	const isTouch = $derived(typeof window !== 'undefined' && 'ontouchstart' in window);

	const cardProps = $derived({
		class: cn(mangaCardVariants({ variant, size, interactive }), className),
		'data-slot': 'manga-card',
		'data-variant': variant,
		'data-size': size,
		'data-interactive': interactive,
		'data-show-detail': showDetail,
		style: 'padding-bottom: 150%;',
		role: interactive ? 'button' : undefined,
		tabindex: interactive ? 0 : undefined
	});
</script>

<div
	bind:this={ref}
	class={cn(mangaCardVariants({ size }), 'relative')}
	data-manga-card-wrapper
	{...restProps}
>
	<div
		{...cardProps}
		onmouseenter={() => {
			if (!isTouch && interactive) showDetail = true;
		}}
		onmouseleave={() => {
			if (interactive) showDetail = false;
		}}
		onclick={() => {
			if (interactive) showDetail = true;
		}}
		onkeydown={(e) => {
			if (e.key === 'Enter' && interactive) showDetail = true;
		}}
	>
		<div class="absolute inset-0 h-full w-full overflow-hidden">
			{@render children?.()}
		</div>
	</div>
</div>
