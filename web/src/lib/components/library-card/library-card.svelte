<script lang="ts">
	import { cn } from '$lib/utils';
	import { Badge } from '$lib/elements/badge/index.js';
	import { Progress } from '$lib/elements/progress/index.js';
	import type { LibraryTitle } from '$lib/mock-data';

	interface Props {
		item: LibraryTitle;
		class?: string;
	}

	let { item, class: className }: Props = $props();

	const progressPercent = $derived(
		item.progress ? Math.round((item.progress.currentChapter / item.progress.totalChapters) * 100) : 0
	);

	const statusColors = {
		reading: 'bg-blue-500/90',
		completed: 'bg-green-500/90',
		'plan-to-read': 'bg-purple-500/90',
		'on-hold': 'bg-yellow-500/90',
		dropped: 'bg-red-500/90'
	} as const;

	const statusLabels = {
		reading: 'Reading',
		completed: 'Completed',
		'plan-to-read': 'Plan to Read',
		'on-hold': 'On Hold',
		dropped: 'Dropped'
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
			class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"
		></div>

		<!-- Status Badge -->
		<div class="absolute top-2 left-2">
			<Badge
				variant="secondary"
				class={cn('text-xs text-white', statusColors[item.readingStatus])}
			>
				{statusLabels[item.readingStatus]}
			</Badge>
		</div>

		<!-- Progress Bar (at bottom of cover) -->
		{#if item.progress && item.readingStatus !== 'completed'}
			<div class="absolute right-2 bottom-2 left-2">
				<div class="mb-1 flex justify-between text-xs text-white">
					<span>{item.progress.currentChapter}/{item.progress.totalChapters}</span>
					<span>{progressPercent}%</span>
				</div>
				<Progress value={progressPercent} class="h-1.5" />
			</div>
		{/if}
	</div>

	<!-- Title Info -->
	<div class="flex flex-col gap-0.5">
		<h3 class="line-clamp-2 text-sm font-medium leading-tight">{item.title}</h3>
		{#if item.author}
			<p class="line-clamp-1 text-xs text-muted-foreground">{item.author}</p>
		{/if}
	</div>
</a>
