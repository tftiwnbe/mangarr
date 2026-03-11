<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	import { login, registerFirstUser, getMe, getSetupStatus } from '$lib/api/auth';
	import { listInstalledExtensions } from '$lib/api/extensions';
	import { ApiError } from '$lib/api/errors';
	import { clearAuthSession, type ApiKeyPersistence } from '$lib/api/session';
	import { Button } from '$lib/elements/button';
	import { Input } from '$lib/elements/input';
	import { Switch } from '$lib/elements/switch';
	import { SpinnerIcon, EyeIcon, EyeSlashIcon } from 'phosphor-svelte';
	import { _ } from '$lib/i18n';

	// State
	let username = $state('');
	let password = $state('');
	let showPassword = $state(false);
	let rememberSession = $state(true);
	let loading = $state(false);
	let checkingSession = $state(true);
	let error = $state<string | null>(null);
	let mounted = $state(false);
	let needsSetup = $state(false);

	const redirectTarget = $derived.by(() => {
		const candidate = page.url.searchParams.get('redirect') ?? '/library';
		if (candidate.startsWith('/') && !candidate.startsWith('//')) {
			return candidate;
		}
		return '/library';
	});

	const persistence = $derived<ApiKeyPersistence>(rememberSession ? 'local' : 'session');

	async function redirectToApp(): Promise<void> {
		try {
			const extensions = await listInstalledExtensions();
			if (extensions.length === 0) {
				await goto('/setup', { replaceState: true });
				return;
			}
		} catch {
			// Continue to app if we can't check extensions
		}
		await goto(redirectTarget, { replaceState: true });
	}

	onMount(async () => {
		mounted = true;

		// Check setup status first (no auth required)
		try {
			const status = await getSetupStatus();
			needsSetup = status.needs_setup;
		} catch {
			// If we can't check, assume setup is done
			needsSetup = false;
		}

		try {
			await getMe();
			await redirectToApp();
			return;
		} catch {
			clearAuthSession();
		}
		checkingSession = false;
	});

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (loading) return;

		error = null;
		const normalizedUsername = username.trim();
		if (!normalizedUsername || password.length === 0) {
			error = 'Username and password are required';
			return;
		}
		loading = true;

		try {
			if (needsSetup) {
				// First user registration
				await registerFirstUser({ username: normalizedUsername, password }, { persistence });
			} else {
				// Normal login
				await login(
					{ username: normalizedUsername, password, remember_me: rememberSession },
					{ persistence }
				);
			}
			await redirectToApp();
		} catch (cause: unknown) {
			if (cause instanceof ApiError) {
				error = cause.message;
			} else if (cause instanceof Error) {
				error = cause.message;
			} else {
				error = $_('auth.authFailed');
			}
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{needsSetup ? $_('auth.createFirstAdmin') : $_('auth.signIn')} | {$_('app.name')}</title>
</svelte:head>

<main class="relative flex min-h-svh flex-col items-center justify-center overflow-hidden p-4">
	<!-- Space background -->
	<div class="pointer-events-none fixed inset-0">
		<!-- Grid overlay -->
		<div
			class="absolute inset-0 opacity-[0.04]"
			style="
				background-image:
					linear-gradient(rgba(200, 200, 220, 0.6) 1px, transparent 1px),
					linear-gradient(90deg, rgba(200, 200, 220, 0.6) 1px, transparent 1px);
				background-size: 50px 50px;
				mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black, transparent);
			"
		></div>

		<!-- Stars -->
		{#each Array(50) as _, i (i)}
			<div
				class="animate-pulse-glow absolute rounded-full bg-white"
				style="
					width: {1 + Math.random() * 2}px;
					height: {1 + Math.random() * 2}px;
					left: {Math.random() * 100}%;
					top: {Math.random() * 100}%;
					opacity: {0.2 + Math.random() * 0.4};
					animation-delay: {Math.random() * 4}s;
					animation-duration: {2 + Math.random() * 3}s;
				"
			></div>
		{/each}

		<!-- Orbital rings -->
		<div
			class="animate-spin-slow absolute top-1/2 left-1/2 h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 opacity-[0.03]"
		>
			<svg viewBox="0 0 200 200" class="h-full w-full">
				<ellipse
					cx="100"
					cy="100"
					rx="95"
					ry="35"
					fill="none"
					stroke="currentColor"
					stroke-width="0.4"
				/>
				<ellipse
					cx="100"
					cy="100"
					rx="70"
					ry="25"
					fill="none"
					stroke="currentColor"
					stroke-width="0.3"
					transform="rotate(60 100 100)"
				/>
			</svg>
		</div>
	</div>

	<!-- Main content -->
	<div
		class="relative z-10 w-full max-w-sm {mounted ? 'animate-slide-up' : 'opacity-0'}"
		style="animation-fill-mode: backwards; animation-delay: 100ms"
	>
		{#if checkingSession}
			<!-- Checking session state -->
			<div class="flex flex-col items-center gap-6">
				<div class="relative h-6 w-6">
					<SpinnerIcon size={24} class="text-[var(--text-muted)]" />
				</div>
				<p class="text-sm text-[var(--text-ghost)]">{$_('auth.checkingSession')}</p>
			</div>
		{:else}
			<!-- Logo / Brand -->
			<div class="mb-10 text-center">
				<h1 class="text-display text-2xl text-[var(--text)]">
					{$_('app.name').toLowerCase()}
				</h1>
				<p class="mt-2 text-sm text-[var(--text-muted)]">
					{needsSetup
						? $_('auth.firstAdminDescription').toLowerCase()
						: $_('auth.welcomeBack').toLowerCase()}
				</p>
			</div>

			<!-- Card container with flowing border -->
			<div class="border-flow">
				<div class="glow-subtle border border-[var(--line)] bg-[var(--surface)] p-6">
					<form class="flex flex-col gap-5" onsubmit={handleSubmit}>
						<Input
							type="text"
							label={$_('auth.username')}
							placeholder="admin"
							autocomplete="username"
							required
							bind:value={username}
						/>

						<div class="relative">
							<Input
								type={showPassword ? 'text' : 'password'}
								label={$_('auth.password')}
								placeholder="••••••••"
								autocomplete={needsSetup ? 'new-password' : 'current-password'}
								required
								bind:value={password}
							/>
							<button
								type="button"
								class="absolute top-[30px] right-3 p-1 text-[var(--text-ghost)] transition-colors hover:text-[var(--text-soft)]"
								onclick={() => (showPassword = !showPassword)}
								tabindex={-1}
								aria-label={showPassword ? 'Hide password' : 'Show password'}
							>
								{#if showPassword}<EyeSlashIcon size={16} />{:else}<EyeIcon size={16} />{/if}
							</button>
						</div>

						<!-- Remember session (only for login, not registration) -->
						{#if !needsSetup}
							<div class="flex cursor-pointer items-center justify-between gap-3">
								<span class="text-sm text-[var(--text-ghost)]">{$_('auth.rememberMe')}</span>
								<Switch checked={rememberSession} onCheckedChange={(v) => (rememberSession = v)} />
							</div>
						{/if}

						<!-- Error message -->
						{#if error}
							<div
								class="animate-fade-in border border-[var(--error)]/20 bg-[var(--error-soft)] px-4 py-3 text-sm text-[var(--error)]"
							>
								{error}
							</div>
						{/if}

						<Button
							type="submit"
							size="lg"
							disabled={loading || username.trim().length === 0 || password.length === 0}
							{loading}
							class="mt-2 w-full justify-center"
						>
							{#if loading}
								{$_('auth.pleaseWait')}
							{:else if needsSetup}
								{$_('auth.createFirstAdmin').toLowerCase()}
							{:else}
								{$_('auth.signIn').toLowerCase()}
							{/if}
						</Button>
					</form>
				</div>
			</div>

			<!-- Footer hint -->
			{#if needsSetup}
				<p class="mt-6 text-center text-xs text-[var(--text-ghost)]">
					{$_('auth.passwordRequirements')}
				</p>
			{/if}
		{/if}
	</div>

	<!-- Domain watermark -->
	<div
		class="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-wider text-[var(--void-6)]"
	>
		hmphin.space
	</div>
</main>
