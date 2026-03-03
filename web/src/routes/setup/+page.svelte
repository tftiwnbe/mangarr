<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	import { getMe } from '$lib/api/auth';
	import {
		listInstalledExtensions,
		updateExtensionRepository,
		type RepoExtensionResource
	} from '$lib/api/extensions';
	import { clearAuthSession, getStoredApiKey } from '$lib/api/session';
	import { Button } from '$lib/elements/button';
	import { Input } from '$lib/elements/input';
	import { Icon } from '$lib/elements/icon';
	import { _ } from '$lib/i18n';
	import {
		SUPPORTED_LOCALES,
		LOCALE_META,
		setStoredLocale,
		locale,
		type SupportedLocale
	} from '$lib/i18n';
	import {
		setContentLanguages,
		setKnownContentLanguages
	} from '$lib/stores/content-languages';

	let step = $state(1);
	let repoUrl = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let checkingAuth = $state(true);
	let mounted = $state(false);

	// Step 2: content languages
	let repoExtensions = $state<RepoExtensionResource[]>([]);
	let selectedContentLangs = $state<Set<string>>(new Set());

	const availableContentLangs = $derived.by(() => {
		const langs = new Set(repoExtensions.map((e) => e.lang.toLowerCase()));
		return [...langs].sort((a, b) => {
			if (a === 'multi') return -1;
			if (b === 'multi') return 1;
			return a.localeCompare(b);
		});
	});

	// Default repository URL suggestion
	const defaultRepoUrl = 'https://raw.githubusercontent.com/your-org/extensions/main/index.json';

	onMount(async () => {
		mounted = true;

		// Check if authenticated
		const apiKey = getStoredApiKey();
		if (!apiKey) {
			await goto('/login?redirect=/setup');
			return;
		}

		try {
			await getMe();

			// Check if already has extensions configured
			const extensions = await listInstalledExtensions();
			if (extensions.length > 0) {
				// Already set up, redirect to home
				await goto('/');
				return;
			}
		} catch {
			clearAuthSession();
			await goto('/login?redirect=/setup');
			return;
		} finally {
			checkingAuth = false;
		}
	});

	async function handleRepoSubmit() {
		if (!repoUrl.trim()) return;

		loading = true;
		error = null;

		try {
			const result = await updateExtensionRepository({ url: repoUrl.trim() });
			repoExtensions = result;
			// Persist known languages
			setKnownContentLanguages(result.map((e) => e.lang));
			step = 2;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to configure repository';
		} finally {
			loading = false;
		}
	}

	function handleToggleContentLang(lang: string) {
		const next = new Set(selectedContentLangs);
		if (next.has(lang)) {
			next.delete(lang);
		} else {
			next.add(lang);
		}
		selectedContentLangs = next;
	}

	async function handleContentLangsComplete() {
		await setContentLanguages([...selectedContentLangs]);
		step = 3;
	}

	function handleSelectAllContentLangs() {
		selectedContentLangs = new Set(availableContentLangs);
	}

	function handleLanguageSelect(lang: SupportedLocale) {
		setStoredLocale(lang);
	}

	async function handleComplete() {
		await goto('/library');
	}
</script>

