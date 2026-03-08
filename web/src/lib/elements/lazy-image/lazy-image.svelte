<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		src?: string;
		alt?: string;
		class?: string;
		imgClass?: string;
		loading?: 'lazy' | 'eager';
		decoding?: 'async' | 'auto' | 'sync';
	}

	let {
		src = '',
		alt = '',
		class: className = '',
		imgClass = '',
		loading = 'lazy',
		decoding = 'async'
	}: Props = $props();

	let container: HTMLDivElement | null = null;
	let shouldLoad = $state(loading === 'eager');
	let isLoaded = $state(false);
	let hasError = $state(false);
	let activeSrc = $state('');

	$effect(() => {
		const nextSrc = src.trim();
		if (!nextSrc) {
			if (!activeSrc) {
				isLoaded = false;
			}
			return;
		}
		if (loading === 'eager') {
			shouldLoad = true;
		}
		if (nextSrc === activeSrc) {
			return;
		}
		activeSrc = nextSrc;
		isLoaded = false;
		hasError = false;
	});

	onMount(() => {
		if (loading === 'eager' || shouldLoad) {
			return;
		}
		if (typeof IntersectionObserver === 'undefined') {
			shouldLoad = true;
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					shouldLoad = true;
					observer.disconnect();
				}
			},
			{ rootMargin: '320px 0px' }
		);
		if (container) {
			observer.observe(container);
		}
		return () => observer.disconnect();
	});
</script>

<div bind:this={container} class="relative overflow-hidden {className}">
	{#if !isLoaded}
		<div class="absolute inset-0 animate-pulse bg-[var(--void-3)]"></div>
	{/if}
	{#if shouldLoad && activeSrc}
		<img
			src={activeSrc}
			{alt}
			{loading}
			{decoding}
			class="h-full w-full object-cover transition-opacity duration-200 {isLoaded && !hasError
				? 'opacity-100'
				: 'opacity-0'} {imgClass}"
			onload={() => {
				isLoaded = true;
				hasError = false;
			}}
			onerror={() => {
				isLoaded = true;
				hasError = true;
			}}
		/>
	{/if}
	{#if hasError}
		<div class="absolute inset-0 flex items-center justify-center text-xs text-[var(--text-ghost)]">
			{alt || 'image'}
		</div>
	{/if}
</div>
