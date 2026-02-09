<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	import { getMe } from '$lib/api/auth';
	import { clearAuthSession, getStoredApiKey } from '$lib/api/session';
	import AppSidebar from '$lib/components/app-sidebar/app-sidebar.svelte';
	import * as Sidebar from '$lib/elements/sidebar/index.js';

	let { children } = $props();
	let isCheckingAuth = $state(true);
	let isAuthenticated = $state(false);

	const redirectTarget = $derived(page.url.pathname + page.url.search);

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
			} catch {
				clearAuthSession();
				await navigateToLogin();
			} finally {
				isCheckingAuth = false;
			}
		})();
	});
</script>

<Sidebar.Provider>
	{#if isAuthenticated}
		<AppSidebar />
	{/if}
	<Sidebar.Inset
		class="min-h-svh bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_35%)]"
	>
		{#if isCheckingAuth}
			<div class="mx-auto flex w-full max-w-screen-2xl flex-1 items-center justify-center px-4">
				<div class="rounded-lg border bg-card/70 px-4 py-3 text-sm text-muted-foreground">
					Checking authentication...
				</div>
			</div>
		{:else if isAuthenticated}
			<div class="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col">
				{@render children()}
			</div>
		{/if}
	</Sidebar.Inset>
</Sidebar.Provider>
