<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	import { getMe } from '$lib/api/auth';
	import { clearAuthSession, getStoredApiKey } from '$lib/api/session';
	import { Icon } from '$lib/elements/icon';
	import { StarField } from '$lib/elements/starfield';
	import { _ } from '$lib/i18n';
	import { loadContentLanguages } from '$lib/stores/content-languages';
	import { panelOverlayOpen } from '$lib/stores/ui';
	import { wsManager } from '$lib/stores/ws';

	let { children } = $props();
	let isCheckingAuth = $state(true);
	let isAuthenticated = $state(false);

	const redirectTarget = $derived(page.url.pathname + page.url.search);

	const navItems = [
		{ href: '/library', icon: 'book', label: 'library' },
		{ href: '/explore', icon: 'compass', label: 'explore' },
		{ href: '/downloads', icon: 'download', label: 'downloads' },
		{ href: '/extensions', icon: 'puzzle', label: 'extensions' },
		{ href: '/settings', icon: 'settings', label: 'settings' }
	] as const;

	const currentPath = $derived(page.url.pathname);
	const isReaderRoute = $derived(currentPath.startsWith('/reader/'));

	async function navigateToLogin(): Promise<void> {
		const target = encodeURIComponent(redirectTarget);
		await goto(`/login?redirect=${target}`, { replaceState: true });
	}

	onMount(() => {
		void (async () => {
			const storedKey = getStoredApiKey();
			if (!storedKey) {
				clearAuthSession();
				await navigateToLogin();
				isCheckingAuth = false;
				return;
			}

			try {
				await getMe();
				isAuthenticated = true;
				// Sync content language preferences from server (best-effort)
				void loadContentLanguages();
				// Open persistent WebSocket for real-time events
				wsManager.connect();
			} catch {
				clearAuthSession();
				if (isAuthenticated) wsManager.disconnect();
				await navigateToLogin();
			} finally {
				isCheckingAuth = false;
			}
		})();
	});
</script>

<div class="relative min-h-svh bg-[var(--void-0)]">
	<!-- Space background (hidden in reader for clean void canvas) -->
	{#if !isReaderRoute}
		<div class="pointer-events-none fixed inset-0">
			<!-- Subtle grid -->
			<div
				class="absolute inset-0 opacity-[0.02]"
				style="
					background-image:
						linear-gradient(rgba(200, 200, 220, 0.6) 1px, transparent 1px),
						linear-gradient(90deg, rgba(200, 200, 220, 0.6) 1px, transparent 1px);
					background-size: 50px 50px;
				"
			></div>

			<!-- Sparse stars -->
			<StarField count={25} />

			<!-- Orbital ring -->
			<div
				class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[1400px] w-[1400px] animate-spin-slow"
				style="animation-duration: 200s;"
			>
				<svg viewBox="0 0 200 200" class="h-full w-full">
					<ellipse
						cx="100"
						cy="100"
						rx="95"
						ry="28"
						fill="none"
						stroke="rgba(140, 140, 160, 0.08)"
						stroke-width="0.5"
					/>
				</svg>
			</div>
		</div>
	{/if}

	{#if isCheckingAuth}
		<div class="flex min-h-svh items-center justify-center">
			<div class="flex flex-col items-center gap-4">
				<Icon name="loader" size={24} class="text-[var(--text-muted)] animate-spin" />
				<p class="text-sm text-[var(--text-ghost)]">{$_('auth.checkingSession')}</p>
			</div>
		</div>
	{:else if isAuthenticated}
		<!-- Main content -->
		{#if isReaderRoute}
			<main class="relative z-10">
				{@render children()}
			</main>
		{:else}
			<main class="relative z-10 pb-20 md:pb-6 md:pl-16">
				<div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
					{@render children()}
				</div>
			</main>
		{/if}

		<!-- Bottom navigation (mobile) -->
		{#if !isReaderRoute && !$panelOverlayOpen}
			<nav class="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--line)] bg-[var(--void-1)]/95 backdrop-blur-sm md:hidden">
				<div class="flex items-center justify-around">
					{#each navItems as item (item.href)}
						{@const isActive = currentPath.startsWith(item.href)}
						<a
							href={item.href}
							class="flex flex-1 flex-col items-center gap-1 py-3 text-xs transition-colors {isActive
								? 'text-[var(--text)]'
								: 'text-[var(--text-ghost)]'}"
						>
							<Icon name={item.icon} size={20} />
							<span>{$_(`nav.${item.label}`)}</span>
						</a>
					{/each}
				</div>
			</nav>
		{/if}

		<!-- Desktop sidebar -->
		<aside class="fixed inset-y-0 left-0 z-40 hidden w-16 flex-col border-r border-[var(--line)] bg-[var(--void-1)] {isReaderRoute ? '' : 'md:flex'}">
			<div class="flex flex-1 flex-col items-center gap-1 py-4">
				{#each navItems as item (item.href)}
					{@const isActive = currentPath.startsWith(item.href)}
					<a
						href={item.href}
						class="flex h-10 w-10 items-center justify-center transition-all {isActive
							? 'text-[var(--text)] bg-[var(--void-4)] shadow-[0_0_12px_rgba(255,255,255,0.12)]'
							: 'text-[var(--text-ghost)] hover:text-[var(--text-muted)] hover:bg-[var(--void-3)] hover:shadow-[0_0_10px_rgba(255,255,255,0.08)]'}"
						title={$_(`nav.${item.label}`)}
					>
						<Icon name={item.icon} size={20} />
					</a>
				{/each}
			</div>
		</aside>

	{/if}
</div>
