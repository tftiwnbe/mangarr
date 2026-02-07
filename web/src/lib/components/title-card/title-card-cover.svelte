<script lang="ts">
	import { tv } from 'tailwind-variants';
	import { cn } from '$lib/utils';
	import type { HTMLImgAttributes } from 'svelte/elements';

	const mediaVariants = tv({
		base: 'absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover/manga-card:scale-105'
	});

	interface Props extends HTMLImgAttributes {
		ref?: HTMLImageElement | null;
		fallback?: string;
	}

	let {
		ref = $bindable(null),
		src,
		alt = '',
		class: className,
		fallback = 'https://uploads.mangadex.org/covers/2a62fa7f-ff92-4b2b-9073-049cdfff464c/cc649567-8612-40ce-9c55-a13a6f6e63ce.png.512.jpg',
		...restProps
	}: Props = $props();

	let imgSrc = $state(src);

	const mergedProps = $derived({
		class: cn(mediaVariants(), className),
		'data-slot': 'manga-card-media',
		...restProps
	});
</script>

<img
	bind:this={ref}
	{...mergedProps}
	src={imgSrc}
	{alt}
	onerror={() => {
		imgSrc = fallback;
	}}
/>
