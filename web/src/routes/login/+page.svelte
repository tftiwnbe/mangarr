<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	import { ClientError, getMe, getSetupStatus, login, registerFirstUser } from '$lib/client/auth';
	import { Button } from '$lib/elements/button';
	import { Input } from '$lib/elements/input';
	import { Switch } from '$lib/elements/switch';
	import { SpinnerIcon, EyeIcon, EyeSlashIcon } from 'phosphor-svelte';
	import { _ } from '$lib/i18n';

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
		const candidate = page.url.searchParams.get('redirect') ?? '/extensions';
		if (candidate.startsWith('/') && !candidate.startsWith('//')) {
			return candidate;
		}
		return '/extensions';
	});

	onMount(async () => {
		mounted = true;
		try {
			const status = await getSetupStatus();
			needsSetup = status.needs_setup;
		} catch {
			needsSetup = false;
		}

		try {
			await getMe();
			await goto(redirectTarget, { replaceState: true });
			return;
		} catch {
			// Ignore and show form.
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
				await registerFirstUser({ username: normalizedUsername, password });
			} else {
				await login({ username: normalizedUsername, password, remember_me: rememberSession });
			}
			await goto(redirectTarget, { replaceState: true });
		} catch (cause: unknown) {
			if (cause instanceof ClientError) {
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
	<div class="pointer-events-none fixed inset-0">
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
	</div>

	<div
		class="relative z-10 w-full max-w-sm {mounted ? 'animate-slide-up' : 'opacity-0'}"
		style="animation-fill-mode: backwards; animation-delay: 100ms"
	>
		{#if checkingSession}
			<div class="flex flex-col items-center gap-6">
				<SpinnerIcon size={24} class="text-[var(--text-muted)]" />
				<p class="text-sm text-[var(--text-ghost)]">{$_('auth.checkingSession')}</p>
			</div>
		{:else}
			<div class="mb-10 text-center">
				<h1 class="text-display text-2xl text-[var(--text)]">{$_('app.name').toLowerCase()}</h1>
				<p class="mt-2 text-sm text-[var(--text-muted)]">
					{needsSetup
						? $_('auth.firstAdminDescription').toLowerCase()
						: $_('auth.welcomeBack').toLowerCase()}
				</p>
			</div>

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
								aria-label={showPassword ? 'Hide password' : 'Show password'}
							>
								{#if showPassword}<EyeSlashIcon size={16} />{:else}<EyeIcon size={16} />{/if}
							</button>
						</div>

						{#if !needsSetup}
							<div class="flex cursor-pointer items-center justify-between gap-3">
								<span class="text-sm text-[var(--text-ghost)]">{$_('auth.rememberMe')}</span>
								<Switch checked={rememberSession} onCheckedChange={(v) => (rememberSession = v)} />
							</div>
						{/if}

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
		{/if}
	</div>
</main>
