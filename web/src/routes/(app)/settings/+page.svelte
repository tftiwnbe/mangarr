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
	import { updateExtensionRepository, listInstalledExtensions } from '$lib/api/extensions';
	import {
		getFlareSolverrSettings,
		getDownloadSettings,
		getJobsSettings,
		getProxySettings,
		getSchedulerStatus,
		runCleanupNow,
		triggerSchedulerJob,
		pauseSchedulerJob,
		resumeSchedulerJob,
		updateFlareSolverrSettings,
		updateDownloadSettings,
		updateJobsSettings,
		updateProxySettings,
		type SchedulerJobResource,
		type SchedulerStatusResource
	} from '$lib/api/settings';
	import { Button } from '$lib/elements/button';
	import { Icon } from '$lib/elements/icon';
	import { Input } from '$lib/elements/input';
	import { _ } from '$lib/i18n';
	import {
		contentLanguages,
		loadContentLanguages,
		setContentLanguages,
		getKnownContentLanguages,
		setKnownContentLanguages
	} from '$lib/stores/content-languages';

	type SettingsTab = 'account' | 'library' | 'system' | 'about';

	// ── Extensions settings ────────────────────────────────────────────────
	let extensionRepoUrl = $state('');
	let extensionRepoSaving = $state(false);
	let extensionRepoError = $state<string | null>(null);
	let extensionRepoSuccess = $state(false);
	let knownLangs = $state<string[]>([]);
	let extensionRepoLoading = $state(true);

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
	let downloadFailedChapterRetryDelaySeconds = $state(21600);
	let downloadCompressChapters = $state(false);
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

	let flareEnabled = $state(false);
	let flareUrl = $state('http://localhost:8191');
	let flareTimeoutSeconds = $state(45);
	let flareResponseFallback = $state(true);
	let flareSessionName = $state('');
	let flareSessionTtlMinutes = $state('');
	let flareSettingsLoading = $state(true);
	let flareSettingsSaving = $state(false);
	let flareSettingsError = $state<string | null>(null);
	let flareSettingsSuccess = $state(false);

	let proxyHostname = $state('');
	let proxyPort = $state(0);
	let proxyUsername = $state('');
	let proxyPassword = $state('');
	let proxyIgnoredAddresses = $state('');
	let proxyBypassLocalAddresses = $state(true);
	let proxySettingsLoading = $state(true);
	let proxySettingsSaving = $state(false);
	let proxySettingsError = $state<string | null>(null);
	let proxySettingsSuccess = $state(false);

	// ── Scheduler ──────────────────────────────────────────────────────────
	type BridgePageMetrics = NonNullable<SchedulerStatusResource['bridge_page_metrics']>;
	let schedulerJobs = $state<SchedulerJobResource[]>([]);
	let schedulerBridgeMetrics = $state<BridgePageMetrics | null>(null);
	let schedulerLoading = $state(false);
	let schedulerError = $state<string | null>(null);
	let schedulerActingJob = $state<string | null>(null);

	onMount(async () => {
		try {
			user = await getMe();
			await Promise.all([
				loadLibraryStatuses(),
				loadLibraryCollections(),
				loadDownloadSettings(),
				loadIntegrationApiKeys(),
				loadJobsSettings(),
				loadFlareSolverrSettings(),
				loadProxySettings(),
				loadExtensionSettings(),
				loadContentLanguages(),
				loadSchedulerStatus()
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
			downloadFailedChapterRetryDelaySeconds = settings.failed_chapter_retry_delay_seconds;
			downloadCompressChapters = settings.compress_downloaded_chapters;
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

	async function loadFlareSolverrSettings() {
		flareSettingsLoading = true;
		flareSettingsError = null;
		try {
			const settings = await getFlareSolverrSettings();
			flareEnabled = settings.enabled;
			flareUrl = settings.url;
			flareTimeoutSeconds = settings.timeout_seconds;
			flareResponseFallback = settings.response_fallback;
			flareSessionName = settings.session_name ?? '';
			flareSessionTtlMinutes =
				settings.session_ttl_minutes !== null ? String(settings.session_ttl_minutes) : '';
		} catch (cause) {
			flareSettingsError =
				cause instanceof Error ? cause.message : 'Failed to load FlareSolverr settings';
		} finally {
			flareSettingsLoading = false;
		}
	}

	async function loadProxySettings() {
		proxySettingsLoading = true;
		proxySettingsError = null;
		try {
			const settings = await getProxySettings();
			proxyHostname = settings.hostname;
			proxyPort = settings.port;
			proxyUsername = settings.username ?? '';
			proxyPassword = settings.password ?? '';
			proxyIgnoredAddresses = settings.ignored_addresses;
			proxyBypassLocalAddresses = settings.bypass_local_addresses;
		} catch (cause) {
			proxySettingsError = cause instanceof Error ? cause.message : 'Failed to load proxy settings';
		} finally {
			proxySettingsLoading = false;
		}
	}

	async function loadExtensionSettings() {
		extensionRepoLoading = true;
		try {
			// Load known languages from localStorage first (fast initial render)
			knownLangs = getKnownContentLanguages();

			// Refresh from installed extension sources (more granular than repo-level langs)
			const installed = await listInstalledExtensions().catch(() => []);
			if (installed.length > 0) {
				const sourceLangs = installed.flatMap((e) => e.sources.map((s) => s.lang));
				setKnownContentLanguages(sourceLangs);
				knownLangs = getKnownContentLanguages();
			}
		} catch {
			// Non-critical, just use cached known langs
		} finally {
			extensionRepoLoading = false;
		}
	}

	async function loadSchedulerStatus() {
		schedulerLoading = true;
		schedulerError = null;
		try {
			const status = await getSchedulerStatus();
			schedulerJobs = status.jobs;
			schedulerBridgeMetrics = status.bridge_page_metrics ?? null;
		} catch (cause) {
			schedulerError = cause instanceof Error ? cause.message : 'Failed to load scheduler';
		} finally {
			schedulerLoading = false;
		}
	}

	async function handleJobTrigger(jobName: string) {
		if (schedulerActingJob) return;
		schedulerActingJob = jobName;
		schedulerError = null;
		try {
			const updated = await triggerSchedulerJob(jobName);
			schedulerJobs = schedulerJobs.map((j) => (j.name === updated.name ? updated : j));
		} catch (cause) {
			schedulerError = cause instanceof Error ? cause.message : 'Failed to trigger job';
		} finally {
			schedulerActingJob = null;
		}
	}

	async function handleJobPause(jobName: string) {
		if (schedulerActingJob) return;
		schedulerActingJob = jobName;
		schedulerError = null;
		try {
			const updated = await pauseSchedulerJob(jobName);
			schedulerJobs = schedulerJobs.map((j) => (j.name === updated.name ? updated : j));
		} catch (cause) {
			schedulerError = cause instanceof Error ? cause.message : 'Failed to pause job';
		} finally {
			schedulerActingJob = null;
		}
	}

	async function handleJobResume(jobName: string) {
		if (schedulerActingJob) return;
		schedulerActingJob = jobName;
		schedulerError = null;
		try {
			const updated = await resumeSchedulerJob(jobName);
			schedulerJobs = schedulerJobs.map((j) => (j.name === updated.name ? updated : j));
		} catch (cause) {
			schedulerError = cause instanceof Error ? cause.message : 'Failed to resume job';
		} finally {
			schedulerActingJob = null;
		}
	}

	function formatInterval(seconds: number): string {
		if (seconds < 60) return `${Math.round(seconds)}s`;
		if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
		if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
		return `${Math.round(seconds / 86400)}d`;
	}

	function formatLastRun(lastRunAt: string | null | undefined): string {
		if (!lastRunAt) return 'never';
		const date = new Date(lastRunAt);
		if (isNaN(date.getTime())) return 'never';
		const diffMs = Date.now() - date.getTime();
		const diffSec = Math.floor(diffMs / 1000);
		if (diffSec < 60) return `${diffSec}s ago`;
		if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
		if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
		return `${Math.floor(diffSec / 86400)}d ago`;
	}

	function formatNextRun(nextRunAt: string | null | undefined): string {
		if (!nextRunAt) return 'paused';
		const date = new Date(nextRunAt);
		if (isNaN(date.getTime())) return 'unknown';
		const diffMs = date.getTime() - Date.now();
		const diffSec = Math.max(0, Math.floor(diffMs / 1000));
		if (diffSec < 60) return `in ${diffSec}s`;
		if (diffSec < 3600) return `in ${Math.floor(diffSec / 60)}m`;
		if (diffSec < 86400) return `in ${Math.floor(diffSec / 3600)}h`;
		return `in ${Math.floor(diffSec / 86400)}d`;
	}

	async function handleSaveExtensionRepo() {
		if (!extensionRepoUrl.trim() || extensionRepoSaving) return;
		extensionRepoSaving = true;
		extensionRepoError = null;
		extensionRepoSuccess = false;

		try {
			const result = await updateExtensionRepository({ url: extensionRepoUrl.trim() });
			const langs = result.map((e) => e.lang);
			setKnownContentLanguages(langs);
			knownLangs = getKnownContentLanguages();
			extensionRepoSuccess = true;
			setTimeout(() => (extensionRepoSuccess = false), 3000);
		} catch (cause) {
			extensionRepoError = cause instanceof Error ? cause.message : 'Failed to update repository';
		} finally {
			extensionRepoSaving = false;
		}
	}

	async function handleToggleContentLang(lang: string) {
		const current = $contentLanguages;
		const lower = lang.toLowerCase();
		if (current.includes(lower)) {
			await setContentLanguages(current.filter((l) => l !== lower));
		} else {
			await setContentLanguages([...current, lower]);
		}
	}

	async function handleSelectAllLangs() {
		await setContentLanguages([...knownLangs]);
	}

	async function handleClearLangs() {
		await setContentLanguages([]);
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
		const retryDelay = Math.round(downloadFailedChapterRetryDelaySeconds);
		if (!Number.isFinite(retryDelay) || retryDelay < 60 || retryDelay > 604800) {
			downloadsSettingsError = $_('settings.failedChapterRetryDelayInvalid');
			return;
		}
		downloadsSettingsSaving = true;
		downloadsSettingsError = null;
		downloadsSettingsSuccess = false;
		try {
			const updated = await updateDownloadSettings({
				root_dir: downloadRootDir.trim(),
				parallel_downloads: parallel,
				failed_chapter_retry_delay_seconds: retryDelay,
				compress_downloaded_chapters: downloadCompressChapters
			});
			downloadRootDir = updated.root_dir;
			downloadParallelDownloads = updated.parallel_downloads;
			downloadFailedChapterRetryDelaySeconds = updated.failed_chapter_retry_delay_seconds;
			downloadCompressChapters = updated.compress_downloaded_chapters;
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

	async function handleSaveFlareSolverrSettings() {
		if (flareSettingsSaving) return;
		flareSettingsSaving = true;
		flareSettingsError = null;
		flareSettingsSuccess = false;
		try {
			const timeout = Math.max(5, Math.min(300, Math.round(flareTimeoutSeconds || 45)));
			const sessionTtlRaw = flareSessionTtlMinutes.trim();
			const sessionTtl = sessionTtlRaw
				? Math.max(1, Math.min(1440, Math.round(Number(sessionTtlRaw))))
				: null;
			const updated = await updateFlareSolverrSettings({
				enabled: flareEnabled,
				url: flareUrl.trim(),
				timeout_seconds: timeout,
				response_fallback: flareResponseFallback,
				session_name: flareSessionName.trim() || null,
				session_ttl_minutes: sessionTtl
			});
			flareEnabled = updated.enabled;
			flareUrl = updated.url;
			flareTimeoutSeconds = updated.timeout_seconds;
			flareResponseFallback = updated.response_fallback;
			flareSessionName = updated.session_name ?? '';
			flareSessionTtlMinutes =
				updated.session_ttl_minutes !== null ? String(updated.session_ttl_minutes) : '';
			flareSettingsSuccess = true;
			setTimeout(() => (flareSettingsSuccess = false), 3000);
		} catch (cause) {
			flareSettingsError =
				cause instanceof Error ? cause.message : 'Failed to save FlareSolverr settings';
		} finally {
			flareSettingsSaving = false;
		}
	}

	async function handleSaveProxySettings() {
		if (proxySettingsSaving) return;
		proxySettingsSaving = true;
		proxySettingsError = null;
		proxySettingsSuccess = false;
		try {
			const hostname = proxyHostname.trim();
			const port = Math.max(0, Math.min(65535, Math.round(proxyPort || 0)));
			if (hostname && port === 0) {
				throw new Error('Proxy port is required when hostname is set');
			}

			const updated = await updateProxySettings({
				hostname,
				port,
				username: proxyUsername.trim() || null,
				password: proxyPassword.trim() || null,
				ignored_addresses: proxyIgnoredAddresses.trim(),
				bypass_local_addresses: proxyBypassLocalAddresses
			});

			proxyHostname = updated.hostname;
			proxyPort = updated.port;
			proxyUsername = updated.username ?? '';
			proxyPassword = updated.password ?? '';
			proxyIgnoredAddresses = updated.ignored_addresses;
			proxyBypassLocalAddresses = updated.bypass_local_addresses;
			proxySettingsSuccess = true;
			setTimeout(() => (proxySettingsSuccess = false), 3000);
		} catch (cause) {
			proxySettingsError = cause instanceof Error ? cause.message : 'Failed to save proxy settings';
		} finally {
			proxySettingsSaving = false;
		}
	}
</script>

<svelte:head>
	<title>{$_('nav.settings')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex max-w-xl flex-col gap-6">
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
		<div class="no-scrollbar flex gap-1 overflow-x-auto">
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
						<span class="text-sm text-[var(--text)]"
							>{user?.is_admin ? $_('settings.roleAdmin') : $_('settings.roleUser')}</span
						>
					</div>
					<Button variant="ghost" size="sm" onclick={handleSignOut} class="self-start">
						<Icon name="arrow-left" size={14} />
						{$_('settings.signOut').toLowerCase()}
					</Button>
				</div>

				<!-- Change Password -->
				<section class="flex flex-col gap-4">
					<h2 class="text-sm font-medium text-[var(--text-soft)]">
						{$_('settings.changePassword').toLowerCase()}
					</h2>
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
							<p class="animate-fade-in text-xs text-[var(--error)]">{passwordError}</p>
						{/if}
						{#if passwordSuccess}
							<p class="animate-fade-in text-xs text-[var(--success)]">
								{$_('settings.passwordChanged')}
							</p>
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
					<h2 class="text-sm font-medium text-[var(--text-soft)]">
						{$_('settings.apiKey').toLowerCase()}
					</h2>
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
							<span class="animate-fade-in text-xs text-[var(--success)]"
								>{$_('settings.apiKeyRotated')}</span
							>
						{/if}
					</div>
				</section>

				<!-- Integration API Keys -->
				<section class="flex flex-col gap-4">
					<div class="flex flex-col gap-1">
						<h2 class="text-sm font-medium text-[var(--text-soft)]">
							{$_('settings.integrationApiKeys').toLowerCase()}
						</h2>
						<p class="text-xs text-[var(--text-ghost)]">
							{$_('settings.integrationApiKeysDescription')}
						</p>
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
						<div class="animate-fade-in bg-[var(--void-3)] p-4">
							<p class="text-xs text-[var(--text-ghost)]">
								{$_('settings.integrationApiKeyCreated', {
									values: { name: createdIntegrationKeyName ?? '' }
								})}
							</p>
							<p class="mt-2 text-xs break-all text-[var(--text)]">
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
								<div
									class="flex items-center justify-between gap-3 border-b border-[var(--void-3)]/30 py-3 last:border-b-0"
								>
									<div class="min-w-0 flex-1">
										<p class="truncate text-sm text-[var(--text)]">{key.name}</p>
										<p class="mt-1 text-xs text-[var(--text-ghost)]">
											{key.key_prefix} · {$_('settings.createdAt')}: {formatDateTime(
												key.created_at
											)}
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
						<p class="animate-fade-in text-xs text-[var(--error)]">{integrationKeysError}</p>
					{/if}
				</section>
			</div>

			<!-- ═══════════════════ LIBRARY ═══════════════════ -->
		{:else if activeTab === 'library'}
			<div class="flex flex-col gap-8">
				<!-- Statuses -->
				<section class="flex flex-col gap-3">
					<div class="flex flex-col gap-1">
						<h2 class="text-sm font-medium text-[var(--text-soft)]">
							{$_('settings.libraryStatuses').toLowerCase()}
						</h2>
						<p class="text-xs text-[var(--text-ghost)]">
							{$_('settings.libraryStatusesDescription')}
						</p>
					</div>

					{#if statusesLoading}
						<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
					{:else}
						<div class="flex flex-col">
							{#each statuses as status (status.id)}
								<div
									class="flex items-center gap-2 border-b border-[var(--void-3)]/30 py-2.5 last:border-b-0"
								>
									<input
										type="text"
										class="settings-input-compact min-w-0 flex-1"
										value={status.label}
										oninput={(event) =>
											handleStatusFieldChange(
												status.id,
												(event.currentTarget as HTMLInputElement).value
											)}
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
											class="flex h-10 w-10 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:bg-[var(--error-soft)] hover:text-[var(--error)]"
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
						<p class="animate-fade-in text-xs text-[var(--error)]">{statusesError}</p>
					{/if}
				</section>

				<!-- Collections -->
				<section class="flex flex-col gap-3">
					<div class="flex flex-col gap-1">
						<h2 class="text-sm font-medium text-[var(--text-soft)]">
							{$_('settings.libraryCollections').toLowerCase()}
						</h2>
						<p class="text-xs text-[var(--text-ghost)]">
							{$_('settings.libraryCollectionsDescription')}
						</p>
					</div>

					{#if collectionsLoading}
						<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
					{:else}
						<div class="flex flex-col">
							{#if sortedCollections.length === 0}
								<p class="py-2 text-xs text-[var(--text-ghost)]">{$_('settings.noCollections')}</p>
							{:else}
								{#each sortedCollections as collection (collection.id)}
									<div
										class="flex items-center gap-2 border-b border-[var(--void-3)]/30 py-2.5 last:border-b-0"
									>
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
											class="flex h-10 w-10 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:bg-[var(--error-soft)] hover:text-[var(--error)]"
											onclick={() => handleDeleteCollection(collection.id)}
											disabled={deletingCollectionId === collection.id ||
												collectionSavingId === collection.id}
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
						<p class="animate-fade-in text-xs text-[var(--error)]">{collectionsError}</p>
					{/if}
				</section>
			</div>

			<!-- ═══════════════════ SYSTEM ═══════════════════ -->
		{:else if activeTab === 'system'}
			<div class="flex flex-col gap-8">
				<!-- Extensions -->
				<section class="flex flex-col gap-4">
					<div class="flex flex-col gap-1">
						<h2 class="text-sm font-medium text-[var(--text-soft)]">extensions</h2>
						<p class="text-xs text-[var(--text-ghost)]">
							manage extension repository and content language preferences
						</p>
					</div>

					{#if extensionRepoLoading}
						<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
					{:else}
						<Input
							label="repository url"
							bind:value={extensionRepoUrl}
							placeholder="https://raw.githubusercontent.com/..."
						/>

						<div class="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onclick={handleSaveExtensionRepo}
								disabled={!extensionRepoUrl.trim() || extensionRepoSaving}
								loading={extensionRepoSaving}
							>
								update repository
							</Button>
						</div>

						{#if extensionRepoError}
							<p class="animate-fade-in text-xs text-[var(--error)]">{extensionRepoError}</p>
						{/if}
						{#if extensionRepoSuccess}
							<p class="animate-fade-in text-xs text-[var(--success)]">repository updated</p>
						{/if}

						<!-- Content languages -->
						<div class="flex flex-col gap-2 pt-2">
							<div class="flex items-baseline justify-between">
								<span class="text-label">content languages</span>
								<div class="flex gap-3">
									<button
										type="button"
										class="text-[10px] text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
										onclick={handleSelectAllLangs}
									>
										select all
									</button>
									<button
										type="button"
										class="text-[10px] text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
										onclick={handleClearLangs}
									>
										clear
									</button>
								</div>
							</div>
							<p class="text-[11px] text-[var(--text-ghost)]">
								{$contentLanguages.length === 0
									? 'no filter — showing all sources'
									: `${$contentLanguages.length} language${$contentLanguages.length === 1 ? '' : 's'} selected`}
							</p>
							{#if knownLangs.length > 0}
								<div class="flex flex-wrap gap-1.5 pt-1">
									{#each knownLangs as lang (lang)}
										{@const isSelected = $contentLanguages.includes(lang)}
										<button
											type="button"
											class="h-7 min-w-[32px] px-2.5 text-[10px] tracking-wider uppercase transition-all
												{isSelected
												? 'bg-[var(--void-4)] text-[var(--text)]'
												: 'text-[var(--text-ghost)] hover:bg-[var(--void-2)] hover:text-[var(--text-muted)]'}"
											onclick={() => handleToggleContentLang(lang)}
										>
											{lang}
										</button>
									{/each}
								</div>
							{:else}
								<p class="text-[11px] text-[var(--text-ghost)]">
									no languages known yet — visit the extensions page first
								</p>
							{/if}
						</div>
					{/if}
				</section>

				<div class="h-px bg-[var(--void-3)]"></div>

				<!-- Downloads -->
				<section class="flex flex-col gap-4">
					<div class="flex flex-col gap-1">
						<h2 class="text-sm font-medium text-[var(--text-soft)]">
							{$_('settings.downloadSettings').toLowerCase()}
						</h2>
						<p class="text-xs text-[var(--text-ghost)]">
							{$_('settings.downloadSettingsDescription')}
						</p>
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

						<div class="flex flex-col gap-1.5">
							<label class="text-label" for="failed-retry-delay">
								{$_('settings.failedChapterRetryDelay')}
							</label>
							<input
								id="failed-retry-delay"
								type="number"
								min="60"
								max="604800"
								step="60"
								class="settings-input"
								value={downloadFailedChapterRetryDelaySeconds}
								oninput={(event) => {
									const raw = Number((event.currentTarget as HTMLInputElement).value);
									downloadFailedChapterRetryDelaySeconds = Number.isFinite(raw) ? raw : 21600;
								}}
							/>
							<p class="text-xs text-[var(--text-ghost)]">
								{$_('settings.failedChapterRetryDelayDescription')}
							</p>
						</div>

						<label
							class="flex cursor-pointer items-center gap-3 py-1 text-sm text-[var(--text)] select-none"
						>
							<input
								type="checkbox"
								class="h-5 w-5 accent-[var(--void-8)]"
								checked={downloadCompressChapters}
								onchange={(event) => {
									downloadCompressChapters = (event.currentTarget as HTMLInputElement).checked;
								}}
							/>
							{$_('settings.downloadCompressionEnabled')}
						</label>

						<p class="text-xs text-[var(--text-ghost)]">
							{$_('settings.downloadCompressionLevelDescription')}
						</p>

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
							<p class="animate-fade-in text-xs text-[var(--error)]">{downloadsSettingsError}</p>
						{/if}
						{#if downloadsSettingsSuccess}
							<p class="animate-fade-in text-xs text-[var(--success)]">
								{$_('settings.downloadSettingsSaved')}
							</p>
						{/if}
					{/if}
				</section>

				<div class="h-px bg-[var(--void-3)]"></div>

				<!-- Jobs / Cleanup -->
				<section class="flex flex-col gap-4">
					<div class="flex flex-col gap-1">
						<h2 class="text-sm font-medium text-[var(--text-soft)]">
							{$_('settings.jobs').toLowerCase()}
						</h2>
						<p class="text-xs text-[var(--text-ghost)]">{$_('settings.jobsDescription')}</p>
					</div>

					{#if jobsSettingsLoading}
						<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
					{:else}
						<label
							class="flex cursor-pointer items-center gap-3 py-1 text-sm text-[var(--text)] select-none"
						>
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
							<p class="animate-fade-in text-xs text-[var(--error)]">{jobsSettingsError}</p>
						{/if}
						{#if jobsSettingsSuccess}
							<p class="animate-fade-in text-xs text-[var(--success)]">
								{$_('settings.jobsSettingsSaved')}
							</p>
						{/if}
						{#if jobsCleanupInfo}
							<p class="animate-fade-in text-xs text-[var(--text-muted)]">{jobsCleanupInfo}</p>
						{/if}
					{/if}
				</section>

				<div class="h-px bg-[var(--void-3)]"></div>

				<!-- Proxy -->
				<section class="flex flex-col gap-4">
					<div class="flex flex-col gap-1">
						<h2 class="text-sm font-medium text-[var(--text-soft)]">proxy</h2>
						<p class="text-xs text-[var(--text-ghost)]">
							Configure shared HTTP proxy settings used when proxy is enabled for an extension.
						</p>
					</div>

					{#if proxySettingsLoading}
						<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
					{:else}
						<Input
							label="Proxy hostname"
							bind:value={proxyHostname}
							placeholder="proxy.example.com"
						/>

						<div class="flex flex-col gap-1.5">
							<label class="text-label" for="proxy-port">Proxy port</label>
							<input
								id="proxy-port"
								type="number"
								min="0"
								max="65535"
								class="settings-input"
								value={proxyPort}
								oninput={(event) => {
									const raw = Number((event.currentTarget as HTMLInputElement).value);
									proxyPort = Number.isFinite(raw) ? raw : 0;
								}}
							/>
						</div>

						<Input label="Proxy username (optional)" bind:value={proxyUsername} />
						<Input label="Proxy password (optional)" bind:value={proxyPassword} type="password" />
						<Input
							label="Proxy ignored addresses"
							bind:value={proxyIgnoredAddresses}
							placeholder="*.hmphin.space;localhost"
						/>
						<p class="text-xs text-[var(--text-dim)]">
							Use <code>;</code> as separator and <code>*</code> for wildcard matching.
						</p>

						<label
							class="flex cursor-pointer items-center gap-3 py-1 text-sm text-[var(--text)] select-none"
						>
							<input
								type="checkbox"
								class="h-5 w-5 accent-[var(--void-8)]"
								checked={proxyBypassLocalAddresses}
								onchange={(event) => {
									proxyBypassLocalAddresses = (event.currentTarget as HTMLInputElement).checked;
								}}
							/>
							Bypass proxy for local addresses
						</label>

						<div class="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onclick={handleSaveProxySettings}
								disabled={proxySettingsSaving}
								loading={proxySettingsSaving}
							>
								{$_('common.save').toLowerCase()}
							</Button>
							<Button variant="ghost" size="sm" onclick={loadProxySettings}>
								{$_('common.refresh').toLowerCase()}
							</Button>
						</div>

						{#if proxySettingsError}
							<p class="animate-fade-in text-xs text-[var(--error)]">{proxySettingsError}</p>
						{/if}
						{#if proxySettingsSuccess}
							<p class="animate-fade-in text-xs text-[var(--success)]">Proxy settings saved</p>
						{/if}
					{/if}
				</section>

				<div class="h-px bg-[var(--void-3)]"></div>

				<!-- FlareSolverr -->
				<section class="flex flex-col gap-4">
					<div class="flex flex-col gap-1">
						<h2 class="text-sm font-medium text-[var(--text-soft)]">flaresolverr</h2>
						<p class="text-xs text-[var(--text-ghost)]">
							Enable Cloudflare challenge bypass via FlareSolverr.
						</p>
					</div>

					{#if flareSettingsLoading}
						<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
					{:else}
						<label
							class="flex cursor-pointer items-center gap-3 py-1 text-sm text-[var(--text)] select-none"
						>
							<input
								type="checkbox"
								class="h-5 w-5 accent-[var(--void-8)]"
								checked={flareEnabled}
								onchange={(event) => {
									flareEnabled = (event.currentTarget as HTMLInputElement).checked;
								}}
							/>
							Enable FlareSolverr
						</label>

						<Input
							label="FlareSolverr URL"
							bind:value={flareUrl}
							placeholder="http://localhost:8191"
						/>

						<div class="flex flex-col gap-1.5">
							<label class="text-label" for="flare-timeout-seconds">Timeout (seconds)</label>
							<input
								id="flare-timeout-seconds"
								type="number"
								min="5"
								max="300"
								class="settings-input"
								value={flareTimeoutSeconds}
								oninput={(event) => {
									const raw = Number((event.currentTarget as HTMLInputElement).value);
									flareTimeoutSeconds = Number.isFinite(raw) ? raw : 45;
								}}
							/>
						</div>

						<label
							class="flex cursor-pointer items-center gap-3 py-1 text-sm text-[var(--text)] select-none"
						>
							<input
								type="checkbox"
								class="h-5 w-5 accent-[var(--void-8)]"
								checked={flareResponseFallback}
								onchange={(event) => {
									flareResponseFallback = (event.currentTarget as HTMLInputElement).checked;
								}}
							/>
							Response fallback
						</label>
						<p class="text-xs text-[var(--text-dim)]">
							If enabled, requests fall back to the extension's direct response when FlareSolverr
							fails or times out.
						</p>

						<Input
							label="Session name (optional)"
							bind:value={flareSessionName}
							placeholder="leave empty for no pinned session"
						/>

						<div class="flex flex-col gap-1.5">
							<label class="text-label" for="flare-session-ttl"
								>Session TTL minutes (optional)</label
							>
							<input
								id="flare-session-ttl"
								type="number"
								min="1"
								max="1440"
								class="settings-input"
								value={flareSessionTtlMinutes}
								oninput={(event) => {
									flareSessionTtlMinutes = (event.currentTarget as HTMLInputElement).value;
								}}
							/>
						</div>

						<div class="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onclick={handleSaveFlareSolverrSettings}
								disabled={!flareUrl.trim() || flareSettingsSaving}
								loading={flareSettingsSaving}
							>
								{$_('common.save').toLowerCase()}
							</Button>
							<Button variant="ghost" size="sm" onclick={loadFlareSolverrSettings}>
								{$_('common.refresh').toLowerCase()}
							</Button>
						</div>

						{#if flareSettingsError}
							<p class="animate-fade-in text-xs text-[var(--error)]">{flareSettingsError}</p>
						{/if}
						{#if flareSettingsSuccess}
							<p class="animate-fade-in text-xs text-[var(--success)]">
								FlareSolverr settings saved
							</p>
						{/if}
					{/if}
				</section>
			</div>

			<!-- ═══════════════════ ABOUT ═══════════════════ -->
		{:else}
			<div class="flex flex-col gap-6">
				<!-- App info -->
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

				<!-- Scheduled jobs -->
				<div class="flex flex-col gap-0">
					<div class="mb-3 flex items-center justify-between">
						<span class="text-label">scheduled jobs</span>
						<button
							type="button"
							class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase transition-colors hover:text-[var(--text-muted)]"
							onclick={loadSchedulerStatus}
						>
							{#if schedulerLoading}
								<Icon name="loader" size={10} class="inline animate-spin" />
							{:else}
								<Icon name="refresh-cw" size={10} class="inline" />
							{/if}
						</button>
					</div>

					{#if schedulerError}
						<p class="mb-2 text-xs text-[var(--error)]">{schedulerError}</p>
					{/if}

					{#if schedulerBridgeMetrics}
						<div class="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-[var(--text-ghost)]">
							<span>page fetches: {schedulerBridgeMetrics.page_fetch_attempts}</span>
							<span>404s: {schedulerBridgeMetrics.page_fetch_not_found}</span>
							<span>recoveries: {schedulerBridgeMetrics.page_fetch_recovered}</span>
							<span>recovery failed: {schedulerBridgeMetrics.page_fetch_recovery_failed}</span>
						</div>
					{/if}

					{#if schedulerLoading && schedulerJobs.length === 0}
						<div class="flex items-center gap-2 py-4 text-[var(--text-ghost)]">
							<Icon name="loader" size={12} class="animate-spin" />
							<span class="text-xs">loading…</span>
						</div>
					{:else if schedulerJobs.length === 0}
						<p class="py-4 text-xs text-[var(--text-ghost)]">no jobs registered</p>
					{:else}
						{#each schedulerJobs as job (job.name)}
							{@const isActing = schedulerActingJob === job.name}
							<div
								class="flex items-center gap-3 border-b border-[var(--void-2)] py-3 last:border-0"
							>
								<!-- Job info -->
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<span class="truncate text-xs text-[var(--text-soft)]">{job.label}</span>
										<!-- Status chip -->
										{#if job.running}
											<span
												class="shrink-0 text-[9px] tracking-widest text-[var(--success)] uppercase"
												>running</span
											>
										{:else if job.paused}
											<span
												class="shrink-0 text-[9px] tracking-widest text-[var(--text-ghost)] uppercase"
												>paused</span
											>
										{:else if job.last_status === 'error'}
											<span
												class="shrink-0 text-[9px] tracking-widest text-[var(--error)] uppercase"
												>error</span
											>
										{:else}
											<span
												class="shrink-0 text-[9px] tracking-widest text-[var(--text-muted)] uppercase"
												>idle</span
											>
										{/if}
									</div>
									<div class="mt-0.5 flex items-center gap-2">
										<span class="text-[10px] text-[var(--text-ghost)]"
											>every {formatInterval(job.interval_seconds)}</span
										>
										<span class="text-[var(--void-4)]">·</span>
										<span class="text-[10px] text-[var(--text-ghost)]"
											>{formatLastRun(job.last_run_at)}</span
										>
										{#if !job.running}
											<span class="text-[var(--void-4)]">·</span>
											<span class="text-[10px] text-[var(--text-ghost)]"
												>{formatNextRun(job.next_run_at)}</span
											>
										{/if}
										{#if job.last_duration_ms !== null && job.last_duration_ms !== undefined}
											<span class="text-[var(--void-4)]">·</span>
											<span class="text-[10px] text-[var(--text-ghost)]"
												>{job.last_duration_ms} ms</span
											>
										{/if}
									</div>
									{#if job.last_error}
										<p class="mt-1 line-clamp-1 text-[10px] text-[var(--error)]">
											{job.last_error}
										</p>
									{/if}
								</div>

								<!-- Actions -->
								<div class="flex shrink-0 items-center gap-1">
									<!-- Run now -->
									<button
										type="button"
										class="flex h-7 w-7 items-center justify-center text-[var(--text-ghost)] transition-colors hover:bg-[var(--void-2)] hover:text-[var(--text)] disabled:opacity-30"
										title="run now"
										disabled={isActing || job.running}
										onclick={() => void handleJobTrigger(job.name)}
									>
										{#if isActing && !job.paused}
											<Icon name="loader" size={12} class="animate-spin" />
										{:else}
											<Icon name="play" size={12} />
										{/if}
									</button>

									<!-- Pause / Resume -->
									{#if job.paused}
										<button
											type="button"
											class="flex h-7 w-7 items-center justify-center text-[var(--text-ghost)] transition-colors hover:bg-[var(--void-2)] hover:text-[var(--text)] disabled:opacity-30"
											title="resume"
											disabled={isActing}
											onclick={() => void handleJobResume(job.name)}
										>
											{#if isActing}
												<Icon name="loader" size={12} class="animate-spin" />
											{:else}
												<Icon name="skip-forward" size={12} />
											{/if}
										</button>
									{:else}
										<button
											type="button"
											class="flex h-7 w-7 items-center justify-center text-[var(--text-ghost)] transition-colors hover:bg-[var(--void-2)] hover:text-[var(--text)] disabled:opacity-30"
											title="pause"
											disabled={isActing || job.running}
											onclick={() => void handleJobPause(job.name)}
										>
											{#if isActing}
												<Icon name="loader" size={12} class="animate-spin" />
											{:else}
												<Icon name="pause" size={12} />
											{/if}
										</button>
									{/if}
								</div>
							</div>
						{/each}
					{/if}
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
		transition:
			border-color 150ms,
			background-color 150ms;
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
		transition:
			border-color 150ms,
			background-color 150ms;
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
		appearance: textfield;
		-moz-appearance: textfield;
	}
</style>
