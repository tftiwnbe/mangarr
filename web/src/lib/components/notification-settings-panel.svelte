<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import { convexApi } from '$lib/convex/api';
	import { Alert } from '$lib/elements/alert';
	import { Button } from '$lib/elements/button';
	import { Switch } from '$lib/elements/switch';
	import {
		getOrCreateNotificationInstallationKey,
		getNotificationCapability,
		reconcileWebPush,
		subscribeToWebPush,
		unsubscribeFromWebPush
	} from '$lib/client/pwa-notifications';

	const client = useConvexClient();
	let installationId = $state('');
	let capabilityRevision = $state(0);
	const overviewQuery = useQuery(convexApi.notifications.getOverview, () => ({
		installationId: installationId || undefined
	}));

	let changingDevice = $state(false);
	let savingPreferences = $state(false);
	let removingDeviceId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let reconciledKey = $state('');

	const capability = $derived.by(() => {
		void capabilityRevision;
		return browser ? getNotificationCapability() : null;
	});
	const overview = $derived(overviewQuery.data ?? null);
	const currentDevice = $derived(overview?.currentDevice ?? null);
	const preferences = $derived(overview?.preferences ?? null);
	const otherDevices = $derived(
		(overview?.devices ?? []).filter(
			(device) => device.installationId !== installationId && device.state !== 'revoked'
		)
	);

	onMount(() => {
		installationId = getOrCreateNotificationInstallationKey();
	});

	$effect(() => {
		if (!browser || !installationId || !overview?.vapidPublicKey || !overview.vapidKeyId) return;
		if (capability?.permission !== 'granted' && capability?.permission !== 'denied') return;
		const key = `${installationId}:${overview.vapidKeyId}:${capability.permission}`;
		if (reconciledKey === key) return;
		reconciledKey = key;
		void reconcileWebPush({
			client,
			applicationServerKey: overview.vapidPublicKey,
			vapidKeyId: overview.vapidKeyId
		}).catch((cause) => {
			error = cause instanceof Error ? cause.message : 'Failed to check notification status';
		});
	});

	async function setDeviceEnabled(enabled: boolean) {
		if (changingDevice) return;
		changingDevice = true;
		error = null;
		try {
			if (enabled) {
				if (!overview?.vapidPublicKey || !overview.vapidKeyId) {
					throw new Error('Notifications are not configured on the server');
				}
				await subscribeToWebPush({
					client,
					applicationServerKey: overview.vapidPublicKey,
					vapidKeyId: overview.vapidKeyId
				});
				await client.mutation(convexApi.notifications.updatePreferences, {
					webPushEnabled: true
				});
			} else {
				await unsubscribeFromWebPush({ client });
			}
			capabilityRevision += 1;
			reconciledKey = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to change notification settings';
		} finally {
			changingDevice = false;
		}
	}

	async function setNewChapterAlerts(enabled: boolean) {
		savingPreferences = true;
		error = null;
		try {
			await client.mutation(convexApi.notifications.updatePreferences, {
				collectionNotificationsEnabled: enabled,
				webPushEnabled: enabled
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to save notification settings';
		} finally {
			savingPreferences = false;
		}
	}

	async function setPrivatePreviews(enabled: boolean) {
		savingPreferences = true;
		error = null;
		try {
			await client.mutation(convexApi.notifications.updatePreferences, {
				privacyMode: enabled ? 'private' : 'detailed'
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to save notification settings';
		} finally {
			savingPreferences = false;
		}
	}

	async function removeDevice(deviceId: Id<'notificationDevices'>) {
		if (removingDeviceId) return;
		removingDeviceId = deviceId;
		error = null;
		try {
			await client.mutation(convexApi.notifications.revokeDeviceById, { deviceId });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to remove notification device';
		} finally {
			removingDeviceId = null;
		}
	}

	function formatTime(value: number) {
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(value)
		);
	}
</script>

<section class="flex flex-col gap-5">
	<div class="flex flex-col gap-1">
		<h2 class="text-sm font-medium text-[var(--text-soft)]">notifications</h2>
		<p class="text-xs text-[var(--text-ghost)]">
			Receive new chapter alerts even when Mangarr is closed.
		</p>
	</div>

	<div class="flex items-center justify-between gap-3 py-1">
		<span class="text-sm text-[var(--text-soft)]">notifications on this device</span>
		<Switch
			checked={Boolean(currentDevice)}
			disabled={changingDevice ||
				!overview?.backgroundPushConfigured ||
				!capability?.supported ||
				!capability?.pushSupported ||
				(capability?.iosLike && !capability?.installed)}
			onCheckedChange={(value) => void setDeviceEnabled(value)}
		/>
	</div>

	<div class="flex items-start justify-between gap-3 py-1">
		<div class="flex flex-col gap-0.5">
			<span class="text-sm text-[var(--text-soft)]">new chapter alerts</span>
			<span class="text-xs text-[var(--text-ghost)]"
				>For monitored titles in notified collections.</span
			>
		</div>
		<Switch
			checked={(preferences?.collectionNotificationsEnabled ?? true) &&
				(preferences?.webPushEnabled ?? true)}
			disabled={savingPreferences}
			onCheckedChange={(value) => void setNewChapterAlerts(value)}
		/>
	</div>

	<div class="flex items-start justify-between gap-3 py-1">
		<div class="flex flex-col gap-0.5">
			<span class="text-sm text-[var(--text-soft)]">hide titles on lock screen</span>
			<span class="text-xs text-[var(--text-ghost)]"
				>Use generic text in notification previews.</span
			>
		</div>
		<Switch
			checked={preferences?.privacyMode === 'private'}
			disabled={savingPreferences}
			onCheckedChange={(value) => void setPrivatePreviews(value)}
		/>
	</div>

	{#if otherDevices.length > 0}
		<details class="border-t border-[var(--line)] pt-3 text-xs">
			<summary class="cursor-pointer text-[var(--text-ghost)]">
				manage {otherDevices.length} other device{otherDevices.length === 1 ? '' : 's'}
			</summary>
			<div class="mt-2 flex flex-col gap-2">
				{#each otherDevices as device (device.id)}
					<div class="flex items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="truncate text-[var(--text-soft)]">{device.displayName}</p>
							<p class="text-[var(--text-ghost)]">Last seen {formatTime(device.lastSeenAt)}</p>
						</div>
						<Button
							variant="ghost"
							size="sm"
							disabled={Boolean(removingDeviceId)}
							loading={removingDeviceId === device.id}
							onclick={() => void removeDevice(device.id)}
						>
							remove
						</Button>
					</div>
				{/each}
			</div>
		</details>
	{/if}

	{#if error}
		<Alert variant="error">{error}</Alert>
	{/if}
</section>