<svelte:head>
	<title>{$_('setup.title')} | {$_('app.name')}</title>
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
		{#each Array(40) as _, i}
			<div
				class="absolute rounded-full bg-white animate-pulse-glow"
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

		<!-- Orbital ring -->
		<div
			class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[900px] w-[900px] animate-spin-slow opacity-[0.03]"
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
			</svg>
		</div>
	</div>

	<!-- Main content -->
	<div
		class="relative z-10 w-full max-w-md {mounted ? 'animate-slide-up' : 'opacity-0'}"
		style="animation-fill-mode: backwards; animation-delay: 100ms"
	>
		{#if checkingAuth}
			<div class="flex flex-col items-center gap-6">
				<Icon name="loader" size={24} class="text-[var(--text-muted)]" />
			</div>
		{:else}
			<!-- Logo -->
			<div class="mb-8 text-center">
				<h1 class="text-display text-xl text-[var(--text)]">
					{$_('setup.title').toLowerCase()}
				</h1>
			</div>

			<!-- Step indicator -->
			<div class="mb-6 flex items-center justify-center gap-3">
				<div
					class="flex h-7 w-7 items-center justify-center text-xs font-medium transition-colors {step >= 1
						? 'bg-[var(--void-5)] text-[var(--text)] border border-[var(--void-6)]'
						: 'bg-[var(--void-3)] text-[var(--text-ghost)] border border-[var(--line)]'}"
				>
					{#if step > 1}
						<Icon name="check" size={12} />
					{:else}
						1
					{/if}
				</div>
				<div class="h-px w-8 bg-[var(--line)]"></div>
				<div
					class="flex h-7 w-7 items-center justify-center text-xs font-medium transition-colors {step >= 2
						? 'bg-[var(--void-5)] text-[var(--text)] border border-[var(--void-6)]'
						: 'bg-[var(--void-3)] text-[var(--text-ghost)] border border-[var(--line)]'}"
				>
					{#if step > 2}
						<Icon name="check" size={12} />
					{:else}
						2
					{/if}
				</div>
				<div class="h-px w-8 bg-[var(--line)]"></div>
				<div
					class="flex h-7 w-7 items-center justify-center text-xs font-medium transition-colors {step >= 3
						? 'bg-[var(--void-5)] text-[var(--text)] border border-[var(--void-6)]'
						: 'bg-[var(--void-3)] text-[var(--text-ghost)] border border-[var(--line)]'}"
				>
					3
				</div>
			</div>

			<!-- Card -->
			<div class="border-flow">
				<div class="border border-[var(--line)] bg-[var(--surface)] p-6">
					{#if step === 1}
						<!-- Step 1: Repository URL -->
						<div class="mb-6 text-center">
							<div class="mx-auto mb-3 flex h-10 w-10 items-center justify-center border border-[var(--line)] bg-[var(--void-3)]">
								<Icon name="link" size={18} class="text-[var(--text-muted)]" />
							</div>
							<h2 class="text-base font-medium text-[var(--text)]">{$_('setup.repoTitle').toLowerCase()}</h2>
							<p class="mt-1 text-xs text-[var(--text-ghost)]">{$_('setup.repoDescription').toLowerCase()}</p>
						</div>

						<form class="flex flex-col gap-4" onsubmit={(e) => { e.preventDefault(); handleRepoSubmit(); }}>
							<Input
								type="url"
								label={$_('setup.repoUrl')}
								placeholder={defaultRepoUrl}
								bind:value={repoUrl}
							/>

							{#if error}
								<div class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-4 py-3 text-sm text-[var(--error)] animate-fade-in">
									{error}
								</div>
							{/if}

							<Button
								type="submit"
								size="lg"
								disabled={loading || !repoUrl.trim()}
								loading={loading}
								class="w-full justify-center"
							>
								{#if loading}
									{$_('common.loading').toLowerCase()}
								{:else}
									{$_('common.next').toLowerCase()}
								{/if}
							</Button>

							<button
								type="button"
								class="text-center text-xs text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
								onclick={() => (step = 3)}
							>
								{$_('setup.skipForNow').toLowerCase()}
							</button>
						</form>
					{:else if step === 2}
						<!-- Step 2: Content Languages -->
						<div class="mb-6 text-center">
							<div class="mx-auto mb-3 flex h-10 w-10 items-center justify-center border border-[var(--line)] bg-[var(--void-3)]">
								<Icon name="globe" size={18} class="text-[var(--text-muted)]" />
							</div>
							<h2 class="text-base font-medium text-[var(--text)]">content languages</h2>
							<p class="mt-1 text-xs text-[var(--text-ghost)]">select which languages you want to see in your sources</p>
						</div>

						{#if availableContentLangs.length > 0}
							<div class="flex items-center justify-between mb-3">
								<span class="text-[11px] text-[var(--text-ghost)]">
									{selectedContentLangs.size === 0
										? 'none selected — all will be shown'
										: `${selectedContentLangs.size} selected`}
								</span>
								<button
									type="button"
									class="text-[10px] text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
									onclick={handleSelectAllContentLangs}
								>
									select all
								</button>
							</div>

							<div class="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto no-scrollbar">
								{#each availableContentLangs as lang}
									{@const isSelected = selectedContentLangs.has(lang)}
									<button
										type="button"
										class="h-8 min-w-[36px] px-2.5 text-[10px] uppercase tracking-wider transition-all
											{isSelected
											? 'bg-[var(--void-5)] text-[var(--text)] border border-[var(--void-6)]'
											: 'text-[var(--text-ghost)] border border-[var(--line)] hover:text-[var(--text-muted)] hover:border-[var(--void-5)]'}"
										onclick={() => handleToggleContentLang(lang)}
									>
										{lang}
									</button>
								{/each}
							</div>
						{:else}
							<p class="text-xs text-[var(--text-ghost)] text-center py-4">
								no repository configured — skip to continue
							</p>
						{/if}

						<Button
							size="lg"
							class="mt-6 w-full justify-center"
							onclick={handleContentLangsComplete}
						>
							{$_('common.next').toLowerCase()}
						</Button>

						<button
							type="button"
							class="mt-3 w-full text-center text-xs text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
							onclick={() => (step = 3)}
						>
							{$_('setup.skipForNow').toLowerCase()}
						</button>
					{:else if step === 3}
						<!-- Step 3: UI Language -->
						<div class="mb-6 text-center">
							<h2 class="text-base font-medium text-[var(--text)]">{$_('setup.languageTitle').toLowerCase()}</h2>
							<p class="mt-1 text-xs text-[var(--text-ghost)]">{$_('setup.languageDescription').toLowerCase()}</p>
						</div>

						<div class="flex flex-col gap-2">
							{#each SUPPORTED_LOCALES as lang}
								<button
									type="button"
									class="flex w-full items-center gap-3 border p-3 text-left transition-all hover:bg-[var(--void-3)] {$locale === lang
										? 'border-[var(--void-6)] bg-[var(--void-3)]'
										: 'border-[var(--line)]'}"
									onclick={() => handleLanguageSelect(lang)}
								>
									<span class="text-lg">{LOCALE_META[lang].flag}</span>
									<div class="flex-1">
										<div class="text-sm text-[var(--text)]">{LOCALE_META[lang].nativeName}</div>
										<div class="text-xs text-[var(--text-ghost)]">{LOCALE_META[lang].name}</div>
									</div>
									{#if $locale === lang}
										<Icon name="check" size={14} class="text-[var(--text)]" />
									{/if}
								</button>
							{/each}
						</div>

						<Button
							size="lg"
							class="mt-6 w-full justify-center"
							onclick={handleComplete}
						>
							{$_('setup.getStarted').toLowerCase()}
						</Button>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<!-- Domain watermark -->
	<div class="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-mono text-[var(--void-6)] tracking-wider">
		hmphin.space
	</div>
</main>
