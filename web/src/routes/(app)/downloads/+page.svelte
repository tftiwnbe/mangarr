<script lang="ts">
	import { onMount } from 'svelte';

	import { PageHeader } from '$lib/components/page-header/index.js';
	import { Button } from '$lib/elements/button/index.js';
	import { Progress } from '$lib/elements/progress/index.js';
	import { Badge } from '$lib/elements/badge/index.js';
	import * as Tabs from '$lib/elements/tabs/index.js';
	import {
		cancelDownloadTask,
		downloadsDashboardStore,
		retryDownloadTask,
		runDownloadMonitor,
		runDownloadWorker
	} from '$lib/stores/downloads';
	import type { DownloadTaskStatus } from '$lib/api/downloads';

	import PlayIcon from '@lucide/svelte/icons/play';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import XIcon from '@lucide/svelte/icons/x';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import CircleSlashIcon from '@lucide/svelte/icons/circle-slash';

	let activeTab = $state<'active' | 'recent' | 'monitored'>('active');
	let isMutating = $state(false);

	const statusIcons = {
		downloading: LoaderIcon,
		queued: ClockIcon,
		completed: CheckCircleIcon,
		failed: AlertCircleIcon,
		cancelled: CircleSlashIcon
	};

	const statusColors = {
		downloading: 'text-blue-500',
		queued: 'text-muted-foreground',
		completed: 'text-green-500',
		failed: 'text-red-500',
		cancelled: 'text-yellow-500'
	};

	function getStatusLabel(status: DownloadTaskStatus): string {
		return status.charAt(0).toUpperCase() + status.slice(1);
	}

	async function safeMutation(task: () => Promise<void>): Promise<void> {
		if (isMutating) {
			return;
		}
		isMutating = true;
		try {
			await task();
		} finally {
			isMutating = false;
		}
	}

	onMount(() => {
		void downloadsDashboardStore.load();

		const interval = setInterval(() => {
			if (document.hidden) {
				return;
			}
			void downloadsDashboardStore.refresh();
		}, 15_000);

		return () => {
			clearInterval(interval);
		};
	});
</script>

<PageHeader
	title="Downloads"
	description="Queue status and monitored library downloads"
	breadcrumbs={[{ label: 'Downloads' }]}
