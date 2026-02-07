<script lang="ts">
	import SectionHeader from '$lib/components/section-header.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
</script>

<SectionHeader
	title="Network configuration"
	description="Configure proxies, throttle bandwidth, and test connectivity with your sources."
/>

<div class="space-y-4">
	<div class="rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Proxy</h3>
		<div class="mt-3 grid gap-3 sm:grid-cols-2">
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium text-foreground">Proxy URL</span>
				<input
					class="rounded-md border border-border/60 bg-card/90 px-3 py-2 outline-none"
					placeholder="https://user:pass@example:8080"
				/>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium text-foreground">Bypass domains</span>
				<input
					class="rounded-md border border-border/60 bg-card/90 px-3 py-2 outline-none"
					placeholder="example.com, localhost"
				/>
			</label>
		</div>
		<div class="mt-3 flex gap-2">
			<Button size="sm" variant="secondary">Test connection</Button>
			<Button size="sm" variant="ghost">Disable proxy</Button>
		</div>
	</div>

	<div class="rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Bandwidth</h3>
		<div class="mt-3 space-y-3">
			<div class="flex items-center justify-between text-sm text-muted-foreground">
				<span>Download limit</span>
				<span>5 MB/s</span>
			</div>
			<div class="h-2 rounded-full bg-muted">
				<div class="h-full w-3/4 rounded-full bg-primary/80"></div>
			</div>
			<div class="flex items-center justify-between text-sm text-muted-foreground">
				<span>Upload limit</span>
				<span>1 MB/s</span>
			</div>
			<div class="h-2 rounded-full bg-muted">
				<div class="h-full w-1/2 rounded-full bg-primary/40"></div>
			</div>
		</div>
		<div class="mt-3 flex gap-2">
			<Button size="sm" variant="secondary">Adjust limits</Button>
			<Button size="sm" variant="ghost">Reset</Button>
		</div>
	</div>

	<div class="rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
			API endpoints
		</h3>
		<div class="mt-3 space-y-2 text-sm text-muted-foreground">
			<div class="rounded-lg border border-border/60 bg-card/90 p-3">
				<p class="font-medium text-foreground">Metadata</p>
				<p>https://api.mangarr.dev/v1/meta</p>
			</div>
			<div class="rounded-lg border border-border/60 bg-card/90 p-3">
				<p class="font-medium text-foreground">Search proxy</p>
				<p>https://proxy.mangarr.dev/search</p>
			</div>
			<div class="rounded-lg border border-dashed border-border/60 bg-card/60 p-3">
				Use custom endpoints to route through your own infrastructure. Authentication headers can be
				configured per extension.
			</div>
		</div>
	</div>

	<div class="flex gap-2">
		<Button size="sm" variant="secondary">Save configuration</Button>
		<Button size="sm" variant="ghost">Cancel</Button>
	</div>
</div>
