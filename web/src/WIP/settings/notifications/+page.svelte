<script lang="ts">
	import SectionHeader from '$lib/components/section-header.svelte';
	import TagPill from '$lib/components/tag-pill.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	const channels = ['Email', 'Push', 'In-app', 'Webhook'];
	const events = [
		{
			name: 'New chapter available',
			description: 'Receive alerts when followed titles release chapters.'
		},
		{ name: 'Download complete', description: 'Notify when queued downloads finish.' },
		{ name: 'Extension update', description: 'Get reminded when sources have updates pending.' },
		{ name: 'System alerts', description: 'Maintenance windows, errors, and critical notices.' }
	];
</script>

<SectionHeader
	title="Notifications"
	description="Control which events trigger alerts and the channels they use."
/>

<div class="space-y-4">
	<div class="rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Channels</h3>
		<div class="mt-3 flex flex-wrap gap-2">
			{#each channels as channel (channel)}
				<button
					type="button"
					class="focus-visible:outline-none"
					aria-pressed={channel !== 'Webhook'}
				>
					<TagPill tone={channel === 'Webhook' ? 'outline' : 'neutral'} size="sm">
						{channel}
					</TagPill>
				</button>
			{/each}
		</div>
		<div class="mt-4 space-y-2 text-sm text-muted-foreground">
			<p>Configure webhook URL and secret:</p>
			<input
				class="w-full rounded-md border border-border/60 bg-card/90 px-3 py-2 outline-none"
				placeholder="https://example.com/webhook"
			/>
		</div>
	</div>

	<div class="space-y-3 rounded-lg border border-border/60 bg-background/80 p-4">
		{#each events as event (event.name)}
			<div class="rounded-lg border border-border/60 bg-card/90 p-3">
				<div class="flex items-start justify-between gap-3">
					<div>
						<h4 class="text-sm font-semibold">{event.name}</h4>
						<p class="text-sm text-muted-foreground">{event.description}</p>
					</div>
					<Button size="sm" variant="ghost">Toggle</Button>
				</div>
			</div>
		{/each}
	</div>

	<div class="rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Quiet hours</h3>
		<div class="mt-3 grid gap-3 sm:grid-cols-2">
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium text-foreground">Start</span>
				<input
					class="rounded-md border border-border/60 bg-card/90 px-3 py-2 outline-none"
					placeholder="22:00"
				/>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium text-foreground">End</span>
				<input
					class="rounded-md border border-border/60 bg-card/90 px-3 py-2 outline-none"
					placeholder="07:00"
				/>
			</label>
		</div>
		<p class="mt-3 text-sm text-muted-foreground">
			Quiet hours snooze push notifications while still logging events in the in-app feed.
		</p>
	</div>

	<div class="flex gap-2">
		<Button size="sm" variant="secondary">Save preferences</Button>
		<Button size="sm" variant="ghost">Discard</Button>
	</div>
</div>
