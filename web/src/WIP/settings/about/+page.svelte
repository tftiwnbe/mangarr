<script lang="ts">
	import SectionHeader from '$lib/components/section-header.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
</script>

<SectionHeader
	title="About Mangarr"
	description="Version, release notes, diagnostics, and community links."
/>

<div class="space-y-4">
	<div class="rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Version</h3>
		<div class="mt-3 grid gap-3 sm:grid-cols-3">
			<div class="rounded-lg border border-border/60 bg-card/90 p-3">
				<p class="text-xs tracking-wide text-muted-foreground uppercase">App</p>
				<p class="text-lg font-semibold">2.0.0</p>
				<p class="text-xs text-muted-foreground">Commit abc123</p>
			</div>
			<div class="rounded-lg border border-border/60 bg-card/90 p-3">
				<p class="text-xs tracking-wide text-muted-foreground uppercase">Extensions</p>
				<p class="text-lg font-semibold">15 installed</p>
				<p class="text-xs text-muted-foreground">3 updates available</p>
			</div>
			<div class="rounded-lg border border-border/60 bg-card/90 p-3">
				<p class="text-xs tracking-wide text-muted-foreground uppercase">Storage</p>
				<p class="text-lg font-semibold">512 GB</p>
				<p class="text-xs text-muted-foreground">45% used</p>
			</div>
		</div>
	</div>

	<div class="space-y-2 rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
			Release notes
		</h3>
		<ul class="space-y-1 text-sm text-muted-foreground">
			<li>✨ Redesigned discover hub and library layout.</li>
			<li>⚙️ Added downloads queue with bandwidth controls.</li>
			<li>🔌 Extensions marketplace with trust indicators.</li>
		</ul>
		<Button size="sm" variant="ghost">View full changelog</Button>
	</div>

	<div class="space-y-3 rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Diagnostics</h3>
		<div class="flex flex-wrap gap-2 text-sm text-muted-foreground">
			<Button size="sm" variant="secondary">Download logs</Button>
			<Button size="sm" variant="ghost">Copy system info</Button>
			<Button size="sm" variant="ghost">Run health check</Button>
		</div>
	</div>

	<div class="rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Community</h3>
		<ul class="mt-2 list-disc space-y-1 pl-6 text-sm text-muted-foreground">
			<li>Docs & tutorials</li>
			<li>GitHub issues</li>
			<li>Discord support</li>
		</ul>
	</div>
</div>
