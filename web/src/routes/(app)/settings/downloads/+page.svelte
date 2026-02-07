<script lang="ts">
	import { Switch } from '$lib/elements/switch/index.js';
	import { Input } from '$lib/elements/input/index.js';
	import { Button } from '$lib/elements/button/index.js';
	import * as Select from '$lib/elements/select/index.js';
	import { Separator } from '$lib/elements/separator/index.js';

	import FolderIcon from '@lucide/svelte/icons/folder';

	let downloadPath = $state('/downloads');
	let saveChaptersAs = $state('cbz');
	let deleteAfterRead = $state(false);
	let downloadOnWifiOnly = $state(true);
	let maxParallelDownloads = $state('3');
</script>

<div class="flex flex-col gap-8">
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-lg font-medium">Storage</h2>
			<p class="text-sm text-muted-foreground">Configure where downloads are saved</p>
		</div>

		<div class="flex flex-col gap-4 rounded-lg border p-4">
			<div class="flex flex-col gap-2">
				<label for="download-path" class="text-sm font-medium">Download Location</label>
				<div class="flex gap-2">
					<Input
						id="download-path"
						bind:value={downloadPath}
						class="flex-1"
						readonly
					/>
					<Button variant="outline" size="icon">
						<FolderIcon class="size-4" />
					</Button>
				</div>
			</div>

			<Separator />

			<div class="flex items-center justify-between">
				<div>
					<p class="font-medium">Save Format</p>
					<p class="text-sm text-muted-foreground">Format for saving chapters</p>
				</div>
				<Select.Root type="single" bind:value={saveChaptersAs}>
					<Select.Trigger class="w-28">
						{saveChaptersAs.toUpperCase()}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="cbz">CBZ</Select.Item>
						<Select.Item value="pdf">PDF</Select.Item>
						<Select.Item value="folder">Folder</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>
		</div>
	</section>

	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-lg font-medium">Behavior</h2>
			<p class="text-sm text-muted-foreground">Configure download behavior</p>
		</div>

		<div class="flex flex-col gap-4 rounded-lg border p-4">
			<div class="flex items-center justify-between">
				<div>
					<p class="font-medium">Delete After Reading</p>
					<p class="text-sm text-muted-foreground">Remove chapters after they're read</p>
				</div>
				<Switch bind:checked={deleteAfterRead} />
			</div>

			<Separator />

			<div class="flex items-center justify-between">
				<div>
					<p class="font-medium">Wi-Fi Only</p>
					<p class="text-sm text-muted-foreground">Only download on Wi-Fi connections</p>
				</div>
				<Switch bind:checked={downloadOnWifiOnly} />
			</div>

			<Separator />

			<div class="flex items-center justify-between">
				<div>
					<p class="font-medium">Parallel Downloads</p>
					<p class="text-sm text-muted-foreground">Maximum simultaneous downloads</p>
				</div>
				<Select.Root type="single" bind:value={maxParallelDownloads}>
					<Select.Trigger class="w-20">
						{maxParallelDownloads}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="1">1</Select.Item>
						<Select.Item value="2">2</Select.Item>
						<Select.Item value="3">3</Select.Item>
						<Select.Item value="5">5</Select.Item>
						<Select.Item value="10">10</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>
		</div>
	</section>

	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-lg font-medium">Cleanup</h2>
			<p class="text-sm text-muted-foreground">Manage downloaded content</p>
		</div>

		<div class="flex flex-col gap-4 rounded-lg border p-4">
			<div class="flex items-center justify-between">
				<div>
					<p class="font-medium">Clear Download Cache</p>
					<p class="text-sm text-muted-foreground">Remove temporary download files</p>
				</div>
				<Button variant="outline">Clear Cache</Button>
			</div>
		</div>
	</section>

	<div class="flex justify-end">
		<Button>Save Changes</Button>
	</div>
</div>
