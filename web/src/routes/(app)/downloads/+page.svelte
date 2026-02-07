<script lang="ts">
	import { PageHeader } from '$lib/components/page-header/index.js';
	import { Button } from '$lib/elements/button/index.js';
	import { Progress } from '$lib/elements/progress/index.js';
	import { Badge } from '$lib/elements/badge/index.js';
	import * as Tabs from '$lib/elements/tabs/index.js';
	import { downloadQueue, completedDownloads, type DownloadItem } from '$lib/mock-data';

	import PlayIcon from '@lucide/svelte/icons/play';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import XIcon from '@lucide/svelte/icons/x';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import LoaderIcon from '@lucide/svelte/icons/loader';

	let activeTab = $state<'queue' | 'completed'>('queue');

	const statusIcons = {
		downloading: LoaderIcon,
		queued: ClockIcon,
		paused: PauseIcon,
		completed: CheckCircleIcon,
		failed: AlertCircleIcon
	};

	const statusColors = {
		downloading: 'text-blue-500',
		queued: 'text-muted-foreground',
		paused: 'text-yellow-500',
		completed: 'text-green-500',
		failed: 'text-red-500'
	};

	function getStatusLabel(status: DownloadItem['status']): string {
		return status.charAt(0).toUpperCase() + status.slice(1);
	}
</script>

<PageHeader
	title="Downloads"
	description="Manage your download queue"
	breadcrumbs={[{ label: 'Downloads' }]}
/>

<main class="flex flex-col gap-6 px-4 pb-24">
	<!-- Stats Bar -->
	<div class="flex flex-wrap gap-4 rounded-lg border bg-card p-4">
		<div class="flex items-center gap-2">
			<DownloadIcon class="size-4 text-muted-foreground" />
			<span class="text-sm">
				<span class="font-medium">{downloadQueue.filter((d) => d.status === 'downloading').length}</span>
				<span class="text-muted-foreground"> active</span>
			</span>
		</div>
		<div class="flex items-center gap-2">
			<ClockIcon class="size-4 text-muted-foreground" />
			<span class="text-sm">
				<span class="font-medium">{downloadQueue.filter((d) => d.status === 'queued').length}</span>
				<span class="text-muted-foreground"> queued</span>
			</span>
		</div>
		<div class="flex items-center gap-2">
			<CheckCircleIcon class="size-4 text-muted-foreground" />
			<span class="text-sm">
				<span class="font-medium">{completedDownloads.length}</span>
				<span class="text-muted-foreground"> completed</span>
			</span>
		</div>
	</div>

	<Tabs.Root bind:value={activeTab}>
		<Tabs.List>
			<Tabs.Trigger value="queue" class="gap-2">
				<DownloadIcon class="size-4" />
				Queue
				{#if downloadQueue.length > 0}
					<Badge variant="secondary" class="ml-1 size-5 justify-center rounded-full p-0 text-xs">
						{downloadQueue.length}
					</Badge>
				{/if}
			</Tabs.Trigger>
			<Tabs.Trigger value="completed" class="gap-2">
				<CheckCircleIcon class="size-4" />
				Completed
			</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="queue" class="mt-6">
			{#if downloadQueue.length === 0}
				<div class="flex flex-col items-center justify-center py-16 text-center">
					<DownloadIcon class="mb-4 size-12 text-muted-foreground/50" />
					<p class="text-muted-foreground">No downloads in queue</p>
				</div>
			{:else}
				<div class="flex flex-col gap-3">
					{#each downloadQueue as item (item.id)}
						{@const StatusIcon = statusIcons[item.status]}
						<div class="flex gap-4 rounded-lg border bg-card p-4">
							<!-- Cover -->
							<img
								src={item.cover}
								alt={item.title}
								class="size-16 shrink-0 rounded-md object-cover"
							/>

							<!-- Info -->
							<div class="flex min-w-0 flex-1 flex-col gap-2">
								<div class="flex items-start justify-between gap-2">
									<div class="min-w-0">
										<h3 class="truncate font-medium">{item.title}</h3>
										<p class="text-sm text-muted-foreground">{item.chapter}</p>
									</div>
									<div class="flex items-center gap-1 {statusColors[item.status]}">
										<StatusIcon class="size-4 {item.status === 'downloading' ? 'animate-spin' : ''}" />
										<span class="text-xs">{getStatusLabel(item.status)}</span>
									</div>
								</div>

								<!-- Progress Bar -->
								{#if item.status === 'downloading' || item.status === 'paused'}
									<div class="flex items-center gap-2">
										<Progress value={item.progress || 0} class="h-2 flex-1" />
										<span class="text-xs text-muted-foreground">{item.progress}%</span>
									</div>
									{#if item.speed && item.status === 'downloading'}
										<p class="text-xs text-muted-foreground">
											{item.speed} &bull; {item.size}
										</p>
									{/if}
								{:else if item.status === 'queued'}
									<p class="text-xs text-muted-foreground">{item.size}</p>
								{:else if item.status === 'failed'}
									<p class="text-xs text-red-500">{item.error}</p>
								{/if}

								<!-- Actions -->
								<div class="flex gap-2">
									{#if item.status === 'downloading'}
										<Button variant="outline" size="sm">
											<PauseIcon class="size-3" />
											Pause
										</Button>
									{:else if item.status === 'paused'}
										<Button variant="outline" size="sm">
											<PlayIcon class="size-3" />
											Resume
										</Button>
									{:else if item.status === 'failed'}
										<Button variant="outline" size="sm">
											<RefreshCwIcon class="size-3" />
											Retry
										</Button>
									{/if}
									<Button variant="ghost" size="sm" class="text-destructive">
										<XIcon class="size-3" />
										Cancel
									</Button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</Tabs.Content>

		<Tabs.Content value="completed" class="mt-6">
			{#if completedDownloads.length === 0}
				<div class="flex flex-col items-center justify-center py-16 text-center">
					<CheckCircleIcon class="mb-4 size-12 text-muted-foreground/50" />
					<p class="text-muted-foreground">No completed downloads</p>
				</div>
			{:else}
				<div class="mb-4 flex justify-end">
					<Button variant="outline" size="sm" class="gap-2">
						<TrashIcon class="size-3" />
						Clear All
					</Button>
				</div>
				<div class="flex flex-col gap-3">
					{#each completedDownloads as item (item.id)}
						<div class="flex items-center gap-4 rounded-lg border bg-card p-4">
							<!-- Cover -->
							<img
								src={item.cover}
								alt={item.title}
								class="size-12 shrink-0 rounded-md object-cover"
							/>

							<!-- Info -->
							<div class="min-w-0 flex-1">
								<h3 class="truncate font-medium">{item.title}</h3>
								<p class="text-sm text-muted-foreground">
									{item.chapter} &bull; {item.size}
								</p>
							</div>

							<!-- Status -->
							<CheckCircleIcon class="size-5 shrink-0 text-green-500" />
						</div>
					{/each}
				</div>
			{/if}
		</Tabs.Content>
	</Tabs.Root>
</main>
