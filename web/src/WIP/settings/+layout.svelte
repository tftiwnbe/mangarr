<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import SectionHeader from '$elements/section-header.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	const sections = [
		{ title: 'Home', href: '/settings/home' },
		{ title: 'Appearance', href: '/settings/appearance' },
		{ title: 'General', href: '/settings/general' },
		{ title: 'Users', href: '/settings/users' },
		{ title: 'Network', href: '/settings/network' },
		{ title: 'Notifications', href: '/settings/notifications' },
		{ title: 'Logs', href: '/settings/logs' },
		{ title: 'Jobs & Cache', href: '/settings/jobs-cache' },
		{ title: 'About', href: '/settings/about' }
	];

	let { children }: { children: Snippet | undefined } = $props();
	const activeHref = $derived(
		sections.find((section) => $page.url.pathname.startsWith(section.href))?.href ??
			sections[0].href
	);

	const handleSelect = (event: Event) => {
		const target = event.currentTarget as HTMLSelectElement;
		if (target.value && target.value !== activeHref) {
			goto(target.value);
		}
	};
</script>

<section class="space-y-6">
	<SectionHeader
		title="Settings"
		description="Adjust Mangarr to fit your reading workflow and system preferences."
	/>
	<div class="space-y-4">
		<div class="flex flex-col gap-2 sm:hidden">
			<label class="text-sm font-medium text-muted-foreground" for="settings-section-select">
				Section
			</label>
			<select
				id="settings-section-select"
				class="rounded-lg border border-border/60 bg-card/80 px-3 py-2 text-sm"
				value={activeHref}
				onchange={handleSelect}
			>
				{#each sections as section (section.href)}
					<option value={section.href}>{section.title}</option>
				{/each}
			</select>
		</div>
		<nav
			class="hidden gap-2 overflow-x-auto rounded-xl border border-border/60 bg-card/80 p-2 sm:flex sm:flex-wrap"
		>
			{#each sections as section (section.href)}
				{@const isActive = $page.url.pathname.startsWith(section.href)}
				<a
					href={section.href}
					class={cn(
						'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
						isActive
							? 'bg-primary text-primary-foreground'
							: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
					)}
					aria-current={isActive ? 'page' : undefined}
				>
					{section.title}
				</a>
			{/each}
		</nav>
		<div class="rounded-xl border border-border/60 bg-card/80 p-4 shadow-sm sm:p-6">
			{@render children?.()}
		</div>
	</div>
</section>
