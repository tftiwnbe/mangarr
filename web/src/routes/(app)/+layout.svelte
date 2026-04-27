<script lang="ts">
	import { browser } from '$app/environment';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	import { setupConvexClient } from '$lib/convex/client';
	import { StarField } from '$lib/elements/starfield';
	import { ToastContainer } from '$lib/elements/toast';
	import { BookIcon, CompassIcon, DownloadIcon, PuzzlePieceIcon, GearIcon } from 'phosphor-svelte';
	import { _ } from '$lib/i18n';
	import { loadContentLanguages } from '$lib/stores/content-languages';
	import { pushNavHistory } from '$lib/stores/nav-history';
	import { panelOverlayOpen } from '$lib/stores/ui';
	import { resolvedTheme } from '$lib/stores/theme';

	let { children } = $props();

	// App routes are the only surfaces that require Convex auth/bootstrap.
	if (browser) {
		setupConvexClient();
	}

	const navItems = [
		{ href: '/library', icon: BookIcon, label: 'library' },
		{ href: '/explore', icon: CompassIcon, label: 'explore' },
		{ href: '/downloads', icon: DownloadIcon, label: 'downloads' },
		{ href: '/extensions', icon: PuzzlePieceIcon, label: 'extensions' },
		{ href: '/settings', icon: GearIcon, label: 'settings' }
	];

	const currentPath = $derived(page.url.pathname);
	const isReaderRoute = $derived(currentPath.startsWith('/reader/'));

	afterNavigate((nav) => {
		if (nav.type === 'popstate' || nav.type === 'enter') return;
		const from = nav.from;
		if (!from) return;

		const fromPath = from.url.pathname;
		const toPath = nav.to?.url.pathname ?? '';
		const sameRoutePrefix = (prefix: string) =>
			fromPath.startsWith(prefix) && toPath.startsWith(prefix);
		const idSegment = (path: string, prefix: string) =>
			path.slice(prefix.length).split('/')[0]?.split('--')[0];
		if (
			sameRoutePrefix('/title/') &&
			idSegment(fromPath, '/title/') === idSegment(toPath, '/title/')
		) {
			return;
		}

		pushNavHistory(fromPath + from.url.search);
	});

	onMount(() => {
		void loadContentLanguages();
	});
</script>

<div class="relative min-h-svh bg-[var(--void-0)]">
	{#if !isReaderRoute}
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
	{/if}

	{#if isReaderRoute}
		<main class="relative z-10">
			{@render children()}
		</main>
	{:else}
		<main
			class="relative z-10 pt-[env(safe-area-inset-top)] pb-[calc(3rem+env(safe-area-inset-bottom))] md:pt-0 md:pb-6 md:pl-16"
		>
			<div
				class="mx-auto w-full max-w-5xl py-1 md:px-6 md:py-8"
				style="padding-left: max(1rem, env(safe-area-inset-left)); padding-right: max(1rem, env(safe-area-inset-right));"
			>
				{@render children()}
			</div>
		</main>
	{/if}

	{#if !isReaderRoute && !$panelOverlayOpen}
		<nav
			class="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--line)] bg-[var(--void-1)]/95 backdrop-blur-sm md:hidden"
			style="padding-bottom: env(safe-area-inset-bottom);"
		>
			<div class="flex items-center justify-around">
				{#each navItems as item (item.href)}
					{@const isActive = currentPath.startsWith(item.href)}
					{@const NavIcon = item.icon}
					<a
						href={item.href}
						class="flex flex-1 flex-col items-center gap-0.5 py-1.5 text-xs transition-colors {isActive
							? 'text-[var(--text)]'
							: 'text-[var(--text-ghost)]'}"
					>
						<NavIcon size={20} />
						<span>{$_(`nav.${item.label}`)}</span>
					</a>
				{/each}
			</div>
		</nav>
	{/if}

	<ToastContainer />

	<aside
		class="fixed inset-y-0 left-0 z-40 hidden w-16 flex-col border-r border-[var(--line)] bg-[var(--void-1)] {isReaderRoute
			? ''
			: 'md:flex'}"
	>
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
