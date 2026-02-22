<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	import {
		changePassword,
		createIntegrationApiKey,
		getMe,
		listIntegrationApiKeys,
		revokeIntegrationApiKey,
		rotateApiKey,
		signOut,
		type IntegrationApiKeyResource,
		type UserProfile
	} from '$lib/api/auth';
	import {
		createLibraryCollection,
		deleteLibraryCollection,
		listLibraryCollections,
		createLibraryStatus,
		deleteLibraryStatus,
		listLibraryStatuses,
		updateLibraryStatus,
		type LibraryCollectionResource,
		type LibraryUserStatusResource
	} from '$lib/api/library';
	import {
		getDownloadSettings,
		getJobsSettings,
		runCleanupNow,
		updateDownloadSettings,
		updateJobsSettings
	} from '$lib/api/settings';
	import { Button } from '$lib/elements/button';
	import { Icon } from '$lib/elements/icon';
	import { Input } from '$lib/elements/input';
	import { _ } from '$lib/i18n';

	type SettingsTab = 'account' | 'library' | 'downloads' | 'jobs' | 'about';

	let user = $state<UserProfile | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let activeTab = $state<SettingsTab>('account');

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordLoading = $state(false);
	let passwordError = $state<string | null>(null);
	let passwordSuccess = $state(false);

	let apiKeyLoading = $state(false);
	let apiKeySuccess = $state(false);
	let integrationApiKeys = $state<IntegrationApiKeyResource[]>([]);
	let integrationKeysLoading = $state(true);
	let integrationKeysError = $state<string | null>(null);
	let integrationKeyName = $state('');
	let creatingIntegrationKey = $state(false);
	let revokingIntegrationKeyId = $state<number | null>(null);
	let createdIntegrationKeyValue = $state<string | null>(null);
	let createdIntegrationKeyName = $state<string | null>(null);

	let statuses = $state<LibraryUserStatusResource[]>([]);
	let statusesLoading = $state(true);
	let statusesError = $state<string | null>(null);
	let statusSavingId = $state<number | null>(null);
	let deletingStatusId = $state<number | null>(null);
	let newStatusLabel = $state('');
	let creatingStatus = $state(false);
	let collections = $state<LibraryCollectionResource[]>([]);
	let collectionsLoading = $state(true);
	let collectionsError = $state<string | null>(null);
	let newCollectionName = $state('');
	let creatingCollection = $state(false);
	let deletingCollectionId = $state<number | null>(null);

	let downloadRootDir = $state('');
	let downloadParallelDownloads = $state(2);
	let downloadTotalBytes = $state(0);
	let downloadUsedBytes = $state(0);
	let downloadFreeBytes = $state(0);
	let downloadsSettingsLoading = $state(true);
	let downloadsSettingsSaving = $state(false);
	let downloadsSettingsError = $state<string | null>(null);
	let downloadsSettingsSuccess = $state(false);

	let jobsCleanupEnabled = $state(true);
	let jobsCleanupIntervalDays = $state(30);
	let jobsCleanupOlderThanDays = $state(30);
	let jobsCleanupBatchLimit = $state(200);
	let jobsLastCleanupAt = $state<string | null>(null);
	let jobsSettingsLoading = $state(true);
	let jobsSettingsSaving = $state(false);
	let jobsSettingsError = $state<string | null>(null);
	let jobsSettingsSuccess = $state(false);
	let jobsCleanupRunning = $state(false);
	let jobsCleanupInfo = $state<string | null>(null);

	onMount(async () => {
		try {
			user = await getMe();
			await Promise.all([
				loadLibraryStatuses(),
				loadLibraryCollections(),
				loadDownloadSettings(),
				loadIntegrationApiKeys(),
				loadJobsSettings()
			]);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to load profile';
		} finally {
			loading = false;
		}
	});

	async function loadLibraryStatuses() {
		statusesLoading = true;
		statusesError = null;
		try {
			statuses = await listLibraryStatuses();
		} catch (cause) {
			statusesError = cause instanceof Error ? cause.message : 'Failed to load statuses';
		} finally {
			statusesLoading = false;
		}
	}

	async function loadLibraryCollections() {
		collectionsLoading = true;
		collectionsError = null;
		try {
			collections = await listLibraryCollections();
		} catch (cause) {
			collectionsError = cause instanceof Error ? cause.message : 'Failed to load collections';
		} finally {
			collectionsLoading = false;
		}
	}

	async function loadDownloadSettings() {
		downloadsSettingsLoading = true;
		downloadsSettingsError = null;
		try {
			const settings = await getDownloadSettings();
			downloadRootDir = settings.root_dir;
			downloadParallelDownloads = settings.parallel_downloads;
			downloadTotalBytes = settings.total_bytes;
			downloadUsedBytes = settings.used_bytes;
			downloadFreeBytes = settings.free_bytes;
		} catch (cause) {
			downloadsSettingsError =
				cause instanceof Error ? cause.message : 'Failed to load download settings';
		} finally {
			downloadsSettingsLoading = false;
		}
	}

	async function loadIntegrationApiKeys() {
		integrationKeysLoading = true;
		integrationKeysError = null;
		try {
			integrationApiKeys = await listIntegrationApiKeys();
		} catch (cause) {
			integrationKeysError =
				cause instanceof Error ? cause.message : 'Failed to load integration API keys';
		} finally {
			integrationKeysLoading = false;
		}
	}

	async function loadJobsSettings() {
		jobsSettingsLoading = true;
		jobsSettingsError = null;
		try {
			const settings = await getJobsSettings();
			jobsCleanupEnabled = settings.cleanup_unassigned_enabled;
			jobsCleanupIntervalDays = settings.cleanup_unassigned_interval_days;
			jobsCleanupOlderThanDays = settings.cleanup_unassigned_older_than_days;
			jobsCleanupBatchLimit = settings.cleanup_unassigned_batch_limit;
			jobsLastCleanupAt = settings.last_cleanup_at ?? null;
		} catch (cause) {
			jobsSettingsError = cause instanceof Error ? cause.message : 'Failed to load jobs settings';
		} finally {
			jobsSettingsLoading = false;
		}
	}

	async function handleChangePassword(event: SubmitEvent) {
		event.preventDefault();
		if (passwordLoading) return;

		passwordError = null;
		passwordSuccess = false;

		if (newPassword !== confirmPassword) {
			passwordError = $_('settings.passwordMismatch');
			return;
		}

		if (newPassword.length < 8) {
			passwordError = $_('settings.passwordTooShort');
			return;
		}

		passwordLoading = true;
		try {
			await changePassword({
				current_password: currentPassword,
				new_password: newPassword
			});
			passwordSuccess = true;
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
		} catch (cause) {
			passwordError = cause instanceof Error ? cause.message : 'Failed to change password';
		} finally {
			passwordLoading = false;
		}
	}

	async function handleRotateApiKey() {
		if (apiKeyLoading) return;

		apiKeyLoading = true;
		apiKeySuccess = false;
		try {
			await rotateApiKey();
			apiKeySuccess = true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to rotate API key';
		} finally {
			apiKeyLoading = false;
		}
	}

	async function handleCreateIntegrationApiKey() {
		const name = integrationKeyName.trim();
		if (!name || creatingIntegrationKey) return;

		creatingIntegrationKey = true;
		integrationKeysError = null;
		try {
			const created = await createIntegrationApiKey({ name });
			createdIntegrationKeyName = created.key.name;
			createdIntegrationKeyValue = created.api_key;
			integrationKeyName = '';
			await loadIntegrationApiKeys();
		} catch (cause) {
			integrationKeysError =
				cause instanceof Error ? cause.message : 'Failed to create integration API key';
		} finally {
			creatingIntegrationKey = false;
		}
	}

	async function handleRevokeIntegrationApiKey(keyId: number) {
		if (revokingIntegrationKeyId === keyId) return;
		revokingIntegrationKeyId = keyId;
		integrationKeysError = null;
		try {
			await revokeIntegrationApiKey(keyId);
			integrationApiKeys = integrationApiKeys.filter((key) => key.id !== keyId);
		} catch (cause) {
			integrationKeysError =
				cause instanceof Error ? cause.message : 'Failed to revoke integration API key';
		} finally {
			revokingIntegrationKeyId = null;
		}
	}

	async function copyCreatedIntegrationApiKey() {
		if (!createdIntegrationKeyValue) return;
		try {
			await navigator.clipboard.writeText(createdIntegrationKeyValue);
		} catch {
			// Ignore clipboard errors, key remains visible for manual copy.
		}
	}

	function handleSignOut() {
		signOut();
		goto('/login', { replaceState: true });
	}

	function formatBytes(bytes: number): string {
		if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
		const value = bytes / 1024 ** exponent;
		return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
	}

	function formatDateTime(value: string | null | undefined): string {
		if (!value) return '—';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return '—';
		return parsed.toLocaleString();
	}

	function handleStatusFieldChange(statusId: number, value: string) {
		statuses = statuses.map((status) =>
			status.id === statusId
				? {
						...status,
						label: value
					}
				: status
		);
	}

	async function handleSaveStatus(statusId: number) {
		const status = statuses.find((item) => item.id === statusId);
		if (!status || statusSavingId === statusId) return;
		statusSavingId = statusId;
		statusesError = null;
		try {
			const updated = await updateLibraryStatus(statusId, {
				label: status.label,
				position: status.position
			});
			statuses = statuses.map((item) => (item.id === statusId ? updated : item));
		} catch (cause) {
			statusesError = cause instanceof Error ? cause.message : 'Failed to save status';
		} finally {
			statusSavingId = null;
		}
	}

	async function handleDeleteStatus(statusId: number) {
		if (deletingStatusId === statusId) return;
		deletingStatusId = statusId;
		statusesError = null;
		try {
			await deleteLibraryStatus(statusId);
			statuses = statuses.filter((status) => status.id !== statusId);
		} catch (cause) {
			statusesError = cause instanceof Error ? cause.message : 'Failed to delete status';
		} finally {
			deletingStatusId = null;
		}
	}

	async function handleCreateStatus() {
		const label = newStatusLabel.trim();
		if (!label || creatingStatus) return;
		creatingStatus = true;
		statusesError = null;
		try {
			const created = await createLibraryStatus({
				label,
				color: '#71717a'
			});
			statuses = [...statuses, created].sort((left, right) => left.position - right.position);
			newStatusLabel = '';
		} catch (cause) {
			statusesError = cause instanceof Error ? cause.message : 'Failed to create status';
		} finally {
			creatingStatus = false;
		}
	}

	async function handleCreateCollection() {
		const name = newCollectionName.trim();
		if (!name || creatingCollection) return;
		creatingCollection = true;
		collectionsError = null;
		try {
			const created = await createLibraryCollection({
				name,
				color: '#71717a'
			});
			collections = [...collections, created].sort((left, right) => left.position - right.position);
			newCollectionName = '';
		} catch (cause) {
			collectionsError = cause instanceof Error ? cause.message : 'Failed to create collection';
		} finally {
			creatingCollection = false;
		}
	}

	async function handleDeleteCollection(collectionId: number) {
		if (deletingCollectionId === collectionId) return;
		deletingCollectionId = collectionId;
		collectionsError = null;
		try {
			await deleteLibraryCollection(collectionId);
			collections = collections.filter((collection) => collection.id !== collectionId);
		} catch (cause) {
			collectionsError = cause instanceof Error ? cause.message : 'Failed to delete collection';
		} finally {
			deletingCollectionId = null;
		}
	}

	async function handleSaveDownloadSettings() {
		if (!downloadRootDir.trim() || downloadsSettingsSaving) return;
		const parallel = Math.round(downloadParallelDownloads);
		if (!Number.isFinite(parallel) || parallel < 1 || parallel > 16) {
			downloadsSettingsError = $_('settings.parallelDownloadsInvalid');
			return;
		}
		downloadsSettingsSaving = true;
		downloadsSettingsError = null;
		downloadsSettingsSuccess = false;
		try {
			const updated = await updateDownloadSettings({
				root_dir: downloadRootDir.trim(),
				parallel_downloads: parallel
			});
			downloadRootDir = updated.root_dir;
			downloadParallelDownloads = updated.parallel_downloads;
			downloadTotalBytes = updated.total_bytes;
			downloadUsedBytes = updated.used_bytes;
			downloadFreeBytes = updated.free_bytes;
			downloadsSettingsSuccess = true;
		} catch (cause) {
			downloadsSettingsError =
				cause instanceof Error ? cause.message : 'Failed to save download settings';
		} finally {
			downloadsSettingsSaving = false;
		}
	}

	async function handleSaveJobsSettings() {
		if (jobsSettingsSaving) return;
		jobsSettingsSaving = true;
		jobsSettingsError = null;
		jobsSettingsSuccess = false;
		jobsCleanupInfo = null;
		try {
			const updated = await updateJobsSettings({
				cleanup_unassigned_enabled: jobsCleanupEnabled,
				cleanup_unassigned_interval_days: Math.max(1, Math.round(jobsCleanupIntervalDays)),
				cleanup_unassigned_older_than_days: Math.max(1, Math.round(jobsCleanupOlderThanDays)),
				cleanup_unassigned_batch_limit: Math.max(1, Math.round(jobsCleanupBatchLimit))
			});
			jobsCleanupEnabled = updated.cleanup_unassigned_enabled;
			jobsCleanupIntervalDays = updated.cleanup_unassigned_interval_days;
			jobsCleanupOlderThanDays = updated.cleanup_unassigned_older_than_days;
			jobsCleanupBatchLimit = updated.cleanup_unassigned_batch_limit;
			jobsLastCleanupAt = updated.last_cleanup_at ?? null;
			jobsSettingsSuccess = true;
		} catch (cause) {
			jobsSettingsError = cause instanceof Error ? cause.message : 'Failed to save jobs settings';
		} finally {
			jobsSettingsSaving = false;
		}
	}

	async function handleRunCleanupNow() {
		if (jobsCleanupRunning) return;
		jobsCleanupRunning = true;
		jobsSettingsError = null;
		jobsCleanupInfo = null;
		try {
			const result = await runCleanupNow();
			jobsLastCleanupAt = result.ran_at ?? jobsLastCleanupAt;
			jobsCleanupInfo = $_('settings.cleanupRunResult', {
				values: { count: result.deleted_titles }
			});
		} catch (cause) {
			jobsSettingsError = cause instanceof Error ? cause.message : 'Failed to run cleanup';
		} finally {
			jobsCleanupRunning = false;
		}
	}
