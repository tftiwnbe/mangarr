<script lang="ts">
	import SectionHeader from '$lib/components/section-header.svelte';
	import TagPill from '$lib/components/tag-pill.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	const logFilters = ['All', 'Info', 'Warning', 'Error'];
	const entries = [
		{
			id: 1,
			level: 'Info',
			message: 'Scheduled download job started',
			time: '12:40',
			detail: 'Job ID #4821'
		},
		{
			id: 2,
			level: 'Warning',
			message: 'Rate limit nearing threshold',
			time: '12:38',
			detail: 'Mangasee – 85% usage'
		},
		{
			id: 3,
			level: 'Error',
			message: 'Download failed',
			time: '12:35',
			detail: 'Quantum Echoes • Chapter 32 (network timeout)'
		}
	];
</script>

<SectionHeader
	title="Activity logs"
	description="Stay on top of system events, warnings, and errors."
	actionHref="/settings/logs"
	actionLabel="Export"
/>

<div class="space-y-4">
	<div class="flex flex-wrap items-center gap-2">
		{#each logFilters as filter (filter)}
			<button type="button" class="focus-visible:outline-none" aria-pressed={filter === 'All'}>
				<TagPill
					tone={filter === 'All' ? 'neutral' : filter === 'Error' ? 'accent' : 'outline'}
					size="sm"
				>
					{filter}
				</TagPill>
			</button>
		{/each}
		<div class="ml-auto flex gap-2">
			<Button size="sm" variant="secondary">Download CSV</Button>
			<Button size="sm" variant="ghost">Auto-refresh</Button>
		</div>
	</div>

	<div class="space-y-2">
		{#each entries as entry (entry.id)}
			<div class="rounded-lg border border-border/60 bg-card/80 p-4">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h4 class="text-sm font-semibold text-foreground">{entry.message}</h4>
						<p class="text-xs tracking-wide text-muted-foreground uppercase">{entry.time}</p>
					</div>
					<TagPill
						tone={entry.level === 'Error'
							? 'accent'
							: entry.level === 'Warning'
								? 'outline'
								: 'neutral'}
						size="sm"
					>
						{entry.level}
					</TagPill>
				</div>
				<p class="mt-2 text-sm text-muted-foreground">{entry.detail}</p>
				<div class="mt-3 flex gap-2">
					<Button size="sm" variant="ghost">View details</Button>
					<Button size="sm" variant="ghost">Copy</Button>
				</div>
			</div>
		{/each}
	</div>
</div>
