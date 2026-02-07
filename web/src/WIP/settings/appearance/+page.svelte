<script lang="ts">
	import SectionHeader from '$lib/components/section-header.svelte';
	import TagPill from '$lib/components/tag-pill.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	const themes = ['Light', 'Dark', 'System', 'Custom'];
	const accents = ['Violet', 'Emerald', 'Amber', 'Rose', 'Slate'];
</script>

<SectionHeader
	title="Appearance"
	description="Preview theme combinations and tweak typography, spacing, and contrast."
/>

<div class="grid gap-4 lg:grid-cols-2">
	<div class="space-y-4 rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Theme</h3>
		<div class="flex flex-wrap gap-2">
			{#each themes as theme (theme)}
				<button type="button" class="focus-visible:outline-none" aria-pressed={theme === 'Dark'}>
					<TagPill tone={theme === 'Dark' ? 'neutral' : 'outline'} size="sm">
						{theme}
					</TagPill>
				</button>
			{/each}
		</div>
		<div class="space-y-2">
			<h4 class="text-sm font-semibold">Accent color</h4>
			<div class="flex flex-wrap gap-2">
				{#each accents as accent (accent)}
					<button
						type="button"
						class="focus-visible:outline-none"
						aria-pressed={accent === 'Violet'}
					>
						<TagPill tone={accent === 'Violet' ? 'neutral' : 'outline'} size="sm">
							{accent}
						</TagPill>
					</button>
				{/each}
			</div>
		</div>
		<div class="space-y-2">
			<h4 class="text-sm font-semibold">Typography scale</h4>
			<div class="flex items-center gap-2">
				<span class="text-sm text-muted-foreground">Compact</span>
				<div class="h-2 flex-1 rounded-full bg-muted">
					<div class="h-full w-2/3 rounded-full bg-primary/80"></div>
				</div>
				<span class="text-sm text-muted-foreground">Spacious</span>
			</div>
		</div>
		<div class="space-y-2">
			<h4 class="text-sm font-semibold">Density</h4>
			<p class="text-sm text-muted-foreground">Toggle compact mode for tighter tables and cards.</p>
			<Button size="sm" variant="secondary">Enable compact mode</Button>
		</div>
	</div>
	<div class="space-y-4 rounded-lg border border-border/60 bg-background/80 p-4">
		<h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
			Live preview
		</h3>
		<div class="rounded-lg border border-border/60 bg-card/90 p-4 shadow-inner">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-xs tracking-wide text-muted-foreground uppercase">Card title</p>
					<h4 class="text-base font-semibold">Blooming Nights</h4>
				</div>
				<TagPill tone="outline" size="sm">Romance</TagPill>
			</div>
			<p class="mt-3 text-sm text-muted-foreground">
				Two rival florists navigate love, loss, and the city nightlife. Typography and spacing
				reflect your selections.
			</p>
			<div class="mt-4 flex gap-2">
				<Button size="sm" variant="secondary">Primary action</Button>
				<Button size="sm" variant="ghost">Secondary</Button>
			</div>
		</div>
		<div class="space-y-2">
			<h4 class="text-sm font-semibold">Accessibility</h4>
			<p class="text-sm text-muted-foreground">
				Enable high-contrast mode and reduce motion animations.
			</p>
			<div class="flex gap-2">
				<Button size="sm" variant="secondary">High contrast</Button>
				<Button size="sm" variant="ghost">Reduce motion</Button>
			</div>
		</div>
	</div>
</div>