</script>

<svelte:head>
	<title>{$_('nav.settings')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex items-center justify-between">
		<h1 class="text-display text-xl text-[var(--text)]">{$_('nav.settings').toLowerCase()}</h1>
	</div>

	{#if loading}
		<div class="flex flex-col items-center gap-4 py-16">
			<Icon name="loader" size={24} class="animate-spin text-[var(--text-muted)]" />
			<p class="text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
		</div>
	{:else if error && !user}
		<div class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-4 py-3 text-sm text-[var(--error)]">
			{error}
		</div>
	{:else}
		<div class="flex flex-wrap gap-2 border-b border-[var(--line)] pb-3">
			<button
				type="button"
				class="border px-3 py-1.5 text-xs transition-colors {activeTab === 'account'
					? 'border-[var(--text)] bg-[var(--void-2)] text-[var(--text)]'
					: 'border-[var(--line)] text-[var(--text-ghost)] hover:border-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
				onclick={() => (activeTab = 'account')}
			>
				{$_('settings.account')}
			</button>
			<button
				type="button"
				class="border px-3 py-1.5 text-xs transition-colors {activeTab === 'library'
					? 'border-[var(--text)] bg-[var(--void-2)] text-[var(--text)]'
					: 'border-[var(--line)] text-[var(--text-ghost)] hover:border-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
				onclick={() => (activeTab = 'library')}
			>
				{$_('nav.library')}
			</button>
			<button
				type="button"
				class="border px-3 py-1.5 text-xs transition-colors {activeTab === 'downloads'
					? 'border-[var(--text)] bg-[var(--void-2)] text-[var(--text)]'
					: 'border-[var(--line)] text-[var(--text-ghost)] hover:border-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
				onclick={() => (activeTab = 'downloads')}
			>
				{$_('nav.downloads')}
			</button>
			<button
				type="button"
				class="border px-3 py-1.5 text-xs transition-colors {activeTab === 'jobs'
					? 'border-[var(--text)] bg-[var(--void-2)] text-[var(--text)]'
					: 'border-[var(--line)] text-[var(--text-ghost)] hover:border-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
				onclick={() => (activeTab = 'jobs')}
			>
				{$_('settings.jobs')}
			</button>
			<button
				type="button"
				class="border px-3 py-1.5 text-xs transition-colors {activeTab === 'about'
					? 'border-[var(--text)] bg-[var(--void-2)] text-[var(--text)]'
					: 'border-[var(--line)] text-[var(--text-ghost)] hover:border-[var(--text-ghost)] hover:text-[var(--text-muted)]'}"
				onclick={() => (activeTab = 'about')}
			>
				{$_('settings.about')}
			</button>
		</div>

		{#if activeTab === 'account'}
			<section class="border border-[var(--line)] bg-[var(--void-2)] p-4">
				<h2 class="text-sm font-medium text-[var(--text)]">{$_('settings.account')}</h2>
				<div class="mt-3 space-y-2 text-sm">
					<div class="flex items-center justify-between">
						<span class="text-[var(--text-ghost)]">{$_('settings.username')}</span>
						<span class="text-[var(--text)]">{user?.username}</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="text-[var(--text-ghost)]">{$_('settings.role')}</span>
						<span class="text-[var(--text)]"
							>{user?.is_admin ? $_('settings.roleAdmin') : $_('settings.roleUser')}</span
						>
					</div>
				</div>
			</section>

			<section class="border border-[var(--line)] bg-[var(--void-2)] p-4">
				<h2 class="text-sm font-medium text-[var(--text)]">{$_('settings.changePassword')}</h2>
				<form class="mt-4 flex flex-col gap-4" onsubmit={handleChangePassword}>
					<Input
						type="password"
						label={$_('settings.currentPassword')}
						bind:value={currentPassword}
						required
						autocomplete="current-password"
					/>
					<Input
						type="password"
						label={$_('settings.newPassword')}
						bind:value={newPassword}
						required
						autocomplete="new-password"
					/>
					<Input
						type="password"
						label={$_('settings.confirmPassword')}
						bind:value={confirmPassword}
						required
						autocomplete="new-password"
					/>

					{#if passwordError}
						<div
							class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-4 py-3 text-sm text-[var(--error)]"
						>
							{passwordError}
						</div>
					{/if}

					{#if passwordSuccess}
						<div
							class="border border-[var(--success)]/20 bg-[var(--success-soft)] px-4 py-3 text-sm text-[var(--success)]"
						>
							{$_('settings.passwordChanged')}
						</div>
					{/if}

					<Button
						type="submit"
						variant="outline"
						size="sm"
						disabled={passwordLoading || !currentPassword || !newPassword || !confirmPassword}
						loading={passwordLoading}
						class="self-start"
					>
						{$_('settings.updatePassword')}
					</Button>
				</form>
			</section>

			<section class="border border-[var(--line)] bg-[var(--void-2)] p-4">
				<h2 class="text-sm font-medium text-[var(--text)]">{$_('settings.apiKey')}</h2>
				<p class="mt-1 text-xs text-[var(--text-ghost)]">{$_('settings.apiKeyDescription')}</p>
				<div class="mt-4 flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onclick={handleRotateApiKey}
						disabled={apiKeyLoading}
						loading={apiKeyLoading}
					>
						<Icon name="refresh" size={14} />
						{$_('settings.rotateApiKey')}
					</Button>
					{#if apiKeySuccess}
						<span class="text-xs text-[var(--success)]">{$_('settings.apiKeyRotated')}</span>
					{/if}
				</div>

				<div class="mt-6 border-t border-[var(--line)] pt-4">
					<h3 class="text-xs font-medium tracking-[0.08em] text-[var(--text-muted)] uppercase">
						{$_('settings.integrationApiKeys')}
					</h3>
					<p class="mt-1 text-xs text-[var(--text-ghost)]">
						{$_('settings.integrationApiKeysDescription')}
					</p>

					<div class="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
						<input
							type="text"
							class="h-9 border border-[var(--line)] bg-[var(--void-3)] px-3 text-sm text-[var(--text)] focus:border-[var(--void-6)] focus:outline-none"
							placeholder={$_('settings.integrationApiKeyNamePlaceholder')}
							bind:value={integrationKeyName}
						/>
						<Button
							variant="outline"
							size="sm"
							onclick={handleCreateIntegrationApiKey}
							disabled={!integrationKeyName.trim() || creatingIntegrationKey}
							loading={creatingIntegrationKey}
						>
							{$_('settings.createIntegrationApiKey')}
						</Button>
					</div>

					{#if createdIntegrationKeyValue}
						<div class="mt-3 border border-[var(--line)] bg-[var(--void-3)] p-3">
							<p class="text-xs text-[var(--text-ghost)]">
								{$_('settings.integrationApiKeyCreated', {
									values: { name: createdIntegrationKeyName ?? '' }
								})}
							</p>
							<p class="mt-2 break-all font-mono text-xs text-[var(--text)]">
								{createdIntegrationKeyValue}
							</p>
							<div class="mt-2 flex gap-2">
								<Button variant="ghost" size="sm" onclick={copyCreatedIntegrationApiKey}>
									{$_('settings.copyKey')}
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onclick={() => {
										createdIntegrationKeyValue = null;
										createdIntegrationKeyName = null;
									}}
								>
									{$_('common.close')}
								</Button>
							</div>
						</div>
					{/if}

					{#if integrationKeysLoading}
						<p class="mt-3 text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
					{:else if integrationApiKeys.length === 0}
						<p class="mt-3 text-sm text-[var(--text-ghost)]">{$_('settings.noIntegrationApiKeys')}</p>
					{:else}
						<div class="mt-3 flex flex-col gap-2">
							{#each integrationApiKeys as key (key.id)}
								<div
									class="grid gap-2 border border-[var(--line)] bg-[var(--void-3)] p-3 md:grid-cols-[1fr_auto]"
								>
									<div class="min-w-0">
										<p class="truncate text-sm text-[var(--text)]">{key.name}</p>
										<p class="mt-1 text-xs text-[var(--text-ghost)]">
											{key.key_prefix} • {$_('settings.createdAt')}:
											{formatDateTime(key.created_at)}
										</p>
										{#if key.last_used_at}
											<p class="mt-1 text-xs text-[var(--text-ghost)]">
												{$_('settings.lastUsedAt')}: {formatDateTime(key.last_used_at)}
											</p>
										{/if}
									</div>
									<div class="flex items-center">
										<Button
											variant="ghost"
											size="sm"
											onclick={() => handleRevokeIntegrationApiKey(key.id)}
											disabled={revokingIntegrationKeyId === key.id}
											loading={revokingIntegrationKeyId === key.id}
										>
											{$_('settings.revokeKey')}
										</Button>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					{#if integrationKeysError}
						<p class="mt-3 text-xs text-[var(--error)]">{integrationKeysError}</p>
					{/if}
				</div>
			</section>

			<section class="border border-[var(--line)] bg-[var(--void-2)] p-4">
				<h2 class="text-sm font-medium text-[var(--text)]">{$_('settings.session')}</h2>
				<p class="mt-1 text-xs text-[var(--text-ghost)]">{$_('settings.sessionDescription')}</p>
				<div class="mt-4">
					<Button variant="outline" size="sm" onclick={handleSignOut}>
						<Icon name="arrow-left" size={14} />
						{$_('settings.signOut')}
					</Button>
				</div>
			</section>
		{:else if activeTab === 'library'}
			<section class="border border-[var(--line)] bg-[var(--void-2)] p-4">
				<h2 class="text-sm font-medium text-[var(--text)]">{$_('settings.libraryStatuses')}</h2>
				<p class="mt-1 text-xs text-[var(--text-ghost)]">{$_('settings.libraryStatusesDescription')}</p>
				{#if statusesLoading}
					<p class="mt-3 text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
				{:else}
					<div class="mt-4 flex flex-col gap-2">
						{#each statuses as status (status.id)}
							<div
								class="grid gap-2 border border-[var(--line)] bg-[var(--void-3)] p-3 md:grid-cols-[1fr_auto_auto]"
							>
								<input
									type="text"
									class="h-9 border border-[var(--line)] bg-[var(--void-2)] px-3 text-sm text-[var(--text)] focus:border-[var(--void-6)] focus:outline-none"
									value={status.label}
									oninput={(event) =>
										handleStatusFieldChange(status.id, (event.currentTarget as HTMLInputElement).value)}
								/>
								<div class="flex items-center">
									<span class="text-xs text-[var(--text-ghost)]">{status.key}</span>
								</div>
								<div class="flex items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										onclick={() => handleSaveStatus(status.id)}
										disabled={statusSavingId === status.id}
										loading={statusSavingId === status.id}
									>
										{$_('common.save')}
									</Button>
									{#if !status.is_default}
										<Button
											variant="ghost"
											size="sm"
											onclick={() => handleDeleteStatus(status.id)}
											disabled={deletingStatusId === status.id}
											loading={deletingStatusId === status.id}
										>
											{$_('common.delete')}
										</Button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
					<div class="mt-4 grid gap-2 border border-[var(--line)] bg-[var(--void-3)] p-3 md:grid-cols-[1fr_auto]">
						<input
							type="text"
							class="h-9 border border-[var(--line)] bg-[var(--void-2)] px-3 text-sm text-[var(--text)] focus:border-[var(--void-6)] focus:outline-none"
							placeholder={$_('settings.newStatusPlaceholder')}
							bind:value={newStatusLabel}
						/>
						<Button
							variant="outline"
							size="sm"
							onclick={handleCreateStatus}
							disabled={!newStatusLabel.trim() || creatingStatus}
							loading={creatingStatus}
						>
							{$_('common.add')}
						</Button>
					</div>
				{/if}
				{#if statusesError}
					<p class="mt-3 text-xs text-[var(--error)]">{statusesError}</p>
				{/if}
			</section>
			<section class="border border-[var(--line)] bg-[var(--void-2)] p-4">
				<h2 class="text-sm font-medium text-[var(--text)]">{$_('settings.libraryCollections')}</h2>
				<p class="mt-1 text-xs text-[var(--text-ghost)]">
					{$_('settings.libraryCollectionsDescription')}
				</p>
				{#if collectionsLoading}
					<p class="mt-3 text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
				{:else}
					{#if collections.length === 0}
						<p class="mt-3 text-sm text-[var(--text-ghost)]">{$_('settings.noCollections')}</p>
					{:else}
						<div class="mt-4 flex flex-col gap-2">
							{#each collections as collection (collection.id)}
								<div
									class="grid gap-2 border border-[var(--line)] bg-[var(--void-3)] p-3 md:grid-cols-[1fr_auto]"
								>
									<div class="min-w-0">
										<p class="truncate text-sm text-[var(--text)]">{collection.name}</p>
										<p class="mt-1 text-xs text-[var(--text-ghost)]">
											{$_('settings.collectionTitlesCount', {
												values: { count: collection.titles_count }
											})}
										</p>
									</div>
									<div class="flex items-center gap-2">
										<Button
											variant="ghost"
											size="sm"
											onclick={() => handleDeleteCollection(collection.id)}
											disabled={deletingCollectionId === collection.id}
											loading={deletingCollectionId === collection.id}
										>
											{$_('common.delete')}
										</Button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
					<div class="mt-4 grid gap-2 border border-[var(--line)] bg-[var(--void-3)] p-3 md:grid-cols-[1fr_auto]">
						<input
							type="text"
							class="h-9 border border-[var(--line)] bg-[var(--void-2)] px-3 text-sm text-[var(--text)] focus:border-[var(--void-6)] focus:outline-none"
							placeholder={$_('settings.newCollectionPlaceholder')}
							bind:value={newCollectionName}
						/>
						<Button
							variant="outline"
							size="sm"
							onclick={handleCreateCollection}
							disabled={!newCollectionName.trim() || creatingCollection}
							loading={creatingCollection}
						>
							{$_('common.add')}
						</Button>
					</div>
				{/if}
				{#if collectionsError}
					<p class="mt-3 text-xs text-[var(--error)]">{collectionsError}</p>
				{/if}
			</section>
		{:else if activeTab === 'downloads'}
			<section class="border border-[var(--line)] bg-[var(--void-2)] p-4">
				<h2 class="text-sm font-medium text-[var(--text)]">{$_('settings.downloadSettings')}</h2>
				<p class="mt-1 text-xs text-[var(--text-ghost)]">{$_('settings.downloadSettingsDescription')}</p>
				{#if downloadsSettingsLoading}
					<p class="mt-3 text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
				{:else}
					<div class="mt-4 flex flex-col gap-3">
						<Input
							label={$_('settings.downloadPath')}
							bind:value={downloadRootDir}
							placeholder="/path/to/downloads"
						/>
						<div class="flex flex-col gap-1.5">
							<label class="text-label" for="parallel-downloads">
								{$_('settings.parallelDownloads')}
							</label>
							<input
								id="parallel-downloads"
								type="number"
								min="1"
								max="16"
								step="1"
								class="h-12 w-full border border-[var(--line)] bg-[var(--void-2)] px-4 text-sm text-[var(--text)] focus:border-[var(--void-6)] focus:outline-none"
								value={downloadParallelDownloads}
								oninput={(event) => {
									const raw = Number((event.currentTarget as HTMLInputElement).value);
									downloadParallelDownloads = Number.isFinite(raw) ? raw : 1;
								}}
							/>
							<p class="text-xs text-[var(--text-ghost)]">
								{$_('settings.parallelDownloadsDescription')}
							</p>
						</div>
						<div class="grid grid-cols-3 gap-2 text-xs">
							<div class="border border-[var(--line)] bg-[var(--void-3)] p-2">
								<p class="text-[var(--text-ghost)]">{$_('settings.totalSpace')}</p>
								<p class="mt-1 text-[var(--text)]">{formatBytes(downloadTotalBytes)}</p>
							</div>
							<div class="border border-[var(--line)] bg-[var(--void-3)] p-2">
								<p class="text-[var(--text-ghost)]">{$_('settings.usedSpace')}</p>
								<p class="mt-1 text-[var(--text)]">{formatBytes(downloadUsedBytes)}</p>
							</div>
							<div class="border border-[var(--line)] bg-[var(--void-3)] p-2">
								<p class="text-[var(--text-ghost)]">{$_('settings.freeSpace')}</p>
								<p class="mt-1 text-[var(--text)]">{formatBytes(downloadFreeBytes)}</p>
							</div>
						</div>
						<div class="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onclick={handleSaveDownloadSettings}
								disabled={!downloadRootDir.trim() || downloadsSettingsSaving}
								loading={downloadsSettingsSaving}
							>
								{$_('common.save')}
							</Button>
							<Button variant="ghost" size="sm" onclick={loadDownloadSettings}>
								{$_('common.refresh')}
							</Button>
						</div>
					</div>
				{/if}
				{#if downloadsSettingsError}
					<p class="mt-3 text-xs text-[var(--error)]">{downloadsSettingsError}</p>
				{/if}
				{#if downloadsSettingsSuccess}
					<p class="mt-3 text-xs text-[var(--success)]">{$_('settings.downloadSettingsSaved')}</p>
				{/if}
			</section>
		{:else if activeTab === 'jobs'}
			<section class="border border-[var(--line)] bg-[var(--void-2)] p-4">
				<h2 class="text-sm font-medium text-[var(--text)]">{$_('settings.jobs')}</h2>
				<p class="mt-1 text-xs text-[var(--text-ghost)]">{$_('settings.jobsDescription')}</p>
				{#if jobsSettingsLoading}
					<p class="mt-3 text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
				{:else}
					<div class="mt-4 flex flex-col gap-3">
						<label class="flex items-center gap-2 text-sm text-[var(--text)]">
							<input
								type="checkbox"
								checked={jobsCleanupEnabled}
								onchange={(event) => {
									jobsCleanupEnabled = (event.currentTarget as HTMLInputElement).checked;
								}}
							/>
							{$_('settings.cleanupUnassignedEnabled')}
						</label>
						<div class="grid gap-3 md:grid-cols-3">
							<div class="flex flex-col gap-1">
								<label for="jobs-cleanup-interval-days" class="text-xs text-[var(--text-ghost)]"
									>{$_('settings.cleanupIntervalDays')}</label
								>
								<input
									id="jobs-cleanup-interval-days"
									type="number"
									min="1"
									max="365"
									class="h-10 border border-[var(--line)] bg-[var(--void-3)] px-3 text-sm text-[var(--text)]"
									value={jobsCleanupIntervalDays}
									oninput={(event) => {
										const raw = Number((event.currentTarget as HTMLInputElement).value);
										jobsCleanupIntervalDays = Number.isFinite(raw) ? raw : 30;
									}}
								/>
							</div>
							<div class="flex flex-col gap-1">
								<label for="jobs-cleanup-older-than-days" class="text-xs text-[var(--text-ghost)]"
									>{$_('settings.cleanupOlderThanDays')}</label
								>
								<input
									id="jobs-cleanup-older-than-days"
									type="number"
									min="1"
									max="3650"
									class="h-10 border border-[var(--line)] bg-[var(--void-3)] px-3 text-sm text-[var(--text)]"
									value={jobsCleanupOlderThanDays}
									oninput={(event) => {
										const raw = Number((event.currentTarget as HTMLInputElement).value);
										jobsCleanupOlderThanDays = Number.isFinite(raw) ? raw : 30;
									}}
								/>
							</div>
							<div class="flex flex-col gap-1">
								<label for="jobs-cleanup-batch-limit" class="text-xs text-[var(--text-ghost)]"
									>{$_('settings.cleanupBatchLimit')}</label
								>
								<input
									id="jobs-cleanup-batch-limit"
									type="number"
									min="1"
									max="5000"
									class="h-10 border border-[var(--line)] bg-[var(--void-3)] px-3 text-sm text-[var(--text)]"
									value={jobsCleanupBatchLimit}
									oninput={(event) => {
										const raw = Number((event.currentTarget as HTMLInputElement).value);
										jobsCleanupBatchLimit = Number.isFinite(raw) ? raw : 200;
									}}
								/>
							</div>
						</div>
						<p class="text-xs text-[var(--text-ghost)]">
							{$_('settings.lastCleanupAt')}: {formatDateTime(jobsLastCleanupAt)}
						</p>
						<div class="flex flex-wrap gap-2">
							<Button
								variant="outline"
								size="sm"
								onclick={handleSaveJobsSettings}
								disabled={jobsSettingsSaving}
								loading={jobsSettingsSaving}
							>
								{$_('common.save')}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onclick={handleRunCleanupNow}
								disabled={jobsCleanupRunning}
								loading={jobsCleanupRunning}
							>
								{$_('settings.runCleanupNow')}
							</Button>
						</div>
					</div>
				{/if}
				{#if jobsSettingsError}
					<p class="mt-3 text-xs text-[var(--error)]">{jobsSettingsError}</p>
				{/if}
				{#if jobsSettingsSuccess}
					<p class="mt-3 text-xs text-[var(--success)]">{$_('settings.jobsSettingsSaved')}</p>
				{/if}
				{#if jobsCleanupInfo}
					<p class="mt-3 text-xs text-[var(--text-muted)]">{jobsCleanupInfo}</p>
				{/if}
			</section>
		{:else}
			<section class="border border-[var(--line)] bg-[var(--void-2)] p-4">
				<h2 class="text-sm font-medium text-[var(--text)]">{$_('settings.about')}</h2>
				<div class="mt-3 space-y-2 text-sm">
					<div class="flex items-center justify-between">
						<span class="text-[var(--text-ghost)]">{$_('app.name')}</span>
						<span class="text-[var(--text)]">v2.0.0</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="text-[var(--text-ghost)]">{$_('settings.domain')}</span>
						<span class="text-[var(--text)]">hmphin.space</span>
					</div>
				</div>
			</section>
		{/if}
	{/if}
</div>
