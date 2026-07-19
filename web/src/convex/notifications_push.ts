'use node';

import { createHash } from 'node:crypto';
import webpush from 'web-push';
import type { GenericId } from 'convex/values';
import { v } from 'convex/values';
import { makeFunctionReference } from 'convex/server';

import type { Doc } from './_generated/dataModel';
import { internalAction } from './_generated/server';

function getPushConfiguration() {
	const publicKey = (process.env.MANGARR_WEB_PUSH_VAPID_PUBLIC_KEY || '').trim();
	const privateKey = (process.env.MANGARR_WEB_PUSH_VAPID_PRIVATE_KEY || '').trim();
	const subject = (process.env.MANGARR_WEB_PUSH_SUBJECT || '').trim();
	return {
		publicKey,
		privateKey,
		subject,
		configured: Boolean(publicKey && privateKey && isValidVapidSubject(subject))
	};
}

function isValidVapidSubject(value: string) {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' || url.protocol === 'mailto:';
	} catch {
		return false;
	}
}

const SEND_DELIVERY = makeFunctionReference<
	'action',
	{ deliveryId: GenericId<'notificationDeliveries'> }
>('notifications_push:sendDelivery');
const BEGIN_DELIVERY_ATTEMPT = makeFunctionReference<
	'mutation',
	{ deliveryId: GenericId<'notificationDeliveries'> },
	{ started: true; attemptCount: number } | { started: false; reason: 'missing' | 'not-due' }
>('notifications:beginDeliveryAttempt');
const GET_DELIVERY_CONTEXT = makeFunctionReference<
	'query',
	{ deliveryId: GenericId<'notificationDeliveries'> },
	{
		delivery: Doc<'notificationDeliveries'>;
		event: Doc<'notificationEvents'>;
		device: Doc<'notificationDevices'>;
		preferences: {
			collectionNotificationsEnabled: boolean;
			webPushEnabled: boolean;
			privacyMode: 'detailed' | 'private';
		};
		unreadCount: number;
	} | null
>('notifications:getDeliveryContext');
type CompleteDeliveryArgs = {
	deliveryId: GenericId<'notificationDeliveries'>;
	attemptCount: number;
	outcome: 'accepted' | 'retry' | 'permanent_failed' | 'suppressed';
	providerStatusCode?: number;
	failureCode?: string;
	failureSummary?: string;
	retryAfterMs?: number;
	revokeDevice?: boolean;
	staleDevice?: boolean;
};
const COMPLETE_DELIVERY_ATTEMPT = makeFunctionReference<
	'mutation',
	CompleteDeliveryArgs,
	{ applied: boolean; status?: string }
>('notifications:completeDeliveryAttempt');
const LIST_RECOVERABLE_DELIVERIES = makeFunctionReference<
	'query',
	{ status: 'queued' | 'retry_wait' | 'sending'; limit: number },
	Doc<'notificationDeliveries'>[]
>('notifications:listRecoverableDeliveries');

const DELIVERY_TTL_SECONDS = 3 * 24 * 60 * 60;
const TEST_DELIVERY_MAX_AGE_MS = 10 * 60 * 1000;

function publicOriginFromPushSubject(subject: string) {
	for (const candidate of [process.env.MANGARR_PUBLIC_URL, subject]) {
		try {
			const url = new URL((candidate ?? '').trim());
			if (
				url.protocol !== 'https:' &&
				url.hostname !== 'localhost' &&
				url.hostname !== '127.0.0.1'
			) {
				continue;
			}
			url.pathname = '/';
			url.search = '';
			url.hash = '';
			return url.toString().replace(/\/$/, '');
		} catch {
			// Try the next configured value.
		}
	}
	throw new Error('Mangarr public origin is not configured for Web Push');
}

export function deliveryTopic(event: Pick<Doc<'notificationEvents'>, '_id' | 'libraryTitleId'>) {
	const replacementKey = event.libraryTitleId
		? `title:${String(event.libraryTitleId)}`
		: `event:${String(event._id)}`;
	return createHash('sha256').update(replacementKey).digest('base64url').slice(0, 32);
}

