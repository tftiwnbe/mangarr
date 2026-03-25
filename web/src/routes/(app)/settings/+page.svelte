<script lang="ts">
	import { goto } from '$app/navigation';
	import { useQuery } from 'convex-svelte';
	import { onMount } from 'svelte';

	import { convexApi } from '$lib/convex/api';
	import { Button } from '$lib/elements/button';
	import { Input } from '$lib/elements/input';
	import { Switch } from '$lib/elements/switch';
	import { Tabs, type TabItem } from '$lib/elements/tabs';
	import { _ } from '$lib/i18n';
	import {
		contentLanguages,
		loadContentLanguages,
		setContentLanguages,
		getKnownContentLanguages,
		setKnownContentLanguages
	} from '$lib/stores/content-languages';
	import { themePreference, setTheme } from '$lib/stores/theme';
	import { toMainContentLanguages } from '$lib/utils/content-languages';
	import {
		ArrowLeftIcon,
		ArrowsClockwiseIcon,
		MonitorIcon,
		MoonIcon,
		SpinnerIcon,
		SunIcon,
		TrashIcon
	} from 'phosphor-svelte';

	type SettingsTab = 'account' | 'library' | 'system' | 'about';

	type UserProfile = {
		id: string;
		username: string;
		is_admin: boolean;
		created_at: string;
		last_login_at: string | null;
	};

	type IntegrationApiKeyResource = {
		publicId: number;
		name: string;
		keyPrefix: string;
		createdAt: number;
		lastUsedAt?: number;
		revokedAt?: number;
	};

	type LibraryUserStatusResource = {
		id: string;
		key: string;
		label: string;
		position: number;
		isDefault: boolean;
	};

	type LibraryCollectionResource = {
		id: string;
		name: string;
		position: number;
		isDefault: boolean;
		titlesCount: number;
	};

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

	type RepositoryState = {
		url: string;
		configured: boolean;
		items?: RepositoryEntry[];
	};

	type RepositoryEntry = {
		lang?: string | null;
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

	type SourceItem = {
		lang: string;
	};

	const themeModes = [
		{ value: 'dark' as const, icon: MoonIcon, label: 'dark' },
		{ value: 'system' as const, icon: MonitorIcon, label: 'system' },
		{ value: 'light' as const, icon: SunIcon, label: 'light' }
	];

	const sourcesQuery = useQuery(convexApi.extensions.listSources, () => ({}));

	let user = $state<UserProfile | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let activeTab = $state<SettingsTab>('account');

	let extensionRepoUrl = $state('');
	let extensionRepoLoading = $state(true);
	let extensionRepoSaving = $state(false);
	let extensionRepoError = $state<string | null>(null);
	let extensionRepoSuccess = $state(false);
	let knownLangs = $state<string[]>([]);

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordLoading = $state(false);
	let passwordError = $state<string | null>(null);
	let passwordSuccess = $state(false);

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
	let statusSavingId = $state<string | null>(null);
	let deletingStatusId = $state<string | null>(null);
	let newStatusLabel = $state('');
	let creatingStatus = $state(false);

	let collections = $state<LibraryCollectionResource[]>([]);
	let collectionsLoading = $state(true);
	let collectionsError = $state<string | null>(null);
	let newCollectionName = $state('');
	let creatingCollection = $state(false);
	let deletingCollectionId = $state<string | null>(null);
	let collectionSavingId = $state<string | null>(null);

	let downloadRootDir = $state('');
	let downloadFailedChapterRetryDelaySeconds = $state(21600);
	let downloadCompressChapters = $state(false);
	let downloadTotalBytes = $state(0);
	let downloadUsedBytes = $state(0);
	let downloadFreeBytes = $state(0);
	let downloadsSettingsLoading = $state(true);
	let downloadsSettingsSaving = $state(false);
	let downloadsSettingsError = $state<string | null>(null);
	let downloadsSettingsSuccess = $state(false);

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

	let health = $state<BridgeHealth | null>(null);
	let healthLoading = $state(true);
	let healthError = $state<string | null>(null);

	const sortedCollections = $derived(
		[...collections].sort((a, b) => b.titlesCount - a.titlesCount || a.position - b.position)
	);

	$effect(() => {
		const sourceLangs = toMainContentLanguages(
			((sourcesQuery.data ?? []) as SourceItem[]).map((source) => source.lang)
		);
		if (sourceLangs.length === 0) return;
		setKnownContentLanguages(sourceLangs);
		knownLangs = toMainContentLanguages([...sourceLangs, ...getKnownContentLanguages()]);
	});

	onMount(async () => {
		knownLangs = getKnownContentLanguages();
		try {
			user = await fetchJson<UserProfile>('/api/auth/me');
			await Promise.all([
				loadLibraryStatuses(),
				loadLibraryCollections(),
				loadDownloadSettings(),
				loadIntegrationApiKeys(),
				loadFlareSolverrSettings(),
				loadProxySettings(),
				loadExtensionSettings(),
				loadContentLanguages(),
				loadHealth()
			]);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to load profile';
		} finally {
			loading = false;
		}
	});

	async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
		const response = await fetch(url, init);
		if (!response.ok) {
			throw new Error(await readError(response, `Request failed: ${url}`));
		}
		return (await response.json()) as T;
	}

	async function readError(response: Response, fallback: string) {
		try {
			const payload = (await response.json()) as { message?: string };
			return payload.message ?? fallback;
		} catch {
			return fallback;
		}
	}

	async function loadLibraryStatuses() {
		statusesLoading = true;
		statusesError = null;
		try {
			const result = await fetchJson<{ items: LibraryUserStatusResource[] }>('/api/library/statuses');
			statuses = result.items;
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
			const result = await fetchJson<{ items: LibraryCollectionResource[] }>('/api/library/collections');
			collections = result.items;
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
			const settings = await fetchJson<DownloadSettings>('/api/internal/bridge/settings/downloads');
			downloadRootDir = settings.downloadPath;
			downloadFailedChapterRetryDelaySeconds = settings.failedRetryDelaySeconds;
			downloadCompressChapters = settings.compressionEnabled;
			downloadTotalBytes = settings.totalSpaceBytes;
			downloadUsedBytes = settings.usedSpaceBytes;
			downloadFreeBytes = settings.freeSpaceBytes;
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
			const result = await fetchJson<{ keys: IntegrationApiKeyResource[] }>('/api/auth/integration-keys');
			integrationApiKeys = result.keys;
		} catch (cause) {
			integrationKeysError =
				cause instanceof Error ? cause.message : 'Failed to load integration API keys';
		} finally {
			integrationKeysLoading = false;
		}
	}

	async function loadFlareSolverrSettings() {
		flareSettingsLoading = true;
		flareSettingsError = null;
		try {
			const settings = await fetchJson<FlareSolverrSettings>('/api/internal/bridge/settings/flaresolverr');
			flareEnabled = settings.enabled;
			flareUrl = settings.url;
			flareTimeoutSeconds = settings.timeoutSeconds;
			flareResponseFallback = settings.responseFallback;
			flareSessionName = settings.sessionName ?? '';
			flareSessionTtlMinutes =
				settings.sessionTtlMinutes !== null && settings.sessionTtlMinutes !== undefined
					? String(settings.sessionTtlMinutes)
					: '';
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
			const settings = await fetchJson<ProxySettings>('/api/internal/bridge/settings/proxy');
			proxyHostname = settings.hostname;
			proxyPort = settings.port;
			proxyUsername = settings.username ?? '';
			proxyPassword = settings.password ?? '';
			proxyIgnoredAddresses = settings.ignoredAddresses;
			proxyBypassLocalAddresses = settings.bypassLocalAddresses;
		} catch (cause) {
			proxySettingsError = cause instanceof Error ? cause.message : 'Failed to load proxy settings';
		} finally {
			proxySettingsLoading = false;
		}
	}

	async function loadExtensionSettings() {
		extensionRepoLoading = true;
		extensionRepoError = null;
		try {
			const repository = await fetchJson<RepositoryState>('/api/extensions/repository?includeItems=1');
			extensionRepoUrl = repository.url;
			const repoLangs = toMainContentLanguages((repository.items ?? []).map((item) => item.lang));
			const nextKnownLangs = toMainContentLanguages([...knownLangs, ...repoLangs, ...$contentLanguages]);
			if (nextKnownLangs.length > 0) {
				setKnownContentLanguages(nextKnownLangs);
				knownLangs = nextKnownLangs;
			}
		} catch (cause) {
			extensionRepoError =
				cause instanceof Error ? cause.message : 'Failed to load extension settings';
		} finally {
			extensionRepoLoading = false;
		}
	}

	async function loadHealth() {
		healthLoading = true;
		healthError = null;
		try {
			health = await fetchJson<BridgeHealth>('/api/internal/bridge/health');
		} catch (cause) {
			healthError = cause instanceof Error ? cause.message : 'Failed to load bridge health';
		} finally {
			healthLoading = false;
		}
	}

	async function handleSaveExtensionRepo() {
		if (!extensionRepoUrl.trim() || extensionRepoSaving) return;
		extensionRepoSaving = true;
		extensionRepoError = null;
		extensionRepoSuccess = false;

		try {
			const result = await fetchJson<RepositoryEntry[]>('/api/extensions/repository', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url: extensionRepoUrl.trim() })
			});
			const repoLangs = toMainContentLanguages(result.map((item) => item.lang));
			if (repoLangs.length > 0) {
				setKnownContentLanguages(repoLangs);
				knownLangs = repoLangs;
			}
			extensionRepoSuccess = true;
			setTimeout(() => (extensionRepoSuccess = false), 3000);
			const repository = await fetchJson<RepositoryState>('/api/extensions/repository');
			extensionRepoUrl = repository.url;
		} catch (cause) {
			extensionRepoError = cause instanceof Error ? cause.message : 'Failed to update repository';
		} finally {
			extensionRepoSaving = false;
		}
	}

	async function handleToggleContentLang(lang: string) {
		const lower = lang.toLowerCase();
		if ($contentLanguages.includes(lower)) {
			await setContentLanguages($contentLanguages.filter((item) => item !== lower));
			return;
		}
		await setContentLanguages([...$contentLanguages, lower]);
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
			await fetchJson<{ ok: true }>('/api/auth/change-password', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					current_password: currentPassword,
					new_password: newPassword
				})
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

	async function handleCreateIntegrationApiKey() {
		const name = integrationKeyName.trim();
		if (!name || creatingIntegrationKey) return;

		creatingIntegrationKey = true;
		integrationKeysError = null;
		try {
			const created = await fetchJson<{ key: string; item: IntegrationApiKeyResource }>(
				'/api/auth/integration-keys',
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ name })
				}
			);
			createdIntegrationKeyName = created.item.name;
			createdIntegrationKeyValue = created.key;
			integrationKeyName = '';
			await loadIntegrationApiKeys();
		} catch (cause) {
			integrationKeysError =
				cause instanceof Error ? cause.message : 'Failed to create integration API key';
		} finally {
			creatingIntegrationKey = false;
		}
	}

	async function handleRevokeIntegrationApiKey(publicId: number) {
		if (revokingIntegrationKeyId === publicId) return;
		revokingIntegrationKeyId = publicId;
		integrationKeysError = null;
		try {
			await fetchJson<{ revoked: boolean }>(`/api/auth/integration-keys/${publicId}`, {
				method: 'DELETE'
			});
			integrationApiKeys = integrationApiKeys.filter((item) => item.publicId !== publicId);
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
			// Leave the key visible for manual copy.
		}
	}

	async function handleSignOut() {
		await fetch('/api/auth/logout', { method: 'POST' });
		await goto('/login', { replaceState: true });
	}

	function handleStatusFieldChange(statusId: string, value: string) {
		statuses = statuses.map((status) => (status.id === statusId ? { ...status, label: value } : status));
	}

	async function handleSaveStatus(statusId: string) {
		const status = statuses.find((item) => item.id === statusId);
		if (!status || statusSavingId === statusId) return;
		statusSavingId = statusId;
		statusesError = null;
		try {
			const updated = await fetchJson<LibraryUserStatusResource>(`/api/library/statuses/${statusId}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					label: status.label,
					position: status.position
				})
			});
			statuses = statuses.map((item) => (item.id === statusId ? updated : item));
		} catch (cause) {
			statusesError = cause instanceof Error ? cause.message : 'Failed to save status';
		} finally {
			statusSavingId = null;
		}
	}

	async function handleDeleteStatus(statusId: string) {
		if (deletingStatusId === statusId) return;
		deletingStatusId = statusId;
		statusesError = null;
		try {
			await fetchJson<{ deleted: boolean }>(`/api/library/statuses/${statusId}`, {
				method: 'DELETE'
			});
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
			const created = await fetchJson<LibraryUserStatusResource>('/api/library/statuses', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ label })
			});
			statuses = [...statuses, created].sort((left, right) => left.position - right.position);
			newStatusLabel = '';
		} catch (cause) {
			statusesError = cause instanceof Error ? cause.message : 'Failed to create status';
		} finally {
			creatingStatus = false;
		}
	}

	function handleCollectionFieldChange(collectionId: string, value: string) {
		collections = collections.map((collection) =>
			collection.id === collectionId ? { ...collection, name: value } : collection
		);
	}

	async function handleSaveCollection(collectionId: string) {
		const collection = collections.find((item) => item.id === collectionId);
		if (!collection || collectionSavingId === collectionId) return;
		collectionSavingId = collectionId;
		collectionsError = null;
		try {
			const updated = await fetchJson<LibraryCollectionResource>(
				`/api/library/collections/${collectionId}`,
				{
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						name: collection.name,
						position: collection.position
					})
				}
			);
			collections = collections.map((item) => (item.id === collectionId ? updated : item));
		} catch (cause) {
			collectionsError = cause instanceof Error ? cause.message : 'Failed to save collection';
		} finally {
			collectionSavingId = null;
		}
	}

	async function handleDeleteCollection(collectionId: string) {
		if (deletingCollectionId === collectionId) return;
		deletingCollectionId = collectionId;
		collectionsError = null;
		try {
			await fetchJson<{ deleted: boolean }>(`/api/library/collections/${collectionId}`, {
				method: 'DELETE'
			});
			collections = collections.filter((collection) => collection.id !== collectionId);
		} catch (cause) {
			collectionsError = cause instanceof Error ? cause.message : 'Failed to delete collection';
		} finally {
			deletingCollectionId = null;
		}
	}

	async function handleCreateCollection() {
		const name = newCollectionName.trim();
		if (!name || creatingCollection) return;
		creatingCollection = true;
		collectionsError = null;
		try {
			const created = await fetchJson<LibraryCollectionResource>('/api/library/collections', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name })
			});
			collections = [...collections, created].sort((left, right) => left.position - right.position);
			newCollectionName = '';
		} catch (cause) {
			collectionsError = cause instanceof Error ? cause.message : 'Failed to create collection';
		} finally {
			creatingCollection = false;
		}
	}

	async function handleSaveDownloadSettings() {
		if (!downloadRootDir.trim() || downloadsSettingsSaving) return;
		const retryDelay = Math.round(downloadFailedChapterRetryDelaySeconds);
		if (!Number.isFinite(retryDelay) || retryDelay < 60 || retryDelay > 604800) {
			downloadsSettingsError = $_('settings.failedChapterRetryDelayInvalid');
			return;
		}

		downloadsSettingsSaving = true;
		downloadsSettingsError = null;
		downloadsSettingsSuccess = false;
		try {
			const updated = await fetchJson<DownloadSettings>('/api/internal/bridge/settings/downloads', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					downloadPath: downloadRootDir.trim(),
					compressionEnabled: downloadCompressChapters,
					failedRetryDelaySeconds: retryDelay
				})
			});
			downloadRootDir = updated.downloadPath;
			downloadFailedChapterRetryDelaySeconds = updated.failedRetryDelaySeconds;
			downloadCompressChapters = updated.compressionEnabled;
			downloadTotalBytes = updated.totalSpaceBytes;
			downloadUsedBytes = updated.usedSpaceBytes;
			downloadFreeBytes = updated.freeSpaceBytes;
			downloadsSettingsSuccess = true;
			setTimeout(() => (downloadsSettingsSuccess = false), 3000);
		} catch (cause) {
			downloadsSettingsError =
				cause instanceof Error ? cause.message : 'Failed to save download settings';
		} finally {
			downloadsSettingsSaving = false;
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

			const updated = await fetchJson<ProxySettings>('/api/internal/bridge/settings/proxy', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					hostname,
					port,
					username: proxyUsername.trim(),
					password: proxyPassword.trim(),
					ignoredAddresses: proxyIgnoredAddresses.trim(),
					bypassLocalAddresses: proxyBypassLocalAddresses
				})
			});

			proxyHostname = updated.hostname;
			proxyPort = updated.port;
			proxyUsername = updated.username ?? '';
			proxyPassword = updated.password ?? '';
			proxyIgnoredAddresses = updated.ignoredAddresses;
			proxyBypassLocalAddresses = updated.bypassLocalAddresses;
			proxySettingsSuccess = true;
			setTimeout(() => (proxySettingsSuccess = false), 3000);
		} catch (cause) {
			proxySettingsError = cause instanceof Error ? cause.message : 'Failed to save proxy settings';
		} finally {
			proxySettingsSaving = false;
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
			const updated = await fetchJson<FlareSolverrSettings>(
				'/api/internal/bridge/settings/flaresolverr',
				{
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						enabled: flareEnabled,
						url: flareUrl.trim(),
						timeoutSeconds: timeout,
						responseFallback: flareResponseFallback,
						sessionName: flareSessionName.trim(),
						sessionTtlMinutes: sessionTtl
					})
				}
			);
			flareEnabled = updated.enabled;
			flareUrl = updated.url;
			flareTimeoutSeconds = updated.timeoutSeconds;
			flareResponseFallback = updated.responseFallback;
			flareSessionName = updated.sessionName ?? '';
			flareSessionTtlMinutes =
				updated.sessionTtlMinutes !== null && updated.sessionTtlMinutes !== undefined
					? String(updated.sessionTtlMinutes)
					: '';
			flareSettingsSuccess = true;
			setTimeout(() => (flareSettingsSuccess = false), 3000);
		} catch (cause) {
			flareSettingsError =
				cause instanceof Error ? cause.message : 'Failed to save FlareSolverr settings';
		} finally {
			flareSettingsSaving = false;
		}
	}

	function formatBytes(bytes: number) {
		if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
		const value = bytes / 1024 ** exponent;
		return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
	}

	function formatDateTime(value: string | number | null | undefined) {
		if (value === null || value === undefined || value === '') return '—';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return '—';
		return parsed.toLocaleString();
	}
</script>

<svelte:head>
	<title>{$_('nav.settings')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex max-w-xl flex-col gap-6">
	<h1 class="text-display text-xl text-[var(--text)]">{$_('nav.settings').toLowerCase()}</h1>

	{#if loading}
		<div class="flex flex-col items-center gap-4 py-16">
			<SpinnerIcon size={24} class="animate-spin text-[var(--text-muted)]" />
			<p class="text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
		</div>
	{:else if error && !user}
		<p class="text-sm text-[var(--error)]">{error}</p>
	{:else}
		<Tabs
			tabs={[
				{ value: 'account', label: $_('settings.account') },
				{ value: 'library', label: $_('nav.library') },
				{ value: 'system', label: $_('settings.system') },
				{ value: 'about', label: $_('settings.about') }
			] satisfies TabItem[]}
			value={activeTab}
			onValueChange={(value) => (activeTab = value as SettingsTab)}
		/>

		{#if activeTab === 'account'}
			<div class="flex flex-col gap-8">
				<div class="flex flex-col gap-3">
					<div class="flex items-baseline justify-between">
						<span class="text-label">{$_('settings.username')}</span>
						<span class="text-sm text-[var(--text)]">{user?.username}</span>
					</div>
					<div class="flex items-baseline justify-between">
						<span class="text-label">{$_('settings.role')}</span>
						<span class="text-sm text-[var(--text)]">
							{user?.is_admin ? $_('settings.roleAdmin') : $_('settings.roleUser')}
						</span>
					</div>
					<Button variant="ghost" size="sm" onclick={handleSignOut} class="self-start">
						<ArrowLeftIcon size={14} />
						{$_('settings.signOut').toLowerCase()}
					</Button>
				</div>

				<section class="flex flex-col gap-4">
					<h2 class="text-sm font-medium text-[var(--text-soft)]">appearance</h2>
					<div class="flex flex-col gap-2">
						<span class="text-label">theme</span>
						<div class="inline-flex self-start border border-[var(--line)]">
							{#each themeModes as mode (mode.value)}
								{@const isActive = $themePreference === mode.value}
								{@const ModeIcon = mode.icon}
								<button
									type="button"
									class="flex items-center gap-1.5 px-3 py-2 text-xs tracking-wider uppercase transition-all duration-150
										{isActive
											? 'bg-[var(--void-4)] text-[var(--text)]'
											: 'text-[var(--text-ghost)] hover:bg-[var(--void-3)] hover:text-[var(--text-muted)]'}"
									onclick={() => setTheme(mode.value)}
								>
									<ModeIcon size={14} weight={isActive ? 'fill' : 'light'} />
									{mode.label}
								</button>
							{/each}
						</div>
					</div>
				</section>

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

				<section class="flex flex-col gap-4">
					<div class="flex flex-col gap-1">
						<h2 class="text-sm font-medium text-[var(--text-soft)]">
							{$_('settings.integrationApiKeys').toLowerCase()}
						</h2>
						<p class="text-xs text-[var(--text-ghost)]">
							{$_('settings.integrationApiKeysDescription')}
						</p>
					</div>

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

					{#if createdIntegrationKeyValue}
						<div class="animate-fade-in bg-[var(--void-3)] p-4">
							<p class="text-xs text-[var(--text-ghost)]">
								{$_('settings.integrationApiKeyCreated', {
									values: { name: createdIntegrationKeyName ?? '' }
								})}
							</p>
							<p class="mt-2 text-xs break-all text-[var(--text)]">{createdIntegrationKeyValue}</p>
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

					{#if integrationKeysLoading}
						<p class="text-xs text-[var(--text-ghost)]">{$_('common.loading')}</p>
					{:else if integrationApiKeys.length === 0}
						<p class="text-xs text-[var(--text-ghost)]">{$_('settings.noIntegrationApiKeys')}</p>
					{:else}
						<div class="flex flex-col">
							{#each integrationApiKeys as key (`${key.publicId}`)}
								<div class="flex items-center justify-between gap-3 border-b border-[var(--void-3)]/30 py-3 last:border-b-0">
									<div class="min-w-0 flex-1">
										<p class="truncate text-sm text-[var(--text)]">{key.name}</p>
										<p class="mt-1 text-xs text-[var(--text-ghost)]">
											{key.keyPrefix} · {$_('settings.createdAt')}: {formatDateTime(key.createdAt)}
										</p>
										{#if key.lastUsedAt}
											<p class="mt-0.5 text-xs text-[var(--text-ghost)]">
												{$_('settings.lastUsedAt')}: {formatDateTime(key.lastUsedAt)}
											</p>
										{/if}
									</div>
									<Button
										variant="ghost"
										size="sm"
										onclick={() => handleRevokeIntegrationApiKey(key.publicId)}
										disabled={revokingIntegrationKeyId === key.publicId}
										loading={revokingIntegrationKeyId === key.publicId}
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
		{:else if activeTab === 'library'}
			<div class="flex flex-col gap-8">
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
								<div class="flex items-center gap-2 border-b border-[var(--void-3)]/30 py-2.5 last:border-b-0">
									<input
										type="text"
										class="settings-input-compact min-w-0 flex-1"
										value={status.label}
										oninput={(event) =>
											handleStatusFieldChange(status.id, (event.currentTarget as HTMLInputElement).value)}
									/>
									<span class="hidden shrink-0 text-[10px] text-[var(--text-ghost)] sm:inline-flex">
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
									{#if !status.isDefault}
										<button
											type="button"
											class="flex h-10 w-10 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:bg-[var(--error-soft)] hover:text-[var(--error)]"
											onclick={() => handleDeleteStatus(status.id)}
											disabled={deletingStatusId === status.id}
											title={$_('common.delete')}
										>
											{#if deletingStatusId === status.id}
												<SpinnerIcon size={14} class="animate-spin" />
											{:else}
												<TrashIcon size={14} />
											{/if}
										</button>
									{:else}
										<span class="w-10 shrink-0"></span>
									{/if}
								</div>
							{/each}

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
									<div class="flex items-center gap-2 border-b border-[var(--void-3)]/30 py-2.5 last:border-b-0">
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
										{#if !collection.isDefault}
											<button
												type="button"
												class="flex h-10 w-10 shrink-0 items-center justify-center text-[var(--text-ghost)] transition-colors hover:bg-[var(--error-soft)] hover:text-[var(--error)]"
												onclick={() => handleDeleteCollection(collection.id)}
												disabled={deletingCollectionId === collection.id ||
													collectionSavingId === collection.id}
												title={$_('common.delete')}
											>
												{#if deletingCollectionId === collection.id}
													<SpinnerIcon size={14} class="animate-spin" />
												{:else}
													<TrashIcon size={14} />
												{/if}
											</button>
										{:else}
											<span class="w-10 shrink-0"></span>
										{/if}
									</div>
								{/each}
							{/if}

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
		{:else if activeTab === 'system'}
			<div class="flex flex-col gap-8">
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

						<div class="flex items-center justify-between gap-3 py-1">
							<span class="text-sm text-[var(--text-soft)]">
								{$_('settings.downloadCompressionEnabled')}
							</span>
							<Switch
								checked={downloadCompressChapters}
								onCheckedChange={(value) => (downloadCompressChapters = value)}
							/>
						</div>

						<p class="text-xs text-[var(--text-ghost)]">
							{$_('settings.downloadCompressionLevelDescription')}
						</p>

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
						<Input label="Proxy hostname" bind:value={proxyHostname} placeholder="proxy.example.com" />

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

						<div class="flex items-center justify-between gap-3 py-1">
							<span class="text-sm text-[var(--text-soft)]">Bypass proxy for local addresses</span>
							<Switch
								checked={proxyBypassLocalAddresses}
								onCheckedChange={(value) => (proxyBypassLocalAddresses = value)}
							/>
						</div>

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
						<div class="flex items-center justify-between gap-3 py-1">
							<span class="text-sm text-[var(--text-soft)]">Enable FlareSolverr</span>
							<Switch checked={flareEnabled} onCheckedChange={(value) => (flareEnabled = value)} />
						</div>

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

						<div class="flex items-center justify-between gap-3 py-1">
							<span class="text-sm text-[var(--text-soft)]">Response fallback</span>
							<Switch
								checked={flareResponseFallback}
								onCheckedChange={(value) => (flareResponseFallback = value)}
							/>
						</div>
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
							<label class="text-label" for="flare-session-ttl">Session TTL minutes (optional)</label>
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
							<p class="animate-fade-in text-xs text-[var(--success)]">FlareSolverr settings saved</p>
						{/if}
					{/if}
				</section>
			</div>
		{:else}
			<div class="flex flex-col gap-6">
				<div class="flex flex-col gap-3">
					<div class="flex items-baseline justify-between">
						<span class="text-label">{$_('app.name')}</span>
						<span class="text-sm text-[var(--text)]">web</span>
					</div>
					<div class="flex items-baseline justify-between">
						<span class="text-label">{$_('settings.domain')}</span>
						<span class="text-sm text-[var(--text)]">local</span>
					</div>
				</div>

				<div class="flex flex-col gap-3">
					<div class="flex items-center justify-between">
						<span class="text-label">bridge runtime</span>
						<button
							type="button"
							class="text-[10px] tracking-widest text-[var(--text-ghost)] uppercase transition-colors hover:text-[var(--text-muted)]"
							onclick={loadHealth}
						>
							{#if healthLoading}
								<SpinnerIcon size={10} class="inline animate-spin" />
							{:else}
								<ArrowsClockwiseIcon size={10} class="inline" />
							{/if}
						</button>
					</div>

					{#if healthError}
						<p class="text-xs text-[var(--error)]">{healthError}</p>
					{:else if health}
						<div class="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
							<span class="text-label">status</span>
							<span class="text-[var(--text)]">{health.bridge?.status ?? '—'}</span>
							<span class="text-label">ready</span>
							<span class="text-[var(--text)]">{health.bridge?.ready ? 'yes' : 'no'}</span>
							<span class="text-label">running</span>
							<span class="text-[var(--text)]">{health.bridge?.running ? 'yes' : 'no'}</span>
							<span class="text-label">restart count</span>
							<span class="text-[var(--text)]">{health.bridge?.restartCount ?? 0}</span>
							<span class="text-label">last command poll</span>
							<span class="text-[var(--text)]">{formatDateTime(health.commands?.lastSuccessAt)}</span>
						</div>
						{#if health.commands?.lastError}
							<p class="text-xs text-[var(--error)]">{health.commands.lastError}</p>
						{/if}
						{#if health.bridge?.lastStartupError}
							<p class="text-xs text-[var(--error)]">{health.bridge.lastStartupError}</p>
						{/if}
					{:else}
						<p class="text-xs text-[var(--text-ghost)]">runtime status unavailable</p>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.settings-input {
		height: 3rem;
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

	.settings-input-compact {
		height: 2.5rem;
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
