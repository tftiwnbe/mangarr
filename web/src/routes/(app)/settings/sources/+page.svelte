<script lang="ts">
	import { Switch } from '$lib/elements/switch/index.js';
	import { Input } from '$lib/elements/input/index.js';
	import { Button } from '$lib/elements/button/index.js';
	import { Badge } from '$lib/elements/badge/index.js';
	import { Separator } from '$lib/elements/separator/index.js';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
	import GlobeIcon from '@lucide/svelte/icons/globe';

	// Mock sources data
	let sources = $state([
		{ id: '1', name: 'MangaDex', enabled: true, priority: 1 },
		{ id: '2', name: 'MangaSee', enabled: true, priority: 2 },
		{ id: '3', name: 'MangaPlus', enabled: false, priority: 3 },
		{ id: '4', name: 'Webtoons', enabled: true, priority: 4 }
	]);

	let proxyEnabled = $state(false);
	let proxyUrl = $state('');
</script>

<div class="flex flex-col gap-8">
	<section class="flex flex-col gap-4">
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-lg font-medium">Sources</h2>
				<p class="text-sm text-muted-foreground">Manage your content sources</p>
			</div>
			<Button variant="outline" href="/extensions">
				Manage Extensions
			</Button>
		</div>

		<div class="flex flex-col rounded-lg border">
			{#each sources as source, i (source.id)}
				{#if i > 0}
					<Separator />
				{/if}
				<div class="flex items-center gap-4 p-4">
					<GripVerticalIcon class="size-4 shrink-0 cursor-grab text-muted-foreground" />
					<div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
						<GlobeIcon class="size-5 text-muted-foreground" />
					</div>
					<div class="min-w-0 flex-1">
						<p class="font-medium">{source.name}</p>
						<p class="text-sm text-muted-foreground">Priority: {source.priority}</p>
					</div>
					<Switch bind:checked={source.enabled} />
				</div>
			{/each}
		</div>
		<p class="text-xs text-muted-foreground">
			Drag to reorder. Higher priority sources will be searched first.
		</p>
	</section>

	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-lg font-medium">Proxy</h2>
			<p class="text-sm text-muted-foreground">Configure proxy settings for sources</p>
		</div>

		<div class="flex flex-col gap-4 rounded-lg border p-4">
			<div class="flex items-center justify-between">
				<div>
					<p class="font-medium">Enable Proxy</p>
					<p class="text-sm text-muted-foreground">Route requests through a proxy</p>
				</div>
				<Switch bind:checked={proxyEnabled} />
			</div>

			{#if proxyEnabled}
				<Separator />
				<div class="flex flex-col gap-2">
					<label for="proxy-url" class="text-sm font-medium">Proxy URL</label>
					<Input
						id="proxy-url"
						type="url"
						placeholder="http://proxy.example.com:8080"
						bind:value={proxyUrl}
					/>
				</div>
			{/if}
		</div>
	</section>

	<div class="flex justify-end">
		<Button>Save Changes</Button>
	</div>
</div>
