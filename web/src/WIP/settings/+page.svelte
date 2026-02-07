<script lang="ts">
	import SectionHeader from '$lib/components/section-header.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
</script>

<SectionHeader
	title="General preferences"
	description="Update global language, time zone, accessibility, and update preferences."
/>

<div class="space-y-4">
	<div class="rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Locale</h3>
		<div class="mt-3 grid gap-3 sm:grid-cols-2">
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium text-foreground">Language</span>
				<select class="rounded-md border border-border/60 bg-card/90 px-3 py-2 outline-none">
					<option>English</option>
					<option>Spanish</option>
					<option>Japanese</option>
				</select>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium text-foreground">Time zone</span>
				<select class="rounded-md border border-border/60 bg-card/90 px-3 py-2 outline-none">
					<option>America/Chicago</option>
					<option>America/New_York</option>
					<option>Europe/London</option>
				</select>
			</label>
		</div>
	</div>

	<div class="rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
			Accessibility
		</h3>
		<ul class="mt-3 space-y-2 text-sm text-muted-foreground">
			<li
				class="flex items-center justify-between rounded-lg border border-border/60 bg-card/90 p-3"
			>
				<span>Reduce motion</span>
				<Button size="sm" variant="ghost">Toggle</Button>
			</li>
			<li
				class="flex items-center justify-between rounded-lg border border-border/60 bg-card/90 p-3"
			>
				<span>High contrast mode</span>
				<Button size="sm" variant="ghost">Toggle</Button>
			</li>
			<li
				class="flex items-center justify-between rounded-lg border border-border/60 bg-card/90 p-3"
			>
				<span>Enable dyslexic-friendly font</span>
				<Button size="sm" variant="ghost">Toggle</Button>
			</li>
		</ul>
	</div>

	<div class="rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
			System updates
		</h3>
		<div class="mt-3 space-y-2 text-sm text-muted-foreground">
			<p>Manage how Mangarr fetches app and extension updates.</p>
			<div
				class="flex items-center justify-between rounded-lg border border-border/60 bg-card/90 p-3"
			>
				<span>Auto-download updates</span>
				<Button size="sm" variant="ghost">Disable</Button>
			</div>
			<div
				class="flex items-center justify-between rounded-lg border border-border/60 bg-card/90 p-3"
			>
				<span>Remind me about updates weekly</span>
				<Button size="sm" variant="ghost">Edit</Button>
			</div>
		</div>
	</div>

	<div class="flex gap-2">
		<Button size="sm" variant="secondary">Save changes</Button>
		<Button size="sm" variant="ghost">Cancel</Button>
	</div>
</div>
