<script lang="ts">
	import { cn } from '$lib/utils';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Snippet } from 'svelte';

	let {
		children,
		itemsPerView = { sm: 2, md: 3, lg: 4, xl: 5 },
		gap = 4,
		showArrows = true,
		autoScroll = false,
		class: className
	}: {
		children: Snippet;
		itemsPerView?: { sm?: number; md?: number; lg?: number; xl?: number };
		gap?: number;
		showArrows?: boolean;
		autoScroll?: boolean;
		class?: string;
	} = $props();

	let scrollContainer = $state<HTMLDivElement>();
	let canScrollLeft = $state(false);
	let canScrollRight = $state(true);

	function updateScrollButtons() {
		if (!scrollContainer) return;
		canScrollLeft = scrollContainer.scrollLeft > 0;
		canScrollRight =
			scrollContainer.scrollLeft < scrollContainer.scrollWidth - scrollContainer.clientWidth - 1;
	}

	function scroll(direction: 'left' | 'right') {
		if (!scrollContainer) return;
		const scrollAmount = scrollContainer.clientWidth * 0.8;
		scrollContainer.scrollBy({
			left: direction === 'left' ? -scrollAmount : scrollAmount,
			behavior: 'smooth'
		});
	}

	$effect(() => {
		if (!scrollContainer) return;
		updateScrollButtons();
		scrollContainer.addEventListener('scroll', updateScrollButtons);
		return () => scrollContainer?.removeEventListener('scroll', updateScrollButtons);
	});
</script>

<div class={cn('group relative', className)}>
	{#if showArrows && canScrollLeft}
		<button
			type="button"
			onclick={() => scroll('left')}
			class="absolute top-1/2 left-0 z-10 -translate-y-1/2 rounded-full bg-background/80 p-2 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 hover:bg-background"
			aria-label="Scroll left"
		>
			<ChevronLeftIcon class="size-5" />
		</button>
	{/if}

	{#if showArrows && canScrollRight}
		<button
			type="button"
			onclick={() => scroll('right')}
			class="absolute top-1/2 right-0 z-10 -translate-y-1/2 rounded-full bg-background/80 p-2 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 hover:bg-background"
			aria-label="Scroll right"
		>
			<ChevronRightIcon class="size-5" />
		</button>
	{/if}

	<div
		bind:this={scrollContainer}
		class="scrollbar-hide flex snap-x snap-mandatory overflow-x-auto"
		style="gap: {gap * 0.25}rem; scroll-padding: {gap * 0.25}rem;"
	>
		<div
			class={cn(
				'flex-none snap-start',
				`w-[calc(50%-${gap * 0.125}rem)]`,
				`md:w-[calc(33.333%-${gap * 0.167}rem)]`,
				`lg:w-[calc(25%-${gap * 0.188}rem)]`,
				`xl:w-[calc(20%-${gap * 0.2}rem)]`
			)}
		>
			{@render children()}
		</div>
	</div>
</div>

<style>
	.scrollbar-hide {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
	.scrollbar-hide::-webkit-scrollbar {
		display: none;
	}
</style>
