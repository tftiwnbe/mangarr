<script lang="ts">
	import { cn } from '$lib/utils';
	import { Badge } from '$lib/elements/badge/index.js';
	import type { Title } from '$lib/mock-data';

	interface Props {
		item: Title;
		class?: string;
	}

	let { item, class: className }: Props = $props();

	const statusColors = {
		ongoing: 'bg-blue-500/90',
		completed: 'bg-green-500/90',
		hiatus: 'bg-yellow-500/90'
	} as const;
</script>

<a
	href="/title/{item.id}"
	class={cn(
		'group relative flex w-32 shrink-0 flex-col gap-2 sm:w-36 md:w-40',
		className
	)}
>
	<!-- Cover Image -->
	<div class="relative aspect-[2/3] overflow-hidden rounded-lg bg-muted">
		<img
			src={item.cover}
			alt={item.title}
			class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
			loading="lazy"
		/>

		<!-- Gradient Overlay -->
		<div
			class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100"
		></div>

		<!-- Status Badge -->
		{#if item.status}
			<div class="absolute top-2 left-2">
				<Badge
					variant="secondary"
					class={cn('text-xs capitalize text-white', statusColors[item.status])}
				>
					{item.status}
				</Badge>
			</div>
		{/if}

		<!-- Chapter Count (on hover) -->
		{#if item.chapters}
			<div
				class="absolute right-2 bottom-2 opacity-0 transition-opacity group-hover:opacity-100"
			>
				<Badge variant="secondary" class="bg-black/70 text-xs text-white">
					{item.chapters} ch
				</Badge>
			</div>
		{/if}
	</div>

	<!-- Title Info -->
	<div class="flex flex-col gap-0.5">
		<h3 class="line-clamp-2 text-sm font-medium leading-tight">{item.title}</h3>
		{#if item.author}
			<p class="line-clamp-1 text-xs text-muted-foreground">{item.author}</p>
		{/if}
		{#if item.lastUpdated}
			<p class="text-xs text-muted-foreground">{item.lastUpdated}</p>
		{/if}
	</div>
</a>