>
	{#snippet actions()}
		<Button
			variant="outline"
			size="sm"
			onclick={() => {
				void safeMutation(async () => {
					await runDownloadMonitor();
				});
			}}
			disabled={isMutating}
		>
			<PlayIcon class="size-4" />
			Monitor
		</Button>
		<Button
			variant="outline"
			size="sm"
			onclick={() => {
				void safeMutation(async () => {
					await runDownloadWorker();
				});
			}}
			disabled={isMutating}
		>
			<DownloadIcon class="size-4" />
			Run Worker
		</Button>
		<Button
			variant="outline"
			size="icon"
			disabled={$downloadsDashboardStore.isRefreshing}
			onclick={() => {
				void downloadsDashboardStore.refresh();
			}}
		>
			<RefreshCwIcon class="size-4 {$downloadsDashboardStore.isRefreshing ? 'animate-spin' : ''}" />
		</Button>
	{/snippet}
</PageHeader>

<main class="flex flex-col gap-6 px-4 pb-24">
	{#if $downloadsDashboardStore.error && $downloadsDashboardStore.data.activeTasks.length === 0}
		<div class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
			<p class="font-medium">Failed to load download dashboard</p>
			<p class="text-muted-foreground">{$downloadsDashboardStore.error}</p>
		</div>
	{/if}

	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		{#each $downloadsDashboardStore.data.overview as item (item.label)}
			<div class="rounded-lg border bg-card p-4">
				<p class="text-sm text-muted-foreground">{item.label}</p>
				<p class="mt-2 text-2xl font-semibold">{item.value}</p>
			</div>
		{/each}
	</div>

	<Tabs.Root bind:value={activeTab}>
		<Tabs.List>
			<Tabs.Trigger value="active" class="gap-2">
				<LoaderIcon class="size-4" />
				Active
				{#if $downloadsDashboardStore.data.activeTasks.length > 0}
					<Badge variant="secondary" class="ml-1 size-5 justify-center rounded-full p-0 text-xs">
						{$downloadsDashboardStore.data.activeTasks.length}
					</Badge>
				{/if}
			</Tabs.Trigger>
			<Tabs.Trigger value="recent" class="gap-2">
				<ClockIcon class="size-4" />
				Recent
			</Tabs.Trigger>
			<Tabs.Trigger value="monitored" class="gap-2">
				<DownloadIcon class="size-4" />
				Monitored
			</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="active" class="mt-6">
			{#if $downloadsDashboardStore.data.activeTasks.length === 0}
				<div class="flex flex-col items-center justify-center py-16 text-center">
					<DownloadIcon class="mb-4 size-12 text-muted-foreground/50" />
					<p class="text-muted-foreground">
						{$downloadsDashboardStore.isLoading ? 'Loading active tasks...' : 'No active tasks'}
					</p>
				</div>
			{:else}
				<div class="flex flex-col gap-3">
					{#each $downloadsDashboardStore.data.activeTasks as item (item.id)}
						{@const StatusIcon = statusIcons[item.status]}
						<div class="flex gap-4 rounded-lg border bg-card p-4">
							<img src={item.cover} alt={item.title} class="size-16 shrink-0 rounded-md object-cover" />
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

								<div class="flex items-center gap-2">
									<Progress value={item.progressPercent} class="h-2 flex-1" />
									<span class="text-xs text-muted-foreground">{item.progressPercent}%</span>
								</div>
								<p class="text-xs text-muted-foreground">
									{item.downloadedPages}/{item.totalPages || '?'} pages
								</p>

								<div class="flex gap-2">
									{#if item.status === 'failed'}
										<Button
											variant="outline"
											size="sm"
											disabled={isMutating}
											onclick={() => {
												void safeMutation(async () => {
													await retryDownloadTask(item.id);
												});
											}}
										>
											<RefreshCwIcon class="size-3" />
											Retry
										</Button>
									{/if}

									<Button
										variant="ghost"
										size="sm"
										class="text-destructive"
										disabled={isMutating}
										onclick={() => {
											void safeMutation(async () => {
												await cancelDownloadTask(item.id);
											});
										}}
									>
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

		<Tabs.Content value="recent" class="mt-6">
			{#if $downloadsDashboardStore.data.recentTasks.length === 0}
				<div class="flex flex-col items-center justify-center py-16 text-center">
					<ClockIcon class="mb-4 size-12 text-muted-foreground/50" />
					<p class="text-muted-foreground">No recent download activity</p>
				</div>
			{:else}
				<div class="flex flex-col gap-3">
					{#each $downloadsDashboardStore.data.recentTasks as item (item.id)}
						{@const StatusIcon = statusIcons[item.status]}
						<div class="flex items-center gap-4 rounded-lg border bg-card p-4">
							<img src={item.cover} alt={item.title} class="size-12 shrink-0 rounded-md object-cover" />
							<div class="min-w-0 flex-1">
								<h3 class="truncate font-medium">{item.title}</h3>
								<p class="text-sm text-muted-foreground">{item.chapter}</p>
							</div>
							<div class="flex items-center gap-2 {statusColors[item.status]}">
								<StatusIcon class="size-4 {item.status === 'downloading' ? 'animate-spin' : ''}" />
								<span class="text-xs">{getStatusLabel(item.status)}</span>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</Tabs.Content>

		<Tabs.Content value="monitored" class="mt-6">
			{#if $downloadsDashboardStore.data.monitoredTitles.length === 0}
				<div class="flex flex-col items-center justify-center py-16 text-center">
					<DownloadIcon class="mb-4 size-12 text-muted-foreground/50" />
					<p class="text-muted-foreground">No monitored titles configured</p>
				</div>
			{:else}
				<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
					{#each $downloadsDashboardStore.data.monitoredTitles as item (item.titleId)}
						<div class="rounded-lg border bg-card p-4">
							<div class="mb-3 flex items-center gap-3">
								<img src={item.cover} alt={item.title} class="size-12 rounded-md object-cover" />
								<div class="min-w-0">
									<h3 class="truncate font-medium">{item.title}</h3>
									<p class="text-xs text-muted-foreground">
										{item.downloadedChapters}/{item.totalChapters} chapters downloaded
									</p>
								</div>
							</div>
							<div class="mb-3 flex flex-wrap gap-2 text-xs">
								<Badge variant={item.enabled ? 'default' : 'secondary'}>
									{item.enabled ? 'Enabled' : 'Disabled'}
								</Badge>
								<Badge variant="outline">Queued: {item.queuedTasks}</Badge>
								<Badge variant="outline">Failed: {item.failedTasks}</Badge>
							</div>
							{#if item.lastError}
								<p class="text-xs text-destructive">{item.lastError}</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</Tabs.Content>
	</Tabs.Root>
</main>
