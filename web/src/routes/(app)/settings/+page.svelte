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

	type ProxySettings = {
		hostname: string;
		port: number;
		username: string;
		password: string;
		ignoredAddresses: string;
		bypassLocalAddresses: boolean;
	};

	type FlareSolverrSettings = {
		enabled: boolean;
		url: string;
		timeoutSeconds: number;
		responseFallback: boolean;
		sessionName: string;
		sessionTtlMinutes?: number | null;
	};

	type IntegrationApiKey = {
		publicId: number;
		name: string;
		keyPrefix: string;
		createdAt: number;
		lastUsedAt?: number;
		revokedAt?: number;
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

	let loading = $state(true);
	let error = $state<string | null>(null);
	let success = $state<string | null>(null);

	let downloadSettings = $state<DownloadSettings | null>(null);
	let proxySettings = $state<ProxySettings | null>(null);
	let flareSolverrSettings = $state<FlareSolverrSettings | null>(null);
	let integrationApiKeys = $state<IntegrationApiKey[]>([]);
	let health = $state<BridgeHealth | null>(null);

	let savingSection = $state<'downloads' | 'proxy' | 'flaresolverr' | null>(null);
	let runtimeAction = $state<'start' | 'stop' | 'restart' | null>(null);

	let downloadPath = $state('');
	let compressionEnabled = $state(true);
	let failedRetryDelaySeconds = $state(300);

	let proxyHostname = $state('');
	let proxyPort = $state(0);
	let proxyUsername = $state('');
	let proxyPassword = $state('');
	let proxyIgnoredAddresses = $state('');
	let proxyBypassLocalAddresses = $state(true);

	let flareEnabled = $state(false);
	let flareUrl = $state('http://localhost:8191');
	let flareTimeoutSeconds = $state(45);
	let flareResponseFallback = $state(true);
	let flareSessionName = $state('');
	let flareSessionTtlMinutes = $state('');

	let integrationKeyName = $state('');
	let creatingIntegrationKey = $state(false);
	let revokingIntegrationKeyId = $state<number | null>(null);
	let createdIntegrationKey = $state<string | null>(null);

	onMount(() => {
		void load();
	});

	async function load() {
		loading = true;
		error = null;
		success = null;

		try {
			const [downloadsResponse, proxyResponse, flareResponse, keysResponse, healthResponse] = await Promise.all([
				fetch('/api/internal/bridge/settings/downloads'),
				fetch('/api/internal/bridge/settings/proxy'),
				fetch('/api/internal/bridge/settings/flaresolverr'),
				fetch('/api/auth/integration-keys'),
				fetch('/api/internal/bridge/health')
			]);

			if (!downloadsResponse.ok) {
				throw new Error(await readError(downloadsResponse, 'Failed to load download settings'));
			}
			if (!proxyResponse.ok) {
				throw new Error(await readError(proxyResponse, 'Failed to load proxy settings'));
			}
			if (!flareResponse.ok) {
				throw new Error(await readError(flareResponse, 'Failed to load FlareSolverr settings'));
			}
			if (!keysResponse.ok) {
				throw new Error(await readError(keysResponse, 'Failed to load integration keys'));
			}
			if (!healthResponse.ok) {
				throw new Error(await readError(healthResponse, 'Failed to load bridge health'));
			}

			downloadSettings = (await downloadsResponse.json()) as DownloadSettings;
			proxySettings = (await proxyResponse.json()) as ProxySettings;
			flareSolverrSettings = (await flareResponse.json()) as FlareSolverrSettings;
			integrationApiKeys = ((await keysResponse.json()) as { keys: IntegrationApiKey[] }).keys;
			health = (await healthResponse.json()) as BridgeHealth;

			downloadPath = downloadSettings.downloadPath;
			compressionEnabled = downloadSettings.compressionEnabled;
			failedRetryDelaySeconds = downloadSettings.failedRetryDelaySeconds;

			proxyHostname = proxySettings.hostname;
			proxyPort = proxySettings.port;
			proxyUsername = proxySettings.username;
			proxyPassword = proxySettings.password;
			proxyIgnoredAddresses = proxySettings.ignoredAddresses;
			proxyBypassLocalAddresses = proxySettings.bypassLocalAddresses;

			flareEnabled = flareSolverrSettings.enabled;
			flareUrl = flareSolverrSettings.url;
			flareTimeoutSeconds = flareSolverrSettings.timeoutSeconds;
			flareResponseFallback = flareSolverrSettings.responseFallback;
			flareSessionName = flareSolverrSettings.sessionName;
			flareSessionTtlMinutes =
				flareSolverrSettings.sessionTtlMinutes == null
					? ''
					: String(flareSolverrSettings.sessionTtlMinutes);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to load settings';
		} finally {
			loading = false;
		}
	}

	async function saveDownloadSettings() {
		savingSection = 'downloads';
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

			downloadSettings = (await response.json()) as DownloadSettings;
			downloadPath = downloadSettings.downloadPath;
			compressionEnabled = downloadSettings.compressionEnabled;
			failedRetryDelaySeconds = downloadSettings.failedRetryDelaySeconds;
			success = 'Download settings saved';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to save download settings';
		} finally {
			savingSection = null;
		}
	}

	async function createIntegrationKey() {
		const name = integrationKeyName.trim();
		if (!name) {
			error = 'Integration key name is required';
			return;
		}

		creatingIntegrationKey = true;
		error = null;
		success = null;
		createdIntegrationKey = null;
		try {
			const response = await fetch('/api/auth/integration-keys', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({ name })
			});
			if (!response.ok) {
				throw new Error(await readError(response, 'Failed to create integration key'));
			}

			const payload = (await response.json()) as { key: string; item: IntegrationApiKey };
			integrationApiKeys = [payload.item, ...integrationApiKeys];
			createdIntegrationKey = payload.key;
			integrationKeyName = '';
			success = 'Integration key created';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to create integration key';
		} finally {
			creatingIntegrationKey = false;
		}
	}

	async function revokeIntegrationKey(publicId: number) {
		revokingIntegrationKeyId = publicId;
		error = null;
		success = null;
		try {
			const response = await fetch(`/api/auth/integration-keys/${publicId}`, {
				method: 'DELETE'
			});
			if (!response.ok) {
				throw new Error(await readError(response, 'Failed to revoke integration key'));
			}

			integrationApiKeys = integrationApiKeys.filter((key) => key.publicId !== publicId);
			success = 'Integration key revoked';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to revoke integration key';
		} finally {
			revokingIntegrationKeyId = null;
		}
	}

	async function saveProxySettings() {
		savingSection = 'proxy';
		error = null;
		success = null;

		try {
			const response = await fetch('/api/internal/bridge/settings/proxy', {
				method: 'PUT',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					hostname: proxyHostname,
					port: proxyPort,
					username: proxyUsername || null,
					password: proxyPassword || null,
					ignoredAddresses: proxyIgnoredAddresses,
					bypassLocalAddresses: proxyBypassLocalAddresses
				})
			});

			if (!response.ok) {
				throw new Error(await readError(response, 'Failed to save proxy settings'));
			}

			proxySettings = (await response.json()) as ProxySettings;
			proxyHostname = proxySettings.hostname;
			proxyPort = proxySettings.port;
			proxyUsername = proxySettings.username;
			proxyPassword = proxySettings.password;
			proxyIgnoredAddresses = proxySettings.ignoredAddresses;
			proxyBypassLocalAddresses = proxySettings.bypassLocalAddresses;
			success = 'Proxy settings saved';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to save proxy settings';
		} finally {
			savingSection = null;
		}
	}

	async function saveFlareSolverrSettings() {
		savingSection = 'flaresolverr';
		error = null;
		success = null;

		try {
			const response = await fetch('/api/internal/bridge/settings/flaresolverr', {
				method: 'PUT',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					enabled: flareEnabled,
					url: flareUrl,
					timeoutSeconds: flareTimeoutSeconds,
					responseFallback: flareResponseFallback,
					sessionName: flareSessionName || null,
					sessionTtlMinutes:
						flareSessionTtlMinutes.trim().length === 0 ? null : Number(flareSessionTtlMinutes)
				})
			});

			if (!response.ok) {
				throw new Error(await readError(response, 'Failed to save FlareSolverr settings'));
			}

			flareSolverrSettings = (await response.json()) as FlareSolverrSettings;
			flareEnabled = flareSolverrSettings.enabled;
			flareUrl = flareSolverrSettings.url;
			flareTimeoutSeconds = flareSolverrSettings.timeoutSeconds;
			flareResponseFallback = flareSolverrSettings.responseFallback;
			flareSessionName = flareSolverrSettings.sessionName;
			flareSessionTtlMinutes =
				flareSolverrSettings.sessionTtlMinutes == null
					? ''
					: String(flareSolverrSettings.sessionTtlMinutes);
			success = 'FlareSolverr settings saved';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to save FlareSolverr settings';
		} finally {
			savingSection = null;
		}
	}

	async function runRuntimeAction(action: 'start' | 'stop' | 'restart') {
		runtimeAction = action;
		error = null;
		success = null;

		try {
			const response = await fetch(`/api/internal/bridge/runtime/${action}`, {
				method: 'POST'
			});
			if (!response.ok) {
				throw new Error(await readError(response, `Failed to ${action} bridge runtime`));
			}
			await load();
			success = `Bridge runtime ${action} request sent`;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : `Failed to ${action} bridge runtime`;
		} finally {
			runtimeAction = null;
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

	function formatDate(value?: number | null) {
		return value ? new Date(value).toLocaleString() : 'n/a';
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
		<Button size="sm" variant="outline" disabled={loading || savingSection !== null} onclick={() => void load()}>
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
		<div class="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
			<div class="flex flex-col gap-6">
				<section class="border border-[var(--line)] bg-[var(--surface)] p-6">
					<div class="mb-5">
						<h2 class="text-sm tracking-wider text-[var(--text)] uppercase">Download Settings</h2>
						<p class="mt-2 text-sm text-[var(--text-ghost)]">
							Choose where chapter files live and how failed downloads retry.
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
							<Button disabled={savingSection !== null} onclick={() => void saveDownloadSettings()}>
								{savingSection === 'downloads' ? 'Saving…' : 'Save download settings'}
							</Button>
						</div>
					</div>
				</section>

				<section class="border border-[var(--line)] bg-[var(--surface)] p-6">
					<div class="mb-5">
						<h2 class="text-sm tracking-wider text-[var(--text)] uppercase">Proxy</h2>
						<p class="mt-2 text-sm text-[var(--text-ghost)]">
							Shared HTTP proxy for extensions that have proxy usage enabled.
						</p>
					</div>

					<div class="grid gap-4">
						<label class="flex flex-col gap-2">
							<span class="text-xs tracking-wider text-[var(--text)] uppercase">Hostname</span>
							<input class="field" bind:value={proxyHostname} placeholder="proxy.example.com" />
						</label>

						<label class="flex flex-col gap-2">
							<span class="text-xs tracking-wider text-[var(--text)] uppercase">Port</span>
							<input class="field" type="number" min="0" max="65535" bind:value={proxyPort} />
						</label>

						<label class="flex flex-col gap-2">
							<span class="text-xs tracking-wider text-[var(--text)] uppercase">Username</span>
							<input class="field" bind:value={proxyUsername} placeholder="optional" />
						</label>

						<label class="flex flex-col gap-2">
							<span class="text-xs tracking-wider text-[var(--text)] uppercase">Password</span>
							<input class="field" type="password" bind:value={proxyPassword} placeholder="optional" />
						</label>

						<label class="flex flex-col gap-2">
							<span class="text-xs tracking-wider text-[var(--text)] uppercase">Ignored addresses</span>
							<input
								class="field"
								bind:value={proxyIgnoredAddresses}
								placeholder="*.hmphin.space;localhost"
							/>
							<span class="text-xs text-[var(--text-ghost)]">
								Separate patterns with `;`. Use `*` for wildcard matching.
							</span>
						</label>

						<label class="flex items-start gap-3 border border-[var(--line)] p-4">
							<input type="checkbox" bind:checked={proxyBypassLocalAddresses} class="mt-1" />
							<div>
								<p class="text-sm text-[var(--text)]">Bypass local addresses</p>
								<p class="mt-1 text-xs text-[var(--text-ghost)]">
									Skips proxying for localhost and private network ranges.
								</p>
							</div>
						</label>

						<div class="flex justify-end">
							<Button disabled={savingSection !== null} onclick={() => void saveProxySettings()}>
								{savingSection === 'proxy' ? 'Saving…' : 'Save proxy settings'}
							</Button>
						</div>
					</div>
				</section>

				<section class="border border-[var(--line)] bg-[var(--surface)] p-6">
					<div class="mb-5">
						<h2 class="text-sm tracking-wider text-[var(--text)] uppercase">FlareSolverr</h2>
						<p class="mt-2 text-sm text-[var(--text-ghost)]">
							Challenge bypass settings used by the bridge when sources hit Cloudflare protections.
						</p>
					</div>

					<div class="grid gap-4">
						<label class="flex items-start gap-3 border border-[var(--line)] p-4">
							<input type="checkbox" bind:checked={flareEnabled} class="mt-1" />
							<div>
								<p class="text-sm text-[var(--text)]">Enable FlareSolverr</p>
								<p class="mt-1 text-xs text-[var(--text-ghost)]">
									When disabled, the bridge will not attempt FlareSolverr challenge resolution.
								</p>
							</div>
						</label>

						<label class="flex flex-col gap-2">
							<span class="text-xs tracking-wider text-[var(--text)] uppercase">URL</span>
							<input class="field" bind:value={flareUrl} placeholder="http://localhost:8191" />
						</label>

						<label class="flex flex-col gap-2">
							<span class="text-xs tracking-wider text-[var(--text)] uppercase">Timeout (seconds)</span>
							<input class="field" type="number" min="5" max="300" bind:value={flareTimeoutSeconds} />
						</label>

						<label class="flex items-start gap-3 border border-[var(--line)] p-4">
							<input type="checkbox" bind:checked={flareResponseFallback} class="mt-1" />
							<div>
								<p class="text-sm text-[var(--text)]">Response fallback</p>
								<p class="mt-1 text-xs text-[var(--text-ghost)]">
									Return the direct source response if FlareSolverr is unavailable or times out.
								</p>
							</div>
						</label>

						<label class="flex flex-col gap-2">
							<span class="text-xs tracking-wider text-[var(--text)] uppercase">Session name</span>
							<input class="field" bind:value={flareSessionName} placeholder="optional" />
						</label>

						<label class="flex flex-col gap-2">
							<span class="text-xs tracking-wider text-[var(--text)] uppercase">
								Session TTL (minutes)
							</span>
							<input class="field" type="number" min="1" max="1440" bind:value={flareSessionTtlMinutes} />
						</label>

						<div class="flex justify-end">
							<Button disabled={savingSection !== null} onclick={() => void saveFlareSolverrSettings()}>
								{savingSection === 'flaresolverr' ? 'Saving…' : 'Save FlareSolverr settings'}
							</Button>
						</div>
					</div>
				</section>
			</div>

			<div class="flex flex-col gap-6">
				<section class="border border-[var(--line)] bg-[var(--surface)] p-6">
					<h2 class="text-sm tracking-wider text-[var(--text)] uppercase">Integration API Keys</h2>
					<p class="mt-2 text-sm text-[var(--text-ghost)]">
						Create tokens for scripts and external tools. New secrets are shown only once.
					</p>

					<div class="mt-4 flex flex-col gap-3">
						<label class="flex flex-col gap-2">
							<span class="text-xs tracking-wider text-[var(--text)] uppercase">Key Name</span>
							<input
								class="field"
								bind:value={integrationKeyName}
								placeholder="Komga sync"
								maxlength="120"
							/>
						</label>
						<div class="flex justify-end">
							<Button disabled={creatingIntegrationKey} onclick={() => void createIntegrationKey()}>
								{creatingIntegrationKey ? 'Creating…' : 'Create key'}
							</Button>
						</div>
					</div>

					{#if createdIntegrationKey}
						<div class="mt-4 border border-amber-400/50 bg-amber-100/80 px-4 py-3 text-xs text-amber-950">
							<div class="font-semibold">Copy this key now</div>
							<div class="mt-1 font-mono break-all">{createdIntegrationKey}</div>
						</div>
					{/if}

					<div class="mt-4 flex flex-col gap-3">
						{#if integrationApiKeys.length === 0}
							<div class="text-sm text-[var(--text-ghost)]">No integration keys yet.</div>
						{:else}
							{#each integrationApiKeys as key (key.publicId)}
								<div class="flex items-center justify-between gap-4 border border-[var(--line)] p-3">
									<div class="min-w-0">
										<div class="text-sm text-[var(--text)]">{key.name}</div>
										<div class="text-xs text-[var(--text-ghost)]">
											{key.keyPrefix}...
											Created {formatDate(key.createdAt)}
											{#if key.lastUsedAt}
												· Last used {formatDate(key.lastUsedAt)}
											{/if}
										</div>
									</div>
									<Button
										size="sm"
										variant="outline"
										disabled={revokingIntegrationKeyId === key.publicId}
										onclick={() => void revokeIntegrationKey(key.publicId)}
									>
										{revokingIntegrationKeyId === key.publicId ? 'Revoking…' : 'Revoke'}
									</Button>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<section class="border border-[var(--line)] bg-[var(--surface)] p-6">
					<h2 class="text-sm tracking-wider text-[var(--text)] uppercase">Bridge Runtime</h2>
					<p class="mt-2 text-sm text-[var(--text-ghost)]">
						Inspect runner state and control the in-process bridge runtime.
					</p>

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
							<span class="text-[var(--text)]">{formatDate(health?.commands?.lastSuccessAt)}</span>
						</div>
					</div>

					<div class="mt-5 flex flex-wrap gap-2">
						<Button
							size="sm"
							variant="outline"
							disabled={runtimeAction !== null}
							onclick={() => void runRuntimeAction('start')}
						>
							{runtimeAction === 'start' ? 'Starting…' : 'Start'}
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={runtimeAction !== null}
							onclick={() => void runRuntimeAction('stop')}
						>
							{runtimeAction === 'stop' ? 'Stopping…' : 'Stop'}
						</Button>
						<Button
							size="sm"
							disabled={runtimeAction !== null}
							onclick={() => void runRuntimeAction('restart')}
						>
							{runtimeAction === 'restart' ? 'Restarting…' : 'Restart'}
						</Button>
					</div>

					{#if health?.bridge?.lastStartupError || health?.commands?.lastError}
						<div class="mt-4 border border-amber-400/50 bg-amber-100/70 px-4 py-3 text-xs text-amber-950">
							{health?.bridge?.lastStartupError ?? health?.commands?.lastError}
						</div>
					{/if}
				</section>

				<section class="border border-[var(--line)] bg-[var(--surface)] p-6">
					<h2 class="text-sm tracking-wider text-[var(--text)] uppercase">Storage</h2>
					<p class="mt-2 text-sm text-[var(--text-ghost)]">
						Resolved from the bridge download root currently in use.
					</p>

					<div class="mt-4 grid gap-3 text-sm text-[var(--text-muted)]">
						<div class="flex items-center justify-between gap-4">
							<span>{$_('settings.downloadLocation')}</span>
							<span class="max-w-[16rem] text-right text-[var(--text)]">
								{downloadSettings?.downloadPath ?? 'n/a'}
							</span>
						</div>
						<div class="flex items-center justify-between gap-4">
							<span>{$_('settings.totalSpace')}</span>
							<span class="text-[var(--text)]">{formatBytes(downloadSettings?.totalSpaceBytes)}</span>
						</div>
						<div class="flex items-center justify-between gap-4">
							<span>{$_('settings.usedSpace')}</span>
							<span class="text-[var(--text)]">{formatBytes(downloadSettings?.usedSpaceBytes)}</span>
						</div>
						<div class="flex items-center justify-between gap-4">
							<span>{$_('settings.freeSpace')}</span>
							<span class="text-[var(--text)]">{formatBytes(downloadSettings?.freeSpaceBytes)}</span>
						</div>
					</div>
				</section>
			</div>
		</div>
	{/if}
</div>
