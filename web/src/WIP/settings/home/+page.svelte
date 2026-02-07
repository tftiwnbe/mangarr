<script lang="ts">
	import SectionHeader from '$lib/components/section-header.svelte';
	import TagPill from '$lib/components/tag-pill.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	const modules = [
		{
			title: 'Continue reading',
			description: 'Show active series progress on the dashboard.',
			enabled: true
		},
		{
			title: 'Popular today',
			description: 'Highlight trending titles across sources.',
			enabled: true
		},
		{
			title: 'Quick actions',
			description: 'Buttons for search, add source, and import lists.',
			enabled: false
		},
		{
			title: 'Announcements',
			description: 'Display release notes and maintenance alerts.',
			enabled: false
		}
	];
</script>

<SectionHeader
	title="Home layout"
	description="Choose which blocks appear on the dashboard and how they’re ordered."
/>

<div class="space-y-4">
	<div class="rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
			Default landing page
		</h3>
		<div class="mt-3 flex flex-wrap gap-2">
			<TagPill tone="neutral" size="sm">Discover</TagPill>
			<TagPill tone="outline" size="sm">Library</TagPill>
			<TagPill tone="outline" size="sm">Downloads</TagPill>
		</div>
	</div>

	<div class="space-y-3">
		{#each modules as module (module.title)}
			<div class="rounded-lg border border-border/60 bg-background/80 p-4">
				<div class="flex items-start justify-between gap-3">
					<div>
						<h4 class="text-sm font-semibold">{module.title}</h4>
						<p class="text-sm text-muted-foreground">{module.description}</p>
					</div>
					<TagPill tone={module.enabled ? 'neutral' : 'outline'} size="sm">
						{module.enabled ? 'Enabled' : 'Disabled'}
					</TagPill>
				</div>
				<div class="mt-3 flex gap-2">
					<Button size="sm" variant="secondary">Configure</Button>
					<Button size="sm" variant="ghost">
						{module.enabled ? 'Disable' : 'Enable'}
					</Button>
					<Button size="sm" variant="ghost">Reorder</Button>
				</div>
			</div>
		{/each}
	</div>

	<div
		class="rounded-lg border border-dashed border-border/60 bg-background/60 p-4 text-sm text-muted-foreground"
	>
		Drag-and-drop ordering coming soon. Select modules to customize their placement.
	</div>

	<div class="flex gap-2">
		<Button variant="secondary" size="sm">Save layout</Button>
		<Button variant="ghost" size="sm">Reset to defaults</Button>
	</div>
</div>
