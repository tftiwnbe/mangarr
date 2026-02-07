<script lang="ts">
	import { page } from '$app/state';
	import { PageHeader } from '$lib/components/page-header/index.js';
	import { cn } from '$lib/utils';
	import * as Select from '$lib/elements/select/index.js';
	import { goto } from '$app/navigation';

	import SettingsIcon from '@lucide/svelte/icons/settings';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import InfoIcon from '@lucide/svelte/icons/info';

	let { children } = $props();

	const settingsNav = [
		{ href: '/settings/general', label: 'General', icon: SettingsIcon },
		{ href: '/settings/appearance', label: 'Appearance', icon: PaletteIcon },
		{ href: '/settings/sources', label: 'Sources', icon: GlobeIcon },
		{ href: '/settings/downloads', label: 'Downloads', icon: DownloadIcon },
		{ href: '/settings/about', label: 'About', icon: InfoIcon }
	];

	const currentPath = $derived(page.url.pathname);
	const currentNav = $derived(settingsNav.find((n) => n.href === currentPath) || settingsNav[0]);

	function handleMobileNavChange(value: string) {
		goto(value);
	}
</script>

<PageHeader
	title="Settings"
	breadcrumbs={[
		{ label: 'Settings', href: '/settings/general' },
		{ label: currentNav.label }
	]}
/>

<div class="flex flex-col gap-6 px-4 pb-24 md:flex-row">
	<!-- Desktop Sidebar -->
	<nav class="hidden w-48 shrink-0 md:block">
		<ul class="flex flex-col gap-1">
			{#each settingsNav as item (item.href)}
				{@const isActive = currentPath === item.href}
				<li>
					<a
						href={item.href}
						class={cn(
							'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
							isActive
								? 'bg-secondary text-secondary-foreground'
								: 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
						)}
					>
						<item.icon class="size-4" />
						{item.label}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<!-- Mobile Navigation Select -->
	<div class="md:hidden">
		<Select.Root type="single" value={currentPath} onValueChange={handleMobileNavChange}>
			<Select.Trigger class="w-full">
				<div class="flex items-center gap-2">
					<currentNav.icon class="size-4" />
					{currentNav.label}
				</div>
			</Select.Trigger>
			<Select.Content>
				{#each settingsNav as item (item.href)}
					<Select.Item value={item.href}>
						<div class="flex items-center gap-2">
							<item.icon class="size-4" />
							{item.label}
						</div>
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<!-- Content -->
	<div class="min-w-0 flex-1">
		{@render children()}
	</div>
</div>
