<script lang="ts">
	import { onMount } from 'svelte';

	import { Button } from '$lib/elements/button';
	import { _ } from '$lib/i18n';

	type DownloadSettings = {
		downloadPath: string;
		compressionEnabled: boolean;
		failedRetryDelaySeconds: number;
		totalSpaceBytes: number;
		usedSpaceBytes: number;
		freeSpaceBytes: number;
	};

	type BridgeHealth = {
		bridge?: {
			status?: string;
			ready?: boolean;
			running?: boolean;
			restartCount?: number;
			lastStartupError?: string | null;
		};
		commands?: {
			lastError?: string | null;
			lastSuccessAt?: number | null;
		};
	};

	let settings = $state<DownloadSettings | null>(null);
	let health = $state<BridgeHealth | null>(null);
	let loading = $state(true);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let success = $state<string | null>(null);

	let downloadPath = $state('');
	let compressionEnabled = $state(true);
	let failedRetryDelaySeconds = $state(300);

	onMount(() => {
		void load();
	});

	async function load() {
		loading = true;
		error = null;
		success = null;

		try {
			const [settingsResponse, healthResponse] = await Promise.all([
				fetch('/api/internal/bridge/settings/downloads'),
				fetch('/api/internal/bridge/health')
			]);

			if (!settingsResponse.ok) {
				throw new Error(await readError(settingsResponse, 'Failed to load download settings'));
			}
			if (!healthResponse.ok) {
				throw new Error(await readError(healthResponse, 'Failed to load bridge health'));
			}

			settings = (await settingsResponse.json()) as DownloadSettings;
			health = (await healthResponse.json()) as BridgeHealth;
			downloadPath = settings.downloadPath;
			compressionEnabled = settings.compressionEnabled;
			failedRetryDelaySeconds = settings.failedRetryDelaySeconds;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to load settings';
		} finally {
			loading = false;
		}
	}

	async function saveDownloadSettings() {
		saving = true;
		error = null;
		success = null;

		try {
			const response = await fetch('/api/internal/bridge/settings/downloads', {
				method: 'PUT',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					downloadPath,
					compressionEnabled,
					failedRetryDelaySeconds
				})
			});

			if (!response.ok) {
				throw new Error(await readError(response, 'Failed to save download settings'));
			}

			settings = (await response.json()) as DownloadSettings;
			downloadPath = settings.downloadPath;
			compressionEnabled = settings.compressionEnabled;
			failedRetryDelaySeconds = settings.failedRetryDelaySeconds;
			success = $_('settings.downloadSettingsSaved');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to save settings';
		} finally {
			saving = false;
		}
	}

	function formatBytes(value?: number | null) {
		if (!value || value <= 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let size = value;
		let unitIndex = 0;
		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex += 1;
		}
		return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
	}

	async function readError(response: Response, fallback: string) {
		const payload = (await response.json().catch(() => null)) as { message?: string } | null;
		return payload?.message ?? fallback;
	}
</script>

