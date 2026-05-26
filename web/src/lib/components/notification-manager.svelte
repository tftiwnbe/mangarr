<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { SvelteSet } from 'svelte/reactivity';

	import { convexApi } from '$lib/convex/api';
	import {
		getNotificationCapability,
		showForegroundNotification,
		syncApplicationBadge,
		type NotificationEventItem
	} from '$lib/client/pwa-notifications';

	const client = useConvexClient();
	const preferencesQuery = useQuery(convexApi.notifications.getPreferences, () => ({}));
	const eventsQuery = useQuery(convexApi.notifications.listPendingEvents, () => ({ limit: 25 }));

	const seenEventIds = new SvelteSet<string>();
	const showingEventIds = new SvelteSet<string>();
	let acknowledgingQueryEventId = $state<string | null>(null);
	let cleanedNotificationQuery = $state(false);

	const currentNotificationEventId = $derived(page.url.searchParams.get('notificationEventId'));
	const currentPathWithoutNotificationParam = $derived.by(() => {
		const url = new URL(page.url);
		url.searchParams.delete('notificationEventId');
		return `${url.pathname}${url.search}${url.hash}`;
	});

	$effect(() => {
		if (!browser) return;
		void syncApplicationBadge(eventsQuery.data?.totalCount ?? 0);
	});

	$effect(() => {
		if (!browser) return;
		const eventId = currentNotificationEventId;
		if (!eventId) {
			cleanedNotificationQuery = false;
			return;
		}
		if (!eventId || acknowledgingQueryEventId === eventId) return;
		acknowledgingQueryEventId = eventId;
		void client
			.mutation(convexApi.notifications.acknowledgeEvent, {
				eventId: eventId as never
			})
			.catch(() => undefined)
			.finally(() => {
				acknowledgingQueryEventId = null;
				if (cleanedNotificationQuery) return;
				cleanedNotificationQuery = true;
				void goto(currentPathWithoutNotificationParam, {
					replaceState: true,
					keepFocus: true,
					noScroll: true
				});
			});
	});

	$effect(() => {
		if (!browser) return;
		const prefs = preferencesQuery.data;
		const pending = (eventsQuery.data?.items ?? []) as NotificationEventItem[];
		if (!prefs?.collectionNotificationsEnabled || !prefs?.foregroundNotificationsEnabled) return;
		const capability = getNotificationCapability();
		if (!capability.supported || capability.permission !== 'granted') return;

		for (const item of pending) {
			if (item.lastDeliveredAt !== null) continue;
			if (seenEventIds.has(item.id) || showingEventIds.has(item.id)) continue;
			showingEventIds.add(item.id);
			void showForegroundNotification(item)
				.then(() =>
					client.mutation(convexApi.notifications.acknowledgeEvent, {
						eventId: item.id as never
					})
				)
				.then(() => {
					seenEventIds.add(item.id);
				})
				.catch(() => undefined)
				.finally(() => {
					showingEventIds.delete(item.id);
				});
		}
	});
</script>
