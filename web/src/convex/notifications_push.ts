"use node";

import webpush from 'web-push';
import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import { internal } from './_generated/api';
import { internalAction, type ActionCtx } from './_generated/server';
import { getPushConfiguration } from './notifications';

const EVENT_RETRY_STATUSES = ['pending', 'partial', 'failed'] as const;
const PUSH_BATCH_LIMIT = 20;

export const processPendingEvents = internalAction({
	args: {
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? PUSH_BATCH_LIMIT), 50));
		const selectedEventIds: GenericId<'chapterNotificationEvents'>[] = [];
		for (const status of EVENT_RETRY_STATUSES) {
			if (selectedEventIds.length >= limit) break;
			const rows = await ctx.runQuery(internal.notifications.listEventBatchByStatus, {
				status,
				limit: limit - selectedEventIds.length
			});
			selectedEventIds.push(...rows.map((row) => row._id));
		}

		let processed = 0;
		for (const eventId of selectedEventIds) {
			const queued = await ctx.runMutation(internal.notifications.markEventSending, { eventId });
			if (!queued.queued) continue;
			try {
				await sendEventPushesHandler(ctx, eventId);
			} catch (error) {
				await ctx.runMutation(internal.notifications.markEventDelivery, {
					eventId,
					status: 'failed',
					lastErrorMessage: error instanceof Error ? error.message : String(error),
					delivered: false
				});
			}
			processed += 1;
		}
		return { processed };
	}
});

export const sendEventPushes = internalAction({
	args: {
		eventId: v.id('chapterNotificationEvents')
	},
	handler: async (ctx, args) => sendEventPushesHandler(ctx, args.eventId)
});

async function sendEventPushesHandler(
	ctx: ActionCtx,
	eventId: GenericId<'chapterNotificationEvents'>
) {
	const event = await ctx.runQuery(internal.notifications.getEventForDelivery, { eventId });
	if (!event) {
		return { sent: false, reason: 'missing-event' as const };
	}

	const preferences = await ctx.runQuery(internal.notifications.getPreferencesForOwner, {
		ownerUserId: event.ownerUserId
	});
	if (!preferences.collectionNotificationsEnabled || !preferences.iosPwaPushEnabled) {
		await ctx.runMutation(internal.notifications.markEventDelivery, {
			eventId,
			status: 'ignored',
			delivered: false
		});
		return { sent: false, reason: 'preferences-disabled' as const };
	}

	const push = getPushConfiguration();
	if (!push.configured) {
		await ctx.runMutation(internal.notifications.markEventDelivery, {
			eventId,
			status: 'ignored',
			delivered: false
		});
		return { sent: false, reason: 'push-unconfigured' as const };
	}

	const subscriptions = await ctx.runQuery(internal.notifications.listActiveSubscriptionsForOwner, {
		ownerUserId: event.ownerUserId
	});
	if (subscriptions.length === 0) {
		await ctx.runMutation(internal.notifications.markEventDelivery, {
			eventId,
			status: 'ignored',
			delivered: false
		});
		return { sent: false, reason: 'no-subscriptions' as const };
	}

	const payload = await ctx.runQuery(internal.notifications.getPushPayloadForEvent, { eventId });
	if (!payload) {
		await ctx.runMutation(internal.notifications.markEventDelivery, {
			eventId,
			status: 'failed',
			delivered: false
		});
		return { sent: false, reason: 'payload-missing' as const };
	}

	webpush.setVapidDetails(push.subject, push.publicKey, push.privateKey);

	let successes = 0;
	let failures = 0;
	let lastErrorMessage: string | undefined;
	const revokedEndpoints: string[] = [];
	for (const subscription of subscriptions) {
		try {
			await webpush.sendNotification(
				{
					endpoint: subscription.endpoint,
					keys: {
						p256dh: subscription.p256dh,
						auth: subscription.auth
					}
				},
				JSON.stringify(payload)
			);
			successes += 1;
			await ctx.runMutation(internal.notifications.markSubscriptionPushSuccess, {
				subscriptionId: subscription._id
			});
		} catch (error) {
			failures += 1;
			lastErrorMessage = error instanceof Error ? error.message : String(error);
			const statusCode =
				typeof error === 'object' && error !== null && 'statusCode' in error
					? Number((error as { statusCode?: unknown }).statusCode)
					: NaN;
			if (statusCode === 404 || statusCode === 410) {
				revokedEndpoints.push(subscription.endpoint);
			}
			await ctx.runMutation(internal.notifications.markSubscriptionPushFailure, {
				subscriptionId: subscription._id,
				errorMessage: lastErrorMessage
			});
		}
	}

	const status = successes === 0 ? 'failed' : failures === 0 ? 'sent' : 'partial';
	await ctx.runMutation(internal.notifications.markEventDelivery, {
		eventId,
		status,
		lastErrorMessage,
		delivered: successes > 0,
		revokedEndpoints
	});
	return { sent: successes > 0, successes, failures };
}
