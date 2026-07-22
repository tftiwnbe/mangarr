<script lang="ts">
	import { browser } from '$app/environment';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	import { setupConvexClient } from '$lib/convex/client';
	import { registerMangarrServiceWorker } from '$lib/client/pwa-notifications';
	import NotificationManager from '$lib/components/notification-manager.svelte';
	import { StarField } from '$lib/elements/starfield';
	import { ToastContainer } from '$lib/elements/toast';
	import { BookIcon, CompassIcon, DownloadIcon, PuzzlePieceIcon, GearIcon } from 'phosphor-svelte';
	import { _ } from '$lib/i18n';
	import { loadContentLanguages } from '$lib/stores/content-languages';
	import { loadUserPreferences } from '$lib/stores/user-preferences';
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
	const isLibraryRoute = $derived(currentPath.startsWith('/library'));

	afterNavigate((nav) => {
		// Remember last app route for PWA cold-start resume. Captures every nav
		// (including 'enter') so a fresh launch is anchored, but ignores popstate
		// to avoid undoing a Back gesture on next launch.
		if (browser && nav.type !== 'popstate') {
			const to = nav.to?.url;
			if (to && to.origin === location.origin) {
				try {
					localStorage.setItem(
						'mangarr:last-path',
						JSON.stringify({ path: to.pathname + to.search, ts: Date.now() })
					);
				} catch {
					/* storage full or disabled — non-fatal */
				}
			}
		}

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
		void loadUserPreferences();
		void registerMangarrServiceWorker();
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
			class="relative z-10 pt-[env(safe-area-inset-top)] pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pt-0 md:pb-6 md:pl-16"
		>
			<div
				class="mx-auto w-full max-w-5xl pt-5 md:px-6 md:pt-8 md:pb-8 {isLibraryRoute
					? 'xl:max-w-6xl 2xl:max-w-[100rem]'
					: ''}"
				style="padding-left: max(0.875rem, env(safe-area-inset-left)); padding-right: max(0.875rem, env(safe-area-inset-right));"
			>
				{@render children()}
			</div>
		</main>
	{/if}

	{#if !isReaderRoute && !$panelOverlayOpen}
		<nav class="bottom-nav md:hidden">
			<div class="bottom-nav-inner">
				{#each navItems as item (item.href)}
					{@const isActive = currentPath.startsWith(item.href)}
					{@const NavIcon = item.icon}
					<a
						href={item.href}
						class="bottom-nav-item"
						class:is-active={isActive}
						aria-current={isActive ? 'page' : undefined}
					>
						<NavIcon size={20} weight={isActive ? 'fill' : 'regular'} />
						<span class="bottom-nav-label">{$_(`nav.${item.label}`)}</span>
					</a>
				{/each}
			</div>
		</nav>
	{/if}

	<ToastContainer />
	<NotificationManager />

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
					class="side-nav-item"
					class:is-active={isActive}
					aria-current={isActive ? 'page' : undefined}
					title={$_(`nav.${item.label}`)}
				>
					<NavIcon size={20} weight={isActive ? 'fill' : 'regular'} />
				</a>
			{/each}
		</div>
	</aside>
</div>

<style>
	.bottom-nav {
		position: fixed;
		inset-inline: 0;
		bottom: 0;
		z-index: 50;
		background: color-mix(in srgb, var(--void-1) 88%, transparent);
		border-top: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
		backdrop-filter: blur(14px) saturate(140%);
		-webkit-backdrop-filter: blur(14px) saturate(140%);
		padding-bottom: env(safe-area-inset-bottom, 0px);
		transform: translateZ(0);
		will-change: transform;
		contain: layout paint;
	}

	.bottom-nav-inner {
		display: flex;
		align-items: stretch;
		justify-content: space-around;
		padding: 6px 0 8px;
	}

	.bottom-nav-item {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		min-height: 48px;
		padding: 4px;
		color: var(--text-ghost);
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		transition:
			color 180ms ease,
			transform 120ms ease;
		-webkit-tap-highlight-color: transparent;
	}
	.bottom-nav-item:active {
		transform: scale(0.94);
	}
	.bottom-nav-item.is-active {
		color: var(--text);
	}

	.bottom-nav-label {
		line-height: 1;
		font-feature-settings: 'tnum';
	}

	.side-nav-item {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		color: var(--text-ghost);
		transition:
			color 160ms ease,
			background 160ms ease;
	}
	.side-nav-item:hover {
		color: var(--text-muted);
		background: var(--void-3);
	}
	.side-nav-item.is-active {
		color: var(--text);
		background: var(--void-4);
	}
</style>
