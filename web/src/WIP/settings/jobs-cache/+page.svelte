<script lang="ts">
	import SectionHeader from '$lib/components/section-header.svelte';
	import TagPill from '$lib/components/tag-pill.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	const queues = [
		{ name: 'Active', count: 3 },
		{ name: 'Pending', count: 18 },
		{ name: 'Failed', count: 1 }
	];

	const cacheEntries = [
		{ name: 'Cover art', size: '1.2 GB', lastRefresh: '2 days ago' },
		{ name: 'Metadata', size: '640 MB', lastRefresh: '12 hours ago' },
		{ name: 'Search index', size: '320 MB', lastRefresh: '4 hours ago' }
	];
</script>

<SectionHeader
	title="Jobs & cache"
	description="Check background queue health and manage cached resources."
/>

<div class="space-y-4">
	<div class="rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Queues</h3>
		<div class="mt-3 flex flex-wrap gap-2">
			{#each queues as queue (queue.name)}
				<TagPill tone={queue.name === 'Failed' ? 'accent' : 'neutral'} size="sm">
					{queue.name} · {queue.count}
				</TagPill>
			{/each}
		</div>
		<div class="mt-4 flex gap-2">
			<Button size="sm" variant="secondary">Retry failed</Button>
			<Button size="sm" variant="ghost">Pause all jobs</Button>
			<Button size="sm" variant="ghost">View workers</Button>
		</div>
	</div>

	<div class="space-y-3 rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
			Cache overview
		</h3>
		{#each cacheEntries as entry (entry.name)}
			<div class="rounded-lg border border-border/60 bg-card/90 p-3">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h4 class="text-sm font-semibold">{entry.name}</h4>
						<p class="text-xs tracking-wide text-muted-foreground uppercase">{entry.lastRefresh}</p>
					</div>
					<span class="text-sm text-muted-foreground">{entry.size}</span>
				</div>
				<div class="mt-2 flex gap-2">
					<Button size="sm" variant="ghost">Warm cache</Button>
					<Button size="sm" variant="ghost">Clear</Button>
				</div>
			</div>
		{/each}
	</div>

	<div
		class="rounded-lg border border-dashed border-border/60 bg-background/60 p-4 text-sm text-muted-foreground"
	>
		Automation tip: schedule cache warmups after installing new extensions or migrating to new
		storage.
	</div>
</div>
