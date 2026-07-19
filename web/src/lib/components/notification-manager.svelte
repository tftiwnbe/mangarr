<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { useConvexClient, useQuery } from 'convex-svelte';

	import { convexApi } from '$lib/convex/api';
	import { syncApplicationBadge } from '$lib/client/pwa-notifications';

	const client = useConvexClient();
	const inboxQuery = useQuery(convexApi.notifications.listInbox, () => ({ limit: 25 }));

	let markingEventId = $state<string | null>(null);
	let cleanedNotificationQuery = $state(false);
	const currentNotificationEventId = $derived(page.url.searchParams.get('notificationEventId'));
	const currentPathWithoutNotificationParam = $derived.by(() => {
		const url = new URL(page.url);
		url.searchParams.delete('notificationEventId');
		return `${url.pathname}${url.search}${url.hash}`;
	});

	$effect(() => {
		if (!browser) return;
		void syncApplicationBadge(inboxQuery.data?.unreadCount ?? 0);
	});

	$effect(() => {
		if (!browser) return;
		const eventId = currentNotificationEventId;
		if (!eventId) {
			cleanedNotificationQuery = false;
			return;
		}
		if (markingEventId === eventId) return;
		markingEventId = eventId;
		void client
			.mutation(convexApi.notifications.markEventRead, {
				eventId: eventId as never,
				clicked: true
			})
			.catch(() => undefined)
			.finally(() => {
				markingEventId = null;
				if (cleanedNotificationQuery) return;
				cleanedNotificationQuery = true;
				void goto(currentPathWithoutNotificationParam, {
					replaceState: true,
					keepFocus: true,
					noScroll: true
				});
			});
	});
</script>
