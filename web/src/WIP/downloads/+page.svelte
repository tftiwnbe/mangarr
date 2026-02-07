<script lang="ts">
	import TagPill from '$elements/tag-pill.svelte';
	import { Button } from '$elements/button/index.js';

	const filters = ['All', 'Active', 'Scheduled', 'Completed', 'Failed'];

	const queue = [
		{
			title: 'Blazing Trails • Chapters 40-44',
			source: 'MangaDex',
			status: 'Active',
			progress: 68,
			speed: '2.4 MB/s',
			eta: '5m left'
		},
		{
			title: 'Sakura Courier • Chapter 20',
			source: 'Mangasee',
			status: 'Scheduled',
			progress: 0,
			speed: '—',
			eta: 'Queued'
		},
		{
			title: 'Ironbound • Chapter 90',
			source: 'MangaDex',
			status: 'Completed',
			progress: 100,
			speed: '—',
			eta: 'Finished 10m ago'
		},
		{
			title: 'Quantum Echoes • Chapter 32',
			source: 'Manganato',
			status: 'Failed',
			progress: 12,
			speed: '—',
			eta: 'Network error'
		}
	];

	const summary = [
		{ label: 'Active', value: '3' },
		{ label: 'Completed (24h)', value: '12' },
		{ label: 'Failed (24h)', value: '2' },
		{ label: 'Throughput', value: '1.8 GB' }
	];
</script>

<section class="space-y-6">
	<div class="flex items-start justify-between">
		<div>
			<h1 class="text-2xl font-semibold md:text-3xl">Downloads</h1>
			<p class="text-sm text-muted-foreground">Monitor chapters in flight and manage the queue.</p>
		</div>
	</div>

	<div
		class="grid gap-3 rounded-xl border border-border/60 bg-card/80 p-4 shadow-sm sm:grid-cols-4 sm:items-center"
	>
		{#each summary as item (item.label)}
			<div class="rounded-lg border border-border/60 bg-background/80 p-3">
				<p class="text-xs tracking-wide text-muted-foreground uppercase">{item.label}</p>
				<p class="mt-1 text-lg font-semibold">{item.value}</p>
			</div>
		{/each}
	</div>

	<div class="flex flex-wrap items-center gap-2">
		{#each filters as filter (filter)}
			<button type="button" class="focus-visible:outline-none" aria-pressed={filter === 'All'}>
				<TagPill tone={filter === 'All' ? 'neutral' : 'outline'} size="sm">
					{filter}
				</TagPill>
			</button>
		{/each}
		<div class="ml-auto flex items-center gap-2">
			<Button size="sm" variant="secondary">Pause all</Button>
			<Button size="sm" variant="ghost">Clear completed</Button>
		</div>
	</div>

	<div class="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
		<div class="space-y-3">
			{#each queue as item (item.title)}
				<div class="rounded-xl border border-border/60 bg-card/80 p-4 shadow-sm">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h3 class="text-base font-semibold">{item.title}</h3>
							<p class="text-xs tracking-wide text-muted-foreground uppercase">{item.source}</p>
						</div>
						<TagPill
							tone={item.status === 'Failed'
								? 'accent'
								: item.status === 'Active'
									? 'neutral'
									: 'outline'}
							size="sm"
						>
							{item.status}
						</TagPill>
					</div>
					<div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
						<div
							class="h-full rounded-full bg-primary transition-all"
							style={`width: ${item.progress}%`}
						></div>
					</div>
					<div class="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
						<span>{item.progress}%</span>
						<span>{item.speed}</span>
						<span>{item.eta}</span>
						<div class="ml-auto flex gap-2">
							<Button size="sm" variant="ghost">Pause</Button>
							<Button size="sm" variant="ghost">Prioritize</Button>
							<Button size="sm" variant="ghost">More</Button>
						</div>
					</div>
				</div>
			{/each}
		</div>
		<div class="space-y-3 rounded-xl border border-border/60 bg-card/80 p-4 shadow-sm">
			<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Bandwidth</h3>
			<div class="space-y-2">
				<div class="flex items-center justify-between text-sm">
					<span>Limit</span>
					<span>5 MB/s</span>
				</div>
				<div class="h-2 rounded-full bg-muted">
					<div class="h-full w-3/4 rounded-full bg-primary/80"></div>
				</div>
				<div class="flex items-center justify-between text-sm">
					<span>Current</span>
					<span>2.4 MB/s</span>
				</div>
			</div>
			<div class="space-y-2">
				<h4 class="text-sm font-medium">Recent activity</h4>
				<ul class="space-y-1 text-sm text-muted-foreground">
					<li>Completed Ironbound • Chapter 90 · 10m ago</li>
					<li>Rescheduled Sakura Courier • Chapter 20 · 18m ago</li>
					<li>Failed Quantum Echoes • Chapter 32 · Retry queued</li>
				</ul>
			</div>
			<div class="flex flex-wrap gap-2">
				<Button size="sm" variant="secondary">Adjust limit</Button>
				<Button size="sm" variant="ghost">View logs</Button>
			</div>
		</div>
	</div>
</section>
