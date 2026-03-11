<script lang="ts">
	import { page } from '$app/state';
	import { StarField } from '$lib/elements/starfield';
	import {
		BookIcon,
		CompassIcon,
		DownloadIcon,
		PuzzlePieceIcon,
		GearIcon
	} from 'phosphor-svelte';
	import { _ } from '$lib/i18n';
	import { resolvedTheme } from '$lib/stores/theme';

	let { children } = $props();

	const navItems = [
		{ href: '/library', icon: BookIcon, label: 'library' },
		{ href: '/explore', icon: CompassIcon, label: 'explore' },
		{ href: '/extensions', icon: PuzzlePieceIcon, label: 'extensions' },
		{ href: '/downloads', icon: DownloadIcon, label: 'downloads' },
		{ href: '/settings', icon: GearIcon, label: 'settings' }
	];

	const currentPath = $derived(page.url.pathname);
</script>

<div class="relative min-h-svh bg-[var(--void-0)]">
	<div class="pointer-events-none fixed inset-0">
		<StarField count={40} />
		<div
			class="animate-spin-slow absolute top-1/2 left-1/2 h-[1400px] w-[1400px] -translate-x-1/2 -translate-y-1/2"
			style="animation-duration: 200s;"
		>
			<svg viewBox="0 0 200 200" class="h-full w-full">
				<ellipse
					cx="100"
					cy="100"
					rx="95"
					ry="28"
					fill="none"
					stroke={$resolvedTheme === 'light'
						? 'rgba(20, 20, 30, 0.06)'
						: 'rgba(140, 140, 160, 0.08)'}
					stroke-width="0.5"
				/>
			</svg>
		</div>
	</div>

	<main class="relative z-10 pb-20 md:pb-6 md:pl-16">
		<div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
			{@render children()}
		</div>
	</main>

	<nav
		class="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--line)] bg-[var(--void-1)]/95 backdrop-blur-sm md:hidden"
	>
		<div class="flex items-center justify-around">
			{#each navItems as item (item.href)}
				{@const isActive = currentPath.startsWith(item.href)}
				{@const NavIcon = item.icon}
				<a
					href={item.href}
					class="flex flex-1 flex-col items-center gap-1 py-3 text-xs transition-colors {isActive
						? 'text-[var(--text)]'
						: 'text-[var(--text-ghost)]'}"
				>
					<NavIcon size={20} />
					<span>{$_(`nav.${item.label}`)}</span>
				</a>
			{/each}
		</div>
	</nav>

	<aside class="fixed inset-y-0 left-0 z-40 hidden w-16 flex-col border-r border-[var(--line)] bg-[var(--void-1)] md:flex">
		<div class="flex flex-1 flex-col items-center gap-1 py-4">
			{#each navItems as item (item.href)}
				{@const isActive = currentPath.startsWith(item.href)}
				{@const NavIcon = item.icon}
				<a
					href={item.href}
					class="flex h-10 w-10 items-center justify-center transition-all {isActive
						? 'bg-[var(--void-4)] text-[var(--text)]'
						: 'text-[var(--text-ghost)] hover:bg-[var(--void-3)] hover:text-[var(--text-muted)]'}"
					title={$_(`nav.${item.label}`)}
				>
					<NavIcon size={20} />
				</a>
			{/each}
		</div>
	</aside>
</div>
