<script lang="ts">
	import { Switch } from '$lib/elements/switch/index.js';
	import { Input } from '$lib/elements/input/index.js';
	import { Button } from '$lib/elements/button/index.js';
	import * as Select from '$lib/elements/select/index.js';
	import { Separator } from '$lib/elements/separator/index.js';

	let autoUpdate = $state(true);
	let updateInterval = $state('6');
	let maxConcurrentDownloads = $state('3');
	let notificationsEnabled = $state(true);
</script>

<div class="flex flex-col gap-8">
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-lg font-medium">Updates</h2>
			<p class="text-sm text-muted-foreground">Configure how the app checks for updates</p>
		</div>

		<div class="flex flex-col gap-4 rounded-lg border p-4">
			<div class="flex items-center justify-between">
				<div>
					<p class="font-medium">Automatic Updates</p>
					<p class="text-sm text-muted-foreground">Check for library updates automatically</p>
				</div>
				<Switch bind:checked={autoUpdate} />
			</div>

			{#if autoUpdate}
				<Separator />
				<div class="flex items-center justify-between">
					<div>
						<p class="font-medium">Update Interval</p>
						<p class="text-sm text-muted-foreground">How often to check for updates</p>
					</div>
					<Select.Root type="single" bind:value={updateInterval}>
						<Select.Trigger class="w-32">
							{updateInterval} hours
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="1">1 hour</Select.Item>
							<Select.Item value="3">3 hours</Select.Item>
							<Select.Item value="6">6 hours</Select.Item>
							<Select.Item value="12">12 hours</Select.Item>
							<Select.Item value="24">24 hours</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>
			{/if}
		</div>
	</section>

	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-lg font-medium">Downloads</h2>
			<p class="text-sm text-muted-foreground">Configure download behavior</p>
		</div>

		<div class="flex flex-col gap-4 rounded-lg border p-4">
			<div class="flex items-center justify-between">
				<div>
					<p class="font-medium">Concurrent Downloads</p>
					<p class="text-sm text-muted-foreground">Maximum simultaneous downloads</p>
				</div>
				<Select.Root type="single" bind:value={maxConcurrentDownloads}>
					<Select.Trigger class="w-20">
						{maxConcurrentDownloads}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="1">1</Select.Item>
						<Select.Item value="2">2</Select.Item>
						<Select.Item value="3">3</Select.Item>
						<Select.Item value="5">5</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>
		</div>
	</section>

	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-lg font-medium">Notifications</h2>
			<p class="text-sm text-muted-foreground">Configure notification preferences</p>
		</div>

		<div class="flex flex-col gap-4 rounded-lg border p-4">
			<div class="flex items-center justify-between">
				<div>
					<p class="font-medium">Push Notifications</p>
					<p class="text-sm text-muted-foreground">Get notified about new chapters</p>
				</div>
				<Switch bind:checked={notificationsEnabled} />
			</div>
		</div>
	</section>

	<div class="flex justify-end">
		<Button>Save Changes</Button>
	</div>
</div>
