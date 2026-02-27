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
		updateLibraryCollection,
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

	type SettingsTab = 'account' | 'library' | 'system' | 'about';

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
	let collectionSavingId = $state<number | null>(null);

	const sortedCollections = $derived(
		[...collections].sort((a, b) => b.titles_count - a.titles_count)
	);

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
			setTimeout(() => (passwordSuccess = false), 3000);
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
			setTimeout(() => (apiKeySuccess = false), 3000);
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

	function handleCollectionFieldChange(collectionId: number, value: string) {
		collections = collections.map((collection) =>
			collection.id === collectionId
				? {
						...collection,
						name: value
					}
				: collection
		);
	}

	async function handleSaveCollection(collectionId: number) {
		const collection = collections.find((item) => item.id === collectionId);
		if (!collection || collectionSavingId === collectionId) return;
		collectionSavingId = collectionId;
		collectionsError = null;
		try {
			const updated = await updateLibraryCollection(collectionId, {
				name: collection.name,
				position: collection.position
			});
			collections = collections.map((item) => (item.id === collectionId ? updated : item));
		} catch (cause) {
			collectionsError = cause instanceof Error ? cause.message : 'Failed to save collection';
		} finally {
			collectionSavingId = null;
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
			setTimeout(() => (downloadsSettingsSuccess = false), 3000);
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
			setTimeout(() => (jobsSettingsSuccess = false), 3000);
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

<div class="flex flex-col gap-6 max-w-xl">
	<h1 class="text-display text-xl text-[var(--text)]">{$_('nav.settings').toLowerCase()}</h1>

	{#if loading}
		<div class="flex flex-col items-center gap-4 py-16">
			<Icon name="loader" size={24} class="animate-spin text-[var(--text-muted)]" />
			<p class="text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
		</div>
	{:else if error && !user}
		<p class="text-sm text-[var(--error)]">{error}</p>
	{:else}
		<!-- Tabs -->
		<div class="flex gap-1 overflow-x-auto no-scrollbar">
			<button
				type="button"
				class="shrink-0 px-3 py-1.5 text-xs font-medium transition-colors {activeTab === 'account'
					? 'bg-[var(--void-4)] text-[var(--text)]'
					: 'text-[var(--text-ghost)] hover:bg-[var(--void-3)] hover:text-[var(--text-muted)]'}"
				onclick={() => (activeTab = 'account')}
			>
				{$_('settings.account').toLowerCase()}
			</button>
			<button
				type="button"
				class="shrink-0 px-3 py-1.5 text-xs font-medium transition-colors {activeTab === 'library'
					? 'bg-[var(--void-4)] text-[var(--text)]'
					: 'text-[var(--text-ghost)] hover:bg-[var(--void-3)] hover:text-[var(--text-muted)]'}"
				onclick={() => (activeTab = 'library')}
			>
				{$_('nav.library').toLowerCase()}
			</button>
			<button
				type="button"
				class="shrink-0 px-3 py-1.5 text-xs font-medium transition-colors {activeTab === 'system'
					? 'bg-[var(--void-4)] text-[var(--text)]'
					: 'text-[var(--text-ghost)] hover:bg-[var(--void-3)] hover:text-[var(--text-muted)]'}"
				onclick={() => (activeTab = 'system')}
			>
				{$_('settings.system').toLowerCase()}
			</button>
			<button
				type="button"
				class="shrink-0 px-3 py-1.5 text-xs font-medium transition-colors {activeTab === 'about'
					? 'bg-[var(--void-4)] text-[var(--text)]'
					: 'text-[var(--text-ghost)] hover:bg-[var(--void-3)] hover:text-[var(--text-muted)]'}"
				onclick={() => (activeTab = 'about')}
			>
				{$_('settings.about').toLowerCase()}
			</button>
		</div>

		<!-- ═══════════════════ ACCOUNT ═══════════════════ -->
		{#if activeTab === 'account'}
			<div class="flex flex-col gap-8">
				<!-- Identity + sign out -->
				<div class="flex flex-col gap-3">
					<div class="flex items-baseline justify-between">
						<span class="text-label">{$_('settings.username')}</span>
						<span class="text-sm text-[var(--text)]">{user?.username}</span>
					</div>
					<div class="flex items-baseline justify-between">
						<span class="text-label">{$_('settings.role')}</span>
						<span class="text-sm text-[var(--text)]">{user?.is_admin ? $_('settings.roleAdmin') : $_('settings.roleUser')}</span>
					</div>
					<Button variant="ghost" size="sm" onclick={handleSignOut} class="self-start">
						<Icon name="arrow-left" size={14} />
						{$_('settings.signOut').toLowerCase()}
					</Button>
				</div>

				<!-- Change Password -->
				<section class="flex flex-col gap-4">
					<h2 class="text-sm font-medium text-[var(--text-soft)]">{$_('settings.changePassword').toLowerCase()}</h2>
					<form class="flex flex-col gap-4" onsubmit={handleChangePassword}>
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
							<p class="text-xs text-[var(--error)] animate-fade-in">{passwordError}</p>
						{/if}
						{#if passwordSuccess}
							<p class="text-xs text-[var(--success)] animate-fade-in">{$_('settings.passwordChanged')}</p>
						{/if}

						<Button
							type="submit"
							variant="outline"
							size="sm"
							disabled={passwordLoading || !currentPassword || !newPassword || !confirmPassword}
							loading={passwordLoading}
							class="self-start"
						>
							{$_('settings.updatePassword').toLowerCase()}
						</Button>
					</form>
				</section>

				<!-- API Key -->
				<section class="flex flex-col gap-3">
					<h2 class="text-sm font-medium text-[var(--text-soft)]">{$_('settings.apiKey').toLowerCase()}</h2>
					<p class="text-xs text-[var(--text-ghost)]">{$_('settings.apiKeyDescription')}</p>
					<div class="flex items-center gap-3">
						<Button
							variant="outline"
							size="sm"
							onclick={handleRotateApiKey}
							disabled={apiKeyLoading}
							loading={apiKeyLoading}
						>
							<Icon name="refresh" size={14} />
							{$_('settings.rotateApiKey').toLowerCase()}
						</Button>
						{#if apiKeySuccess}
							<span class="text-xs text-[var(--success)] animate-fade-in">{$_('settings.apiKeyRotated')}</span>
						{/if}
					</div>
				</section>

				<!-- Integration API Keys -->
				<section class="flex flex-col gap-4">
					<div class="flex flex-col gap-1">
						<h2 class="text-sm font-medium text-[var(--text-soft)]">{$_('settings.integrationApiKeys').toLowerCase()}</h2>
						<p class="text-xs text-[var(--text-ghost)]">{$_('settings.integrationApiKeysDescription')}</p>
					</div>

					<!-- Create new key -->
					<div class="flex flex-col gap-2">
						<input
							type="text"
							class="settings-input"
							placeholder={$_('settings.integrationApiKeyNamePlaceholder')}
							bind:value={integrationKeyName}
						/>
						<Button
							variant="outline"
							size="sm"
							onclick={handleCreateIntegrationApiKey}
							disabled={!integrationKeyName.trim() || creatingIntegrationKey}
							loading={creatingIntegrationKey}
							class="self-start"
						>
							{$_('settings.createIntegrationApiKey').toLowerCase()}
						</Button>
					</div>

					<!-- Created key banner -->
					{#if createdIntegrationKeyValue}
						<div class="bg-[var(--void-3)] p-4 animate-fade-in">
							<p class="text-xs text-[var(--text-ghost)]">
								{$_('settings.integrationApiKeyCreated', {
									values: { name: createdIntegrationKeyName ?? '' }
								})}
							</p>
							<p class="mt-2 break-all text-xs text-[var(--text)]">
								{createdIntegrationKeyValue}
							</p>
							<div class="mt-3 flex gap-2">
								<Button variant="ghost" size="sm" onclick={copyCreatedIntegrationApiKey}>
									{$_('settings.copyKey').toLowerCase()}
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onclick={() => {
										createdIntegrationKeyValue = null;
										createdIntegrationKeyName = null;
									}}
								>
									{$_('common.close').toLowerCase()}
								</Button>
							</div>
						</div>
					{/if}

					<!-- Key list -->
					{#if integrationKeysLoading}
						<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
					{:else if integrationApiKeys.length === 0}
						<p class="text-xs text-[var(--text-ghost)]">{$_('settings.noIntegrationApiKeys')}</p>
					{:else}
						<div class="flex flex-col">
							{#each integrationApiKeys as key (key.id)}
								<div class="flex items-center justify-between gap-3 py-3 border-b border-[var(--void-3)]/30 last:border-b-0">
									<div class="min-w-0 flex-1">
										<p class="truncate text-sm text-[var(--text)]">{key.name}</p>
										<p class="mt-1 text-xs text-[var(--text-ghost)]">
											{key.key_prefix} · {$_('settings.createdAt')}: {formatDateTime(key.created_at)}
										</p>
										{#if key.last_used_at}
											<p class="mt-0.5 text-xs text-[var(--text-ghost)]">
												{$_('settings.lastUsedAt')}: {formatDateTime(key.last_used_at)}
											</p>
										{/if}
									</div>
									<Button
										variant="ghost"
										size="sm"
										onclick={() => handleRevokeIntegrationApiKey(key.id)}
										disabled={revokingIntegrationKeyId === key.id}
										loading={revokingIntegrationKeyId === key.id}
									>
										{$_('settings.revokeKey').toLowerCase()}
									</Button>
								</div>
							{/each}
						</div>
					{/if}

					{#if integrationKeysError}
						<p class="text-xs text-[var(--error)] animate-fade-in">{integrationKeysError}</p>
					{/if}
				</section>
			</div>

		<!-- ═══════════════════ LIBRARY ═══════════════════ -->
		{:else if activeTab === 'library'}
			<div class="flex flex-col gap-8">
				<!-- Statuses -->
				<section class="flex flex-col gap-3">
					<div class="flex flex-col gap-1">
						<h2 class="text-sm font-medium text-[var(--text-soft)]">{$_('settings.libraryStatuses').toLowerCase()}</h2>
						<p class="text-xs text-[var(--text-ghost)]">{$_('settings.libraryStatusesDescription')}</p>
					</div>

					{#if statusesLoading}
						<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
					{:else}
						<div class="flex flex-col">
							{#each statuses as status (status.id)}
								<div class="flex items-center gap-2 py-2.5 border-b border-[var(--void-3)]/30 last:border-b-0">
									<input
										type="text"
										class="settings-input-compact min-w-0 flex-1"
										value={status.label}
										oninput={(event) =>
											handleStatusFieldChange(status.id, (event.currentTarget as HTMLInputElement).value)}
									/>
									<span
										class="hidden shrink-0 text-[10px] text-[var(--text-ghost)] sm:inline-flex"
										title={$_('settings.libraryStatusesDescription')}
									>
										{status.key}
									</span>
									<Button
										variant="ghost"
										size="sm"
										onclick={() => handleSaveStatus(status.id)}
										disabled={statusSavingId === status.id}
										loading={statusSavingId === status.id}
									>
										{$_('common.save').toLowerCase()}
									</Button>
									{#if !status.is_default}
										<button
											type="button"
											class="flex h-10 w-10 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--error)] hover:bg-[var(--error-soft)]"
											onclick={() => handleDeleteStatus(status.id)}
											disabled={deletingStatusId === status.id}
											title={$_('common.delete')}
										>
											{#if deletingStatusId === status.id}
												<Icon name="loader" size={14} class="animate-spin" />
											{:else}
												<Icon name="trash-2" size={14} />
											{/if}
										</button>
									{:else}
										<span class="w-10 shrink-0"></span>
									{/if}
								</div>
							{/each}

							<!-- Add new -->
							<div class="flex items-center gap-2 pt-3">
								<input
									type="text"
									class="settings-input-compact min-w-0 flex-1"
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
									{$_('common.add').toLowerCase()}
								</Button>
							</div>
						</div>
					{/if}

					{#if statusesError}
						<p class="text-xs text-[var(--error)] animate-fade-in">{statusesError}</p>
					{/if}
				</section>

				<!-- Collections -->
				<section class="flex flex-col gap-3">
					<div class="flex flex-col gap-1">
						<h2 class="text-sm font-medium text-[var(--text-soft)]">{$_('settings.libraryCollections').toLowerCase()}</h2>
						<p class="text-xs text-[var(--text-ghost)]">{$_('settings.libraryCollectionsDescription')}</p>
					</div>

					{#if collectionsLoading}
						<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
					{:else}
						<div class="flex flex-col">
							{#if sortedCollections.length === 0}
								<p class="py-2 text-xs text-[var(--text-ghost)]">{$_('settings.noCollections')}</p>
							{:else}
								{#each sortedCollections as collection (collection.id)}
									<div class="flex items-center gap-2 py-2.5 border-b border-[var(--void-3)]/30 last:border-b-0">
										<input
											type="text"
											class="settings-input-compact min-w-0 flex-1"
											value={collection.name}
											oninput={(event) =>
												handleCollectionFieldChange(
													collection.id,
													(event.currentTarget as HTMLInputElement).value
												)}
										/>
										<Button
											variant="ghost"
											size="sm"
											onclick={() => handleSaveCollection(collection.id)}
											disabled={collectionSavingId === collection.id}
											loading={collectionSavingId === collection.id}
										>
											{$_('common.save').toLowerCase()}
										</Button>
										<button
											type="button"
											class="flex h-10 w-10 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:text-[var(--error)] hover:bg-[var(--error-soft)]"
											onclick={() => handleDeleteCollection(collection.id)}
											disabled={deletingCollectionId === collection.id || collectionSavingId === collection.id}
											title={$_('common.delete')}
										>
											{#if deletingCollectionId === collection.id}
												<Icon name="loader" size={14} class="animate-spin" />
											{:else}
												<Icon name="trash-2" size={14} />
											{/if}
										</button>
									</div>
								{/each}
							{/if}

							<!-- Add new -->
							<div class="flex items-center gap-2 pt-3">
								<input
									type="text"
									class="settings-input-compact min-w-0 flex-1"
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
									{$_('common.add').toLowerCase()}
								</Button>
							</div>
						</div>
					{/if}

					{#if collectionsError}
						<p class="text-xs text-[var(--error)] animate-fade-in">{collectionsError}</p>
					{/if}
				</section>
			</div>

		<!-- ═══════════════════ SYSTEM ═══════════════════ -->
		{:else if activeTab === 'system'}
			<div class="flex flex-col gap-8">
				<!-- Downloads -->
				<section class="flex flex-col gap-4">
					<div class="flex flex-col gap-1">
						<h2 class="text-sm font-medium text-[var(--text-soft)]">{$_('settings.downloadSettings').toLowerCase()}</h2>
						<p class="text-xs text-[var(--text-ghost)]">{$_('settings.downloadSettingsDescription')}</p>
					</div>

					{#if downloadsSettingsLoading}
						<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
					{:else}
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
								class="settings-input"
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

						<!-- Disk stats -->
						<div class="flex flex-col gap-2 pt-2">
							<div class="flex items-baseline justify-between">
								<span class="text-label">{$_('settings.totalSpace')}</span>
								<span class="text-sm text-[var(--text)]">{formatBytes(downloadTotalBytes)}</span>
							</div>
							<div class="flex items-baseline justify-between">
								<span class="text-label">{$_('settings.usedSpace')}</span>
								<span class="text-sm text-[var(--text)]">{formatBytes(downloadUsedBytes)}</span>
							</div>
							<div class="flex items-baseline justify-between">
								<span class="text-label">{$_('settings.freeSpace')}</span>
								<span class="text-sm text-[var(--text)]">{formatBytes(downloadFreeBytes)}</span>
							</div>
						</div>

						<div class="flex gap-2 pt-1">
							<Button
								variant="outline"
								size="sm"
								onclick={handleSaveDownloadSettings}
								disabled={!downloadRootDir.trim() || downloadsSettingsSaving}
								loading={downloadsSettingsSaving}
							>
								{$_('common.save').toLowerCase()}
							</Button>
							<Button variant="ghost" size="sm" onclick={loadDownloadSettings}>
								{$_('common.refresh').toLowerCase()}
							</Button>
						</div>

						{#if downloadsSettingsError}
							<p class="text-xs text-[var(--error)] animate-fade-in">{downloadsSettingsError}</p>
						{/if}
						{#if downloadsSettingsSuccess}
							<p class="text-xs text-[var(--success)] animate-fade-in">{$_('settings.downloadSettingsSaved')}</p>
						{/if}
					{/if}
				</section>

				<div class="h-px bg-[var(--void-3)]"></div>

				<!-- Jobs / Cleanup -->
				<section class="flex flex-col gap-4">
					<div class="flex flex-col gap-1">
						<h2 class="text-sm font-medium text-[var(--text-soft)]">{$_('settings.jobs').toLowerCase()}</h2>
						<p class="text-xs text-[var(--text-ghost)]">{$_('settings.jobsDescription')}</p>
					</div>

					{#if jobsSettingsLoading}
						<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
					{:else}
						<label class="flex items-center gap-3 py-1 text-sm text-[var(--text)] cursor-pointer select-none">
							<input
								type="checkbox"
								class="h-5 w-5 accent-[var(--void-8)]"
								checked={jobsCleanupEnabled}
								onchange={(event) => {
									jobsCleanupEnabled = (event.currentTarget as HTMLInputElement).checked;
								}}
							/>
							{$_('settings.cleanupUnassignedEnabled')}
						</label>

						<div class="flex flex-col gap-4">
							<div class="flex flex-col gap-1.5">
								<label class="text-label" for="jobs-cleanup-interval-days">
									{$_('settings.cleanupIntervalDays')}
								</label>
								<input
									id="jobs-cleanup-interval-days"
									type="number"
									min="1"
									max="365"
									class="settings-input"
									value={jobsCleanupIntervalDays}
									oninput={(event) => {
										const raw = Number((event.currentTarget as HTMLInputElement).value);
										jobsCleanupIntervalDays = Number.isFinite(raw) ? raw : 30;
									}}
								/>
							</div>
							<div class="flex flex-col gap-1.5">
								<label class="text-label" for="jobs-cleanup-older-than-days">
									{$_('settings.cleanupOlderThanDays')}
								</label>
								<input
									id="jobs-cleanup-older-than-days"
									type="number"
									min="1"
									max="3650"
									class="settings-input"
									value={jobsCleanupOlderThanDays}
									oninput={(event) => {
										const raw = Number((event.currentTarget as HTMLInputElement).value);
										jobsCleanupOlderThanDays = Number.isFinite(raw) ? raw : 30;
									}}
								/>
							</div>
							<div class="flex flex-col gap-1.5">
								<label class="text-label" for="jobs-cleanup-batch-limit">
									{$_('settings.cleanupBatchLimit')}
								</label>
								<input
									id="jobs-cleanup-batch-limit"
									type="number"
									min="1"
									max="5000"
									class="settings-input"
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

						<div class="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onclick={handleSaveJobsSettings}
								disabled={jobsSettingsSaving}
								loading={jobsSettingsSaving}
							>
								{$_('common.save').toLowerCase()}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onclick={handleRunCleanupNow}
								disabled={jobsCleanupRunning}
								loading={jobsCleanupRunning}
							>
								{$_('settings.runCleanupNow').toLowerCase()}
							</Button>
						</div>

						{#if jobsSettingsError}
							<p class="text-xs text-[var(--error)] animate-fade-in">{jobsSettingsError}</p>
						{/if}
						{#if jobsSettingsSuccess}
							<p class="text-xs text-[var(--success)] animate-fade-in">{$_('settings.jobsSettingsSaved')}</p>
						{/if}
						{#if jobsCleanupInfo}
							<p class="text-xs text-[var(--text-muted)] animate-fade-in">{jobsCleanupInfo}</p>
						{/if}
					{/if}
				</section>
			</div>

		<!-- ═══════════════════ ABOUT ═══════════════════ -->
		{:else}
			<div class="flex flex-col gap-3">
				<div class="flex items-baseline justify-between">
					<span class="text-label">{$_('app.name')}</span>
					<span class="text-sm text-[var(--text)]">v2.0.0</span>
				</div>
				<div class="flex items-baseline justify-between">
					<span class="text-label">{$_('settings.domain')}</span>
					<span class="text-sm text-[var(--text)]">hmphin.space</span>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	/* Shared input styles for settings — float in the void */
	.settings-input {
		height: 3rem; /* 48px, touch-friendly */
		width: 100%;
		border: 1px solid var(--line);
		background: var(--void-2);
		padding: 0 1rem;
		font-size: 0.875rem;
		color: var(--text);
		transition: border-color 150ms, background-color 150ms;
	}
	.settings-input::placeholder {
		color: var(--text-ghost);
	}
	.settings-input:hover {
		border-color: var(--void-5);
	}
	.settings-input:focus {
		border-color: var(--void-6);
		background: var(--void-3);
		outline: none;
	}

	/* Compact variant for CRUD list rows */
	.settings-input-compact {
		height: 2.5rem; /* 40px */
		border: 1px solid var(--line);
		background: var(--void-2);
		padding: 0 0.75rem;
		font-size: 0.875rem;
		color: var(--text);
		transition: border-color 150ms, background-color 150ms;
	}
	.settings-input-compact::placeholder {
		color: var(--text-ghost);
	}
	.settings-input-compact:hover {
		border-color: var(--void-5);
	}
	.settings-input-compact:focus {
		border-color: var(--void-6);
		background: var(--void-3);
		outline: none;
	}

	/* Hide number input spinners */
	input[type='number']::-webkit-inner-spin-button,
	input[type='number']::-webkit-outer-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	input[type='number'] {
		-moz-appearance: textfield;
	}
</style>
