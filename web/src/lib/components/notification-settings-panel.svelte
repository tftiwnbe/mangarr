<script lang="ts">
	import { browser } from '$app/environment';
	import { useConvexClient, useQuery } from 'convex-svelte';

	import { convexApi } from '$lib/convex/api';
	import { Alert } from '$lib/elements/alert';
	import { Button } from '$lib/elements/button';
	import { Switch } from '$lib/elements/switch';
	import {
		getNotificationCapability,
		subscribeToWebPush,
		unsubscribeFromWebPush
	} from '$lib/client/pwa-notifications';

	const client = useConvexClient();
	const statusQuery = useQuery(convexApi.notifications.listStatus, () => ({}));

	let enabling = $state(false);
	let disabling = $state(false);
	let savingPreferences = $state(false);
	let error = $state<string | null>(null);

	const capability = $derived(browser ? getNotificationCapability() : null);
	const status = $derived(statusQuery.data ?? null);
	const backgroundStatusLabel = $derived.by(() => {
		if (!capability?.supported || !capability.pushSupported) return 'Notifications are not supported here.';
		if (!status?.backgroundPushConfigured) return 'Background push is not configured on the server.';
		if (capability.iosLike && !capability.installed) {
			return 'On iPhone and iPad, install Mangarr to the Home Screen before enabling notifications.';
		}
		if (capability.permission === 'denied') return 'Notification permission is denied for this app.';
		if (status?.hasActiveSubscription) return 'Background notifications are enabled for this device.';
		if (capability.permission === 'granted') return 'Permission is granted, but this device is not subscribed yet.';
		return 'Enable notifications from this installed app to receive chapter alerts while closed.';
	});

	async function savePreferences(partial: {
		collectionNotificationsEnabled?: boolean;
		iosPwaPushEnabled?: boolean;
		foregroundNotificationsEnabled?: boolean;
	}) {
		savingPreferences = true;
		error = null;
		try {
			await client.mutation(convexApi.notifications.updatePreferences, partial);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to save notification settings';
		} finally {
			savingPreferences = false;
		}
	}

	async function handleEnableBackground() {
		if (!status?.vapidPublicKey || enabling) return;
		enabling = true;
		error = null;
		try {
			await subscribeToWebPush({
				client,
				applicationServerKey: status.vapidPublicKey
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to enable notifications';
		} finally {
			enabling = false;
		}
	}

	async function handleDisableBackground() {
		if (disabling) return;
		disabling = true;
		error = null;
		try {
			await unsubscribeFromWebPush({ client });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to disable notifications';
		} finally {
			disabling = false;
		}
	}
</script>

<section class="flex flex-col gap-4">
	<div class="flex flex-col gap-1">
		<h2 class="text-sm font-medium text-[var(--text-soft)]">notifications</h2>
		<p class="text-xs text-[var(--text-ghost)]">
			Get alerts when monitored titles receive new chapters in collections you explicitly track.
		</p>
	</div>

	<div class="flex items-start justify-between gap-3 py-1">
		<div class="flex flex-col gap-0.5">
			<span class="text-sm text-[var(--text-soft)]">collection notifications</span>
			<span class="text-xs text-[var(--text-ghost)]">
				Create notification events for monitored titles in manual collections with alerts enabled.
			</span>
		</div>
		<Switch
			checked={status?.collectionNotificationsEnabled ?? true}
			disabled={savingPreferences}
			onCheckedChange={(value) => {
				void savePreferences({ collectionNotificationsEnabled: value });
			}}
		/>
	</div>

	<div class="flex items-start justify-between gap-3 py-1">
		<div class="flex flex-col gap-0.5">
			<span class="text-sm text-[var(--text-soft)]">foreground notifications</span>
			<span class="text-xs text-[var(--text-ghost)]">
				Show a system notification while the app is already open.
			</span>
		</div>
		<Switch
			checked={status?.foregroundNotificationsEnabled ?? true}
			disabled={savingPreferences}
			onCheckedChange={(value) => {
				void savePreferences({ foregroundNotificationsEnabled: value });
			}}
		/>
	</div>

	<div class="flex items-start justify-between gap-3 py-1">
		<div class="flex flex-col gap-0.5">
			<span class="text-sm text-[var(--text-soft)]">background notifications</span>
			<span class="text-xs text-[var(--text-ghost)]">
				Use Web Push for installed PWAs, primarily iPhone Home Screen installs.
			</span>
		</div>
		<Switch
			checked={status?.iosPwaPushEnabled ?? true}
			disabled={savingPreferences}
			onCheckedChange={(value) => {
				void savePreferences({ iosPwaPushEnabled: value });
			}}
		/>
	</div>

	<div class="flex flex-col gap-2 border border-[var(--line)] p-3">
		<div class="flex flex-col gap-1">
			<span class="text-sm text-[var(--text-soft)]">device status</span>
			<p class="text-xs text-[var(--text-ghost)]">{backgroundStatusLabel}</p>
			<p class="text-[11px] uppercase tracking-[0.2em] text-[var(--text-ghost)]">
				permission: {capability?.permission ?? 'unsupported'} · subscriptions:
				{status?.activeSubscriptionCount ?? 0}
			</p>
		</div>

		<div class="flex flex-wrap gap-2">
			<Button
				variant="outline"
				size="sm"
				onclick={handleEnableBackground}
				disabled={!status?.backgroundPushConfigured ||
					!capability?.supported ||
					!capability?.pushSupported ||
					(capability?.iosLike && !capability?.installed) ||
					enabling ||
					status?.hasActiveSubscription === true}
				loading={enabling}
			>
				enable notifications
			</Button>
			<Button
				variant="ghost"
				size="sm"
				onclick={handleDisableBackground}
				disabled={!status?.hasActiveSubscription || disabling}
				loading={disabling}
			>
				disable on this device
			</Button>
		</div>
	</div>

	{#if error}
		<Alert variant="error">{error}</Alert>
	{/if}
</section>