function parseRetryAfterMs(headers: Record<string, string | string[] | undefined> | undefined) {
	const raw = headers?.['retry-after'];
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

export type PushFailure = {
	outcome: 'retry' | 'permanent_failed';
	statusCode?: number;
	failureCode: string;
	failureSummary: string;
	retryAfterMs?: number;
	revokeDevice?: boolean;
	staleDevice?: boolean;
};

export function classifyPushFailure(error: unknown): PushFailure {
	const record =
		typeof error === 'object' && error !== null
			? (error as {
					statusCode?: unknown;
					headers?: Record<string, string | string[] | undefined>;
					code?: unknown;
				})
			: null;
	const statusCode = Number(record?.statusCode ?? NaN);
	if (statusCode === 404 || statusCode === 410) {
		return {
			outcome: 'permanent_failed' as const,
			statusCode,
			failureCode: 'subscription_gone',
			failureSummary: 'The browser push subscription no longer exists.',
			revokeDevice: true
		};
	}
	if (statusCode === 413) {
		return {
			outcome: 'permanent_failed' as const,
			statusCode,
			failureCode: 'payload_too_large',
			failureSummary: 'The notification payload exceeded the push provider limit.',
			revokeDevice: false
		};
	}
	if (statusCode === 400 || statusCode === 401 || statusCode === 403) {
		return {
			outcome: 'permanent_failed' as const,
			statusCode,
			failureCode: 'subscription_rejected',
			failureSummary: 'The push provider rejected the subscription or VAPID credentials.',
			revokeDevice: false,
			staleDevice: true
		};
	}
	if (statusCode === 429) {
		return {
			outcome: 'retry' as const,
			statusCode,
			failureCode: 'provider_rate_limited',
			failureSummary: 'The push provider asked Mangarr to retry later.',
			retryAfterMs: parseRetryAfterMs(record?.headers),
			revokeDevice: false,
			staleDevice: false
		};
	}
	if (statusCode >= 500) {
		return {
			outcome: 'retry' as const,
			statusCode,
			failureCode: 'provider_unavailable',
			failureSummary: 'The browser push provider is temporarily unavailable.',
			revokeDevice: false,
			staleDevice: false
		};
	}
	return {
		outcome: 'retry' as const,
		statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
		failureCode:
			typeof record?.code === 'string' ? `network_${record.code.toLowerCase()}` : 'network_error',
		failureSummary: 'Mangarr could not reach the browser push provider.',
		revokeDevice: false,
		staleDevice: false
	};
}

export const sendDelivery = internalAction({
	args: { deliveryId: v.id('notificationDeliveries') },
	handler: async (ctx, args) => {
		const started = await ctx.runMutation(BEGIN_DELIVERY_ATTEMPT, {
			deliveryId: args.deliveryId
		});
		if (!started.started) return { processed: false, reason: started.reason };

		const context = await ctx.runQuery(GET_DELIVERY_CONTEXT, {
			deliveryId: args.deliveryId
		});
		if (!context || context.device.state !== 'active' || context.device.revokedAt !== undefined) {
			await ctx.runMutation(COMPLETE_DELIVERY_ATTEMPT, {
				deliveryId: args.deliveryId,
				attemptCount: started.attemptCount,
				outcome: 'permanent_failed',
				failureCode: 'device_inactive',
				failureSummary: 'The target notification device is inactive.'
			});
			return { processed: true, accepted: false };
		}
		if (
			context.event.kind === 'test' &&
			context.event.createdAt < Date.now() - TEST_DELIVERY_MAX_AGE_MS
		) {
			await ctx.runMutation(COMPLETE_DELIVERY_ATTEMPT, {
				deliveryId: args.deliveryId,
				attemptCount: started.attemptCount,
				outcome: 'suppressed',
				failureCode: 'test_expired',
				failureSummary: 'The notification test expired before it could be delivered.'
			});
			return { processed: true, accepted: false, suppressed: true };
		}
		if (
			context.event.kind !== 'test' &&
			(!context.preferences.collectionNotificationsEnabled || !context.preferences.webPushEnabled)
		) {
			await ctx.runMutation(COMPLETE_DELIVERY_ATTEMPT, {
				deliveryId: args.deliveryId,
				attemptCount: started.attemptCount,
				outcome: 'suppressed',
				failureCode: 'disabled_by_preference',
				failureSummary: 'Web Push was disabled before this notification was sent.'
			});
			return { processed: true, accepted: false, suppressed: true };
		}

		const push = getPushConfiguration();
		if (!push.configured) {
			await ctx.runMutation(COMPLETE_DELIVERY_ATTEMPT, {
				deliveryId: args.deliveryId,
				attemptCount: started.attemptCount,
				outcome: 'permanent_failed',
				failureCode: 'push_unconfigured',
				failureSummary: 'Web Push is not configured on the Mangarr server.'
			});
			return { processed: true, accepted: false };
		}

		try {
			const origin = publicOriginFromPushSubject(push.subject);
			const navigateUrl = new URL(context.event.navigatePath, origin);
			navigateUrl.searchParams.set('notificationEventId', String(context.event._id));
			const iconUrl = new URL('/icon-192.png', origin).toString();
			const badgeUrl = new URL('/favicon-32.png', origin).toString();
			const appBadge = String(Math.max(1, context.unreadCount));
			const privatePreview =
				context.event.kind !== 'test' && context.preferences.privacyMode === 'private';
			const payload = {
				web_push: 8030,
				app_badge: appBadge,
				notification: {
					title: privatePreview ? 'Mangarr' : context.event.title,
					body: privatePreview
						? `${context.event.newChapterCount} new chapter${context.event.newChapterCount === 1 ? '' : 's'} available`
						: context.event.body,
					navigate: navigateUrl.toString(),
					silent: false,
					tag: context.event.libraryTitleId
						? `mangarr-title-${String(context.event.libraryTitleId)}`
						: `mangarr-event-${String(context.event._id)}`,
					renotify: true,
					icon: iconUrl,
					badge: badgeUrl,
					app_badge: appBadge,
					data: {
						kind: context.event.kind,
						eventId: String(context.event._id),
						deliveryId: String(context.delivery._id),
						receiptToken: context.delivery.receiptToken,
						path: `${navigateUrl.pathname}${navigateUrl.search}${navigateUrl.hash}`
					}
				}
			};
			const serialized = JSON.stringify(payload);
			if (Buffer.byteLength(serialized, 'utf8') > 3500) {
				throw Object.assign(new Error('Notification payload exceeds the safe Web Push budget'), {
					statusCode: 413
				});
			}

			webpush.setVapidDetails(push.subject, push.publicKey, push.privateKey);
			const response = await webpush.sendNotification(
				{
					endpoint: context.device.endpoint,
					keys: { p256dh: context.device.p256dh, auth: context.device.auth }
				},
				serialized,
				{
					TTL: DELIVERY_TTL_SECONDS,
					urgency: 'normal',
					topic: deliveryTopic(context.event)
				}
			);
			await ctx.runMutation(COMPLETE_DELIVERY_ATTEMPT, {
				deliveryId: args.deliveryId,
				attemptCount: started.attemptCount,
				outcome: 'accepted',
				providerStatusCode: response.statusCode
			});
			return { processed: true, accepted: true };
		} catch (error) {
			const failure = classifyPushFailure(error);
			await ctx.runMutation(COMPLETE_DELIVERY_ATTEMPT, {
				deliveryId: args.deliveryId,
				attemptCount: started.attemptCount,
				outcome: failure.outcome,
				providerStatusCode: failure.statusCode,
				failureCode: failure.failureCode,
				failureSummary: failure.failureSummary,
				retryAfterMs: failure.retryAfterMs,
				revokeDevice: failure.revokeDevice,
				staleDevice: failure.staleDevice
			});
			return { processed: true, accepted: false, failureCode: failure.failureCode };
		}
	}
});

export const recoverDeliveries = internalAction({
	args: { limit: v.optional(v.float64()) },
	handler: async (ctx, args) => {
		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 50), 100));
		let scheduled = 0;
		for (const status of ['queued', 'retry_wait', 'sending'] as const) {
			if (scheduled >= limit) break;
			const rows = await ctx.runQuery(LIST_RECOVERABLE_DELIVERIES, {
				status,
				limit: limit - scheduled
			});
			for (const row of rows) {
				await ctx.scheduler.runAfter(0, SEND_DELIVERY, {
					deliveryId: row._id
				});
				scheduled += 1;
			}
		}
		return { scheduled };
	}
});