<svelte:head>
	<title>{$_('nav.settings')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex items-center gap-3">
		<h1 class="text-display flex-1 text-xl text-[var(--text)]">{$_('nav.settings').toLowerCase()}</h1>
		<Button size="sm" variant="outline" disabled={loading || saving} onclick={() => void load()}>
			Refresh
		</Button>
	</div>

	{#if error}
		<div class="border border-red-400/50 bg-red-100/80 px-4 py-3 text-sm text-red-900">{error}</div>
	{/if}

	{#if success}
		<div class="border border-emerald-400/50 bg-emerald-100/80 px-4 py-3 text-sm text-emerald-900">
			{success}
		</div>
	{/if}

	{#if loading}
		<div class="border border-[var(--line)] bg-[var(--surface)] p-6 text-sm text-[var(--text-ghost)]">
			Loading settings…
		</div>
	{:else}
		<div class="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
			<section class="border border-[var(--line)] bg-[var(--surface)] p-6">
				<div class="mb-5">
					<h2 class="text-sm tracking-wider text-[var(--text)] uppercase">
						{$_('settings.downloadSettings')}
					</h2>
					<p class="mt-2 text-sm text-[var(--text-ghost)]">
						{$_('settings.downloadSettingsDescription')}
					</p>
				</div>

				<div class="grid gap-4">
					<label class="flex flex-col gap-2">
						<span class="text-xs tracking-wider text-[var(--text)] uppercase">
							{$_('settings.downloadPath')}
						</span>
						<input class="field" bind:value={downloadPath} placeholder="/data/downloads" />
					</label>

					<label class="flex flex-col gap-2">
						<span class="text-xs tracking-wider text-[var(--text)] uppercase">
							{$_('settings.failedChapterRetryDelay')}
						</span>
						<input
							class="field"
							type="number"
							min="60"
							max="604800"
							step="60"
							bind:value={failedRetryDelaySeconds}
						/>
						<span class="text-xs text-[var(--text-ghost)]">
							{$_('settings.failedChapterRetryDelayDescription')}
						</span>
					</label>

					<label class="flex items-start gap-3 border border-[var(--line)] p-4">
						<input type="checkbox" bind:checked={compressionEnabled} class="mt-1" />
						<div>
							<p class="text-sm text-[var(--text)]">{$_('settings.downloadCompressionEnabled')}</p>
							<p class="mt-1 text-xs text-[var(--text-ghost)]">
								{$_('settings.downloadCompressionLevelDescription')}
							</p>
						</div>
					</label>

					<div class="flex justify-end">
						<Button disabled={saving} onclick={() => void saveDownloadSettings()}>
							{saving ? 'Saving…' : 'Save download settings'}
						</Button>
					</div>
				</div>
			</section>

			<section class="flex flex-col gap-6">
				<div class="border border-[var(--line)] bg-[var(--surface)] p-6">
					<h2 class="text-sm tracking-wider text-[var(--text)] uppercase">Bridge Runtime</h2>
					<div class="mt-4 grid gap-3 text-sm text-[var(--text-muted)]">
						<div class="flex items-center justify-between gap-4">
							<span>Status</span>
							<span class="text-[var(--text)]">{health?.bridge?.status ?? 'unknown'}</span>
						</div>
						<div class="flex items-center justify-between gap-4">
							<span>Ready</span>
							<span class="text-[var(--text)]">{health?.bridge?.ready ? 'yes' : 'no'}</span>
						</div>
						<div class="flex items-center justify-between gap-4">
							<span>Running</span>
							<span class="text-[var(--text)]">{health?.bridge?.running ? 'yes' : 'no'}</span>
						</div>
						<div class="flex items-center justify-between gap-4">
							<span>Restart Count</span>
							<span class="text-[var(--text)]">{health?.bridge?.restartCount ?? 0}</span>
						</div>
						<div class="flex items-center justify-between gap-4">
							<span>Last Command Poll</span>
							<span class="text-[var(--text)]">
								{health?.commands?.lastSuccessAt
									? new Date(health.commands.lastSuccessAt).toLocaleString()
									: 'n/a'}
							</span>
						</div>
					</div>

					{#if health?.bridge?.lastStartupError || health?.commands?.lastError}
						<div class="mt-4 border border-amber-400/50 bg-amber-100/70 px-4 py-3 text-xs text-amber-950">
							{health?.bridge?.lastStartupError ?? health?.commands?.lastError}
						</div>
					{/if}
				</div>

				<div class="border border-[var(--line)] bg-[var(--surface)] p-6">
					<h2 class="text-sm tracking-wider text-[var(--text)] uppercase">Storage</h2>
					<div class="mt-4 grid gap-3 text-sm text-[var(--text-muted)]">
						<div class="flex items-center justify-between gap-4">
							<span>{$_('settings.downloadLocation')}</span>
							<span class="max-w-[16rem] text-right text-[var(--text)]">{settings?.downloadPath}</span>
						</div>
						<div class="flex items-center justify-between gap-4">
							<span>{$_('settings.totalSpace')}</span>
							<span class="text-[var(--text)]">{formatBytes(settings?.totalSpaceBytes)}</span>
						</div>
						<div class="flex items-center justify-between gap-4">
							<span>{$_('settings.usedSpace')}</span>
							<span class="text-[var(--text)]">{formatBytes(settings?.usedSpaceBytes)}</span>
						</div>
						<div class="flex items-center justify-between gap-4">
							<span>{$_('settings.freeSpace')}</span>
							<span class="text-[var(--text)]">{formatBytes(settings?.freeSpaceBytes)}</span>
						</div>
					</div>
				</div>
			</section>
		</div>
	{/if}
</div>
