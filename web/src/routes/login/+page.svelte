<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	import { login, registerFirstUser, getMe } from '$lib/api/auth';
	import { ApiError } from '$lib/api/errors';
	import { clearAuthSession, getStoredApiKey, type ApiKeyPersistence } from '$lib/api/session';
	import { Button } from '$lib/elements/button/index.js';
	import { Input } from '$lib/elements/input/index.js';
	import { Badge } from '$lib/elements/badge/index.js';

	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import LogInIcon from '@lucide/svelte/icons/log-in';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';

	type Mode = 'login' | 'register';

	let mode = $state<Mode>('login');
	let username = $state('');
	let password = $state('');
	let rememberSession = $state(true);
	let loading = $state(false);
	let checkingSession = $state(true);
	let error = $state<string | null>(null);
	let info = $state<string | null>(null);

	const redirectTarget = $derived.by(() => {
		const candidate = page.url.searchParams.get('redirect') ?? '/';
		if (candidate.startsWith('/') && !candidate.startsWith('//')) {
			return candidate;
		}
		return '/';
	});

	const persistence = $derived<ApiKeyPersistence>(rememberSession ? 'local' : 'session');
	const title = $derived(mode === 'login' ? 'Sign In' : 'Create First Admin');
	const description = $derived(
		mode === 'login'
			? 'Use your Mangarr account credentials to issue a new bearer token.'
			: 'Bootstrap your first admin account for this server.'
	);

	async function redirectToApp(): Promise<void> {
		await goto(redirectTarget, { replaceState: true });
	}

	onMount(async () => {
		const apiKey = getStoredApiKey();
		if (!apiKey) {
			checkingSession = false;
			return;
		}
		try {
			await getMe();
			await redirectToApp();
			return;
		} catch {
			clearAuthSession();
		} finally {
			checkingSession = false;
		}
	});

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (loading) {
			return;
		}

		error = null;
		info = null;
		loading = true;
		try {
			if (mode === 'login') {
				await login(
					{
						username,
						password
					},
					{ persistence }
				);
				await redirectToApp();
				return;
			}

			await registerFirstUser(
				{
					username,
					password
				},
				{ persistence }
			);
			await redirectToApp();
		} catch (cause: unknown) {
			if (cause instanceof ApiError) {
				error = cause.message;
				if (cause.status === 409 && mode === 'register') {
					info = 'Admin account already exists. Switch to sign in mode.';
				}
			} else if (cause instanceof Error) {
				error = cause.message;
			} else {
				error = 'Authentication failed';
			}
		} finally {
			loading = false;
		}
	}
</script>

<main class="flex min-h-svh items-center justify-center px-4 py-10">
	<div class="w-full max-w-md rounded-2xl border bg-card/80 p-6 shadow-sm sm:p-8">
		<div class="mb-6 flex items-start justify-between gap-4">
			<div>
				<p class="text-xs tracking-wide text-muted-foreground uppercase">Mangarr Auth</p>
				<h1 class="text-2xl font-semibold">{title}</h1>
				<p class="mt-1 text-sm text-muted-foreground">{description}</p>
			</div>
			<div class="flex size-10 items-center justify-center rounded-xl bg-primary/10">
				<KeyRoundIcon class="size-5 text-primary" />
			</div>
		</div>

		<div class="mb-4 flex gap-2">
			<Button
				variant={mode === 'login' ? 'default' : 'outline'}
				size="sm"
				class="flex-1"
				onclick={() => {
					mode = 'login';
					error = null;
					info = null;
				}}
			>
				<LogInIcon class="size-4" />
				Sign In
			</Button>
			<Button
				variant={mode === 'register' ? 'default' : 'outline'}
				size="sm"
				class="flex-1"
				onclick={() => {
					mode = 'register';
					error = null;
					info = null;
				}}
			>
				<UserPlusIcon class="size-4" />
				First Admin
			</Button>
		</div>

		{#if checkingSession}
			<div class="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
				Checking existing session...
			</div>
		{:else}
			<form class="flex flex-col gap-4" onsubmit={handleSubmit}>
				<div class="flex flex-col gap-2">
					<label for="username" class="text-sm font-medium">Username</label>
					<Input
						id="username"
						type="text"
						placeholder="admin"
						autocomplete="username"
						required
						bind:value={username}
					/>
				</div>

				<div class="flex flex-col gap-2">
					<label for="password" class="text-sm font-medium">Password</label>
					<Input
						id="password"
						type="password"
						placeholder="Enter password"
						autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
						required
						bind:value={password}
					/>
					{#if mode === 'register'}
						<p class="text-xs text-muted-foreground">
							Password must be at least 10 chars with upper, lower, and number.
						</p>
					{/if}
				</div>

				<label class="flex items-center gap-2 text-sm text-muted-foreground">
					<input type="checkbox" bind:checked={rememberSession} class="size-4 rounded border" />
					Keep me signed in on this device
					{#if rememberSession}
						<Badge variant="outline" class="ml-auto">Persistent</Badge>
					{:else}
						<Badge variant="outline" class="ml-auto">Session</Badge>
					{/if}
				</label>

				{#if info}
					<div class="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-200">
						{info}
					</div>
				{/if}

				{#if error}
					<div class="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
						{error}
					</div>
				{/if}

				<Button type="submit" disabled={loading || username.trim().length === 0 || password.length === 0}>
					{#if loading}
						Please wait...
					{:else if mode === 'login'}
						Sign In
					{:else}
						Create Admin and Sign In
					{/if}
				</Button>
			</form>
		{/if}
	</div>
</main>
