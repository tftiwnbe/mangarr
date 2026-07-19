import type { GenericId } from 'convex/values';
import { v } from 'convex/values';
import { makeFunctionReference } from 'convex/server';

import {
	internalMutation,
	internalQuery,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import { chapterGroupKeyForRow } from './chapter_groups';
import { resolveOwnerTitleRouteSegment } from './library_reader_support';
import { requireViewerUserId } from './library_shared_access';

const DEFAULT_PREFERENCES: NotificationPreferences = {
	collectionNotificationsEnabled: true,
	iosPwaPushEnabled: true,
	foregroundNotificationsEnabled: true,
	webPushEnabled: true,
	privacyMode: 'detailed'
};

const EVENT_RETRY_STATUSES = ['pending', 'partial', 'failed'] as const;
const FALLBACK_COVER = '/favicon.svg';
const COVER_PROXY_PATH = '/api/covers/proxy';
const PUSH_STATUS = {
	PENDING: 'pending',
	SENDING: 'sending',
	SENT: 'sent',
	PARTIAL: 'partial',
	FAILED: 'failed',
	IGNORED: 'ignored'
} as const;

const SEND_DELIVERY = makeFunctionReference<
	'action',
	{ deliveryId: GenericId<'notificationDeliveries'> }
>('notifications_push:sendDelivery');

type NotificationPreferences = {
	collectionNotificationsEnabled: boolean;
	iosPwaPushEnabled: boolean;
	foregroundNotificationsEnabled: boolean;
	webPushEnabled: boolean;
	privacyMode: 'detailed' | 'private';
};

type PushPayload = {
	web_push: 8030;
	notification: {
		title: string;
		body: string;
		navigate: string;
		silent: false;
		tag: string;
		icon?: string;
		badge?: string;
		app_badge?: string;
		data: {
			kind: 'title-update';
			titleId: string;
			eventId: string;
			path: string;
		};
	};
};

export function getPushConfiguration() {
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

async function loadNotificationPreferences(
	ctx: QueryCtx | MutationCtx,
	ownerUserId: GenericId<'users'>
): Promise<NotificationPreferences> {
	const row = await ctx.db
		.query('notificationPreferences')
		.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
		.unique();
	return {
		collectionNotificationsEnabled:
			row?.collectionNotificationsEnabled ?? DEFAULT_PREFERENCES.collectionNotificationsEnabled,
		iosPwaPushEnabled: row?.iosPwaPushEnabled ?? DEFAULT_PREFERENCES.iosPwaPushEnabled,
		foregroundNotificationsEnabled:
			row?.foregroundNotificationsEnabled ?? DEFAULT_PREFERENCES.foregroundNotificationsEnabled,
		webPushEnabled:
			row?.webPushEnabled ?? row?.iosPwaPushEnabled ?? DEFAULT_PREFERENCES.webPushEnabled,
		privacyMode: row?.privacyMode ?? DEFAULT_PREFERENCES.privacyMode
	};
}

function stableHash(value: string) {
	let left = 0x811c9dc5;
	let right = 0x9e3779b9;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		left = Math.imul(left ^ code, 0x01000193) >>> 0;
		right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
	}
	return `${left.toString(36)}${right.toString(36)}`;
}

function createReceiptToken() {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function buildDeviceDisplayName(platform?: string, userAgent?: string) {
	const normalizedPlatform = platform?.trim();
	if (normalizedPlatform) return normalizedPlatform.slice(0, 80);
	const agent = userAgent?.trim() ?? '';
	if (/android/i.test(agent)) return 'Android device';
	if (/iphone|ipad|ipod/i.test(agent)) return 'iPhone or iPad';
	if (/windows/i.test(agent)) return 'Windows browser';
	if (/macintosh|mac os/i.test(agent)) return 'Mac browser';
	if (/linux/i.test(agent)) return 'Linux browser';
	return 'Browser device';
}

async function loadActiveSubscriptions(
	ctx: QueryCtx | MutationCtx,
	ownerUserId: GenericId<'users'>
) {
	const rows = await ctx.db
		.query('webPushSubscriptions')
		.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
		.collect();
	return rows.filter((row) => row.revokedAt === undefined);
}

function buildNotificationBody(newChapterCount: number) {
	return `${newChapterCount} new chapter${newChapterCount === 1 ? '' : 's'}`;
}

function toNotificationCoverUrl(url: string | null | undefined): string {
	const trimmed = (url ?? '').trim();
	if (!trimmed) {
		return FALLBACK_COVER;
	}
	if (
		trimmed.startsWith(COVER_PROXY_PATH) ||
		trimmed.startsWith('/') ||
		trimmed.startsWith('data:')
	) {
		return trimmed;
	}
	if (/^https?:\/\//i.test(trimmed)) {
		const params = new URLSearchParams({ url: trimmed });
		return `${COVER_PROXY_PATH}?${params.toString()}`;
	}
	return trimmed;
}

export function buildNotificationEventDedupeKey(args: {
	ownerUserId: GenericId<'users'>;
	libraryTitleId: GenericId<'libraryTitles'>;
	chapterIds: GenericId<'libraryChapters'>[];
}) {
	const sortedChapterIds = [...args.chapterIds].map(String).sort().join(',');
	return `collection-chapters:${String(args.ownerUserId)}:${String(args.libraryTitleId)}:${sortedChapterIds}`;
}

async function listTrackedCollectionIds(
	ctx: QueryCtx | MutationCtx,
	args: {
		ownerUserId: GenericId<'users'>;
		libraryTitleId: GenericId<'libraryTitles'>;
	}
) {
	const rows = await ctx.db
		.query('libraryCollectionTitles')
		.withIndex('by_owner_user_id_library_title_id', (q) =>
			q.eq('ownerUserId', args.ownerUserId).eq('libraryTitleId', args.libraryTitleId)
		)
		.collect();
	const trackedCollectionIds: GenericId<'libraryCollections'>[] = [];
	for (const row of rows) {
		const collection = await ctx.db.get(row.collectionId);
		if (!collection || collection.ownerUserId !== args.ownerUserId) continue;
		if (collection.notifyOnNewChapters === true) {
			trackedCollectionIds.push(collection._id);
		}
	}
	return trackedCollectionIds;
}

async function buildTitlePath(
	ctx: QueryCtx | MutationCtx,
	title: {
		_id: GenericId<'libraryTitles'>;
		ownerUserId: GenericId<'users'>;
		title: string;
		titleUrl?: string | null;
		routeBase?: string | null;
	}
) {
	const routeSegment = await resolveOwnerTitleRouteSegment(ctx as QueryCtx, title);
	return `/title/${routeSegment}`;
}

async function buildPushPayload(
	ctx: QueryCtx | MutationCtx,
	event: {
		_id: GenericId<'chapterNotificationEvents'>;
		ownerUserId: GenericId<'users'>;
		libraryTitleId: GenericId<'libraryTitles'>;
		titleName: string;
		latestChapterName: string;
		newChapterCount: number;
		coverUrl?: string;
	}
): Promise<PushPayload | null> {
	const title = await ctx.db.get(event.libraryTitleId);
	if (!title || title.ownerUserId !== event.ownerUserId) {
		return null;
	}
	const path = await buildTitlePath(ctx, title);
	const unacknowledged = await listPendingEventsCore(ctx, event.ownerUserId, 1);
	return {
		web_push: 8030,
		notification: {
			title: event.titleName,
			body: buildNotificationBody(event.newChapterCount),
			navigate: path,
			silent: false,
			tag: `title:${String(event.libraryTitleId)}`,
			icon: toNotificationCoverUrl(event.coverUrl),
			badge: '/icon-192.png',
			app_badge: String(Math.max(1, unacknowledged.totalCount)),
			data: {
				kind: 'title-update',
				titleId: String(event.libraryTitleId),
				eventId: String(event._id),
				path
			}
		}
	};
}

async function listPendingEventsCore(
	ctx: QueryCtx | MutationCtx,
	ownerUserId: GenericId<'users'>,
	limit: number
) {
	const rows = await ctx.db
		.query('chapterNotificationEvents')
		.withIndex('by_owner_user_id_created_at', (q) => q.eq('ownerUserId', ownerUserId))
		.order('desc')
		.collect();
	const unacknowledged = rows.filter((row) => row.acknowledgedAt === undefined);
	const items = [];
	for (const row of unacknowledged.slice(0, limit)) {
		const title = await ctx.db.get(row.libraryTitleId);
		if (!title || title.ownerUserId !== ownerUserId) continue;
		const path = await buildTitlePath(ctx, title);
		items.push({
			id: row._id,
			titleId: row.libraryTitleId,
			titleName: row.titleName,
			latestChapterName: row.latestChapterName,
			newChapterCount: row.newChapterCount,
			path,
			icon: toNotificationCoverUrl(row.coverUrl),
			tag: `title:${String(row.libraryTitleId)}`,
			status: row.status,
			lastDeliveredAt: row.lastDeliveredAt ?? null,
			createdAt: row.createdAt
		});
	}
	return {
		items,
		totalCount: unacknowledged.length
	};
}

export async function createNotificationEventForNewChapters(
	ctx: MutationCtx,
	args: {
		ownerUserId: GenericId<'users'>;
		libraryTitleId: GenericId<'libraryTitles'>;
		newChapterIds: GenericId<'libraryChapters'>[];
		latestChapterName: string;
		now: number;
		suppressInitial?: boolean;
	}
) {
	const preferences = await loadNotificationPreferences(ctx, args.ownerUserId);
	if (!preferences.collectionNotificationsEnabled) {
		return { created: false, reason: 'preferences-disabled' as const };
	}

	const downloadProfile = await ctx.db
		.query('downloadProfiles')
		.withIndex('by_owner_user_id_library_title_id', (q) =>
			q.eq('ownerUserId', args.ownerUserId).eq('libraryTitleId', args.libraryTitleId)
		)
		.unique();
	if (!downloadProfile || !downloadProfile.enabled || downloadProfile.paused) {
		return { created: false, reason: 'monitor-disabled' as const };
	}

	const trackedCollectionIds = await listTrackedCollectionIds(ctx, {
		ownerUserId: args.ownerUserId,
		libraryTitleId: args.libraryTitleId
	});
	if (trackedCollectionIds.length === 0) {
		return { created: false, reason: 'no-tracked-collections' as const };
	}

	const title = await ctx.db.get(args.libraryTitleId);
	if (!title || title.ownerUserId !== args.ownerUserId) {
		return { created: false, reason: 'title-not-found' as const };
	}

	const candidateGroupKeys = new Set<string>();
	for (const chapterId of args.newChapterIds) {
		const chapter = await ctx.db.get(chapterId);
		if (!chapter || chapter.ownerUserId !== args.ownerUserId) continue;
		candidateGroupKeys.add(chapterGroupKeyForRow(chapter));
	}

	const newGroupKeys: string[] = [];
	for (const chapterGroupKey of [...candidateGroupKeys].sort()) {
		const markerKey = `chapter-notification:${String(args.ownerUserId)}:${String(args.libraryTitleId)}:${chapterGroupKey}`;
		const marker = await ctx.db
			.query('notificationChapterMarkers')
			.withIndex('by_dedupe_key', (q) => q.eq('dedupeKey', markerKey))
			.unique();
		if (marker) continue;
		await ctx.db.insert('notificationChapterMarkers', {
			ownerUserId: args.ownerUserId,
			libraryTitleId: args.libraryTitleId,
			chapterGroupKey,
			dedupeKey: markerKey,
			createdAt: args.now
		});
		newGroupKeys.push(chapterGroupKey);
	}

	if (newGroupKeys.length === 0) {
		return { created: false, reason: 'duplicate' as const };
	}
	if (args.suppressInitial) {
		return { created: false, reason: 'baseline-established' as const };
	}

	const aggregateKey = `new-chapters:${String(args.ownerUserId)}:${String(args.libraryTitleId)}:${stableHash(newGroupKeys.join('|'))}`;
	const existing = await ctx.db
		.query('notificationEvents')
		.withIndex('by_aggregate_key', (q) => q.eq('aggregateKey', aggregateKey))
		.unique();
	if (existing) {
		return { created: false, reason: 'duplicate' as const, eventId: existing._id };
	}

	const navigatePath = await buildTitlePath(ctx, title);
	const eventTitle = preferences.privacyMode === 'private' ? 'Mangarr' : title.title;
	const eventBody =
		preferences.privacyMode === 'private'
			? `${newGroupKeys.length} new chapter${newGroupKeys.length === 1 ? '' : 's'} available`
			: `${newGroupKeys.length} new chapter${newGroupKeys.length === 1 ? '' : 's'} · ${args.latestChapterName}`;
	const eventId = await ctx.db.insert('notificationEvents', {
		ownerUserId: args.ownerUserId,
		kind: 'new_chapters',
		libraryTitleId: args.libraryTitleId,
		collectionIds: trackedCollectionIds,
		chapterGroupKeys: newGroupKeys,
		newChapterCount: newGroupKeys.length,
		title: eventTitle,
		body: eventBody,
		navigatePath,
		aggregateKey,
		createdAt: args.now,
		updatedAt: args.now
	});

	let deliveryCount = 0;
	if (preferences.webPushEnabled) {
		const devices = await ctx.db
			.query('notificationDevices')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', args.ownerUserId))
			.collect();
		for (const device of devices) {
			if (device.state !== 'active' || device.revokedAt !== undefined) continue;
			const deliveryDedupeKey = `web-push:${String(eventId)}:${String(device._id)}`;
			const receiptToken = createReceiptToken();
			const deliveryId = await ctx.db.insert('notificationDeliveries', {
				ownerUserId: args.ownerUserId,
				eventId,
				deviceId: device._id,
				channel: 'web_push',
				dedupeKey: deliveryDedupeKey,
				status: 'queued',
				attemptCount: 0,
				nextAttemptAt: args.now,
				receiptToken,
				receiptTokenHash: stableHash(receiptToken),
				createdAt: args.now,
				updatedAt: args.now
			});
			await ctx.scheduler.runAfter(0, SEND_DELIVERY, { deliveryId });
			deliveryCount += 1;
		}
	}

	return { created: true, eventId, deliveryCount };
}

export const getPreferences = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return { ...DEFAULT_PREFERENCES };
		}
		return loadNotificationPreferences(ctx, identity.subject as GenericId<'users'>);
	}
});

export const updatePreferences = mutation({
	args: {
		collectionNotificationsEnabled: v.optional(v.boolean()),
		iosPwaPushEnabled: v.optional(v.boolean()),
		foregroundNotificationsEnabled: v.optional(v.boolean()),
		webPushEnabled: v.optional(v.boolean()),
		privacyMode: v.optional(v.union(v.literal('detailed'), v.literal('private')))
	},
	handler: async (ctx, args) => {
		const ownerUserId = await requireViewerUserId(ctx);
		const existing = await ctx.db
			.query('notificationPreferences')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
			.unique();
		const current = existing
			? {
					collectionNotificationsEnabled: existing.collectionNotificationsEnabled,
					iosPwaPushEnabled: existing.iosPwaPushEnabled,
					foregroundNotificationsEnabled: existing.foregroundNotificationsEnabled,
					webPushEnabled: existing.webPushEnabled ?? existing.iosPwaPushEnabled,
					privacyMode: existing.privacyMode ?? ('detailed' as const)
				}
			: DEFAULT_PREFERENCES;
		const next = {
			collectionNotificationsEnabled:
				args.collectionNotificationsEnabled ?? current.collectionNotificationsEnabled,
			iosPwaPushEnabled: args.iosPwaPushEnabled ?? current.iosPwaPushEnabled,
			foregroundNotificationsEnabled:
				args.foregroundNotificationsEnabled ?? current.foregroundNotificationsEnabled,
			webPushEnabled: args.webPushEnabled ?? args.iosPwaPushEnabled ?? current.webPushEnabled,
			privacyMode: args.privacyMode ?? current.privacyMode
		};
		const now = Date.now();
		if (existing) {
			await ctx.db.patch(existing._id, {
				...next,
				updatedAt: now
			});
		} else {
			await ctx.db.insert('notificationPreferences', {
				ownerUserId,
				...next,
				createdAt: now,
				updatedAt: now
			});
		}
		return next;
	}
});

export const listStatus = query({
	args: {
		installationKey: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return {
				...DEFAULT_PREFERENCES,
				backgroundPushConfigured: false,
				vapidPublicKey: null,
				activeSubscriptionCount: 0,
				hasActiveSubscription: false,
				hasActiveSubscriptionOnThisDevice: false
			};
		}
		const ownerUserId = identity.subject as GenericId<'users'>;
		const preferences = await loadNotificationPreferences(ctx, ownerUserId);
		const activeSubscriptions = await loadActiveSubscriptions(ctx, ownerUserId);
		const push = getPushConfiguration();
		const installationKey = args.installationKey?.trim();
		return {
			...preferences,
			backgroundPushConfigured: push.configured,
			vapidPublicKey: push.publicKey || null,
			activeSubscriptionCount: activeSubscriptions.length,
			hasActiveSubscription: activeSubscriptions.length > 0,
			hasActiveSubscriptionOnThisDevice:
				installationKey !== undefined && installationKey.length > 0
					? activeSubscriptions.some(
							(subscription) => subscription.installationKey === installationKey
						)
					: false
		};
	}
});

export const subscribeWebPush = mutation({
	args: {
		endpoint: v.string(),
		p256dh: v.string(),
		auth: v.string(),
		userAgent: v.optional(v.string()),
		platform: v.optional(v.string()),
		installationKey: v.string(),
		supportsBadging: v.boolean()
	},
	handler: async (ctx, args) => {
		const ownerUserId = await requireViewerUserId(ctx);
		const existingRows = await ctx.db
			.query('webPushSubscriptions')
			.withIndex('by_owner_user_id_endpoint', (q) =>
				q.eq('ownerUserId', ownerUserId).eq('endpoint', args.endpoint.trim())
			)
			.collect();
		const activeRow =
			existingRows.find((row) => row.revokedAt === undefined) ?? existingRows[0] ?? null;
		const now = Date.now();
		const patch = {
			p256dh: args.p256dh.trim(),
			auth: args.auth.trim(),
			userAgent: args.userAgent?.trim() || undefined,
			platform: args.platform?.trim() || undefined,
			installationKey: args.installationKey.trim(),
			supportsBadging: args.supportsBadging,
			lastSeenAt: now,
			lastErrorMessage: undefined,
			revokedAt: undefined,
			updatedAt: now
		};
		if (activeRow) {
			await ctx.db.patch(activeRow._id, patch);
			return { subscribed: true, subscriptionId: activeRow._id };
		}
		const subscriptionId = await ctx.db.insert('webPushSubscriptions', {
			ownerUserId,
			endpoint: args.endpoint.trim(),
			...patch,
			createdAt: now
		});
		return { subscribed: true, subscriptionId };
	}
});

export const unsubscribeWebPush = mutation({
	args: {
		endpoint: v.string()
	},
	handler: async (ctx, args) => {
		const ownerUserId = await requireViewerUserId(ctx);
		const rows = await ctx.db
			.query('webPushSubscriptions')
			.withIndex('by_owner_user_id_endpoint', (q) =>
				q.eq('ownerUserId', ownerUserId).eq('endpoint', args.endpoint.trim())
			)
			.collect();
		const now = Date.now();
		for (const row of rows) {
			if (row.revokedAt !== undefined) continue;
			await ctx.db.patch(row._id, {
				revokedAt: now,
				updatedAt: now
			});
		}
		return { unsubscribed: true };
	}
});

export const listPendingEvents = query({
	args: {
		limit: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return { items: [], totalCount: 0 };
		}
		return listPendingEventsCore(
			ctx,
			identity.subject as GenericId<'users'>,
			Math.max(1, Math.min(Math.floor(args.limit ?? 20), 100))
		);
	}
});

export const acknowledgeEvent = mutation({
	args: {
		eventId: v.id('chapterNotificationEvents')
	},
	handler: async (ctx, args) => {
		const ownerUserId = await requireViewerUserId(ctx);
		const event = await ctx.db.get(args.eventId);
		if (!event || event.ownerUserId !== ownerUserId) {
			throw new Error('Notification event not found');
		}
		const now = Date.now();
		await ctx.db.patch(event._id, {
			acknowledgedAt: event.acknowledgedAt ?? now,
			lastDeliveredAt: event.lastDeliveredAt ?? now,
			updatedAt: now
		});
		return { acknowledged: true };
	}
});

export const markEventDelivery = internalMutation({
	args: {
		eventId: v.id('chapterNotificationEvents'),
		status: v.union(
			v.literal('sent'),
			v.literal('partial'),
			v.literal('failed'),
			v.literal('ignored')
		),
		lastErrorMessage: v.optional(v.string()),
		delivered: v.boolean(),
		revokedEndpoints: v.optional(v.array(v.string()))
	},
	handler: async (ctx, args) => {
		const event = await ctx.db.get(args.eventId);
		if (!event) {
			return { ok: false };
		}
		const now = Date.now();
		await ctx.db.patch(event._id, {
			status: args.status,
			attemptCount: event.attemptCount + 1,
			lastAttemptAt: now,
			lastDeliveredAt: args.delivered ? (event.lastDeliveredAt ?? now) : event.lastDeliveredAt,
			updatedAt: now
		});
		if ((args.revokedEndpoints?.length ?? 0) > 0) {
			const activeSubscriptions = await loadActiveSubscriptions(ctx, event.ownerUserId);
			for (const subscription of activeSubscriptions) {
				if (!args.revokedEndpoints?.includes(subscription.endpoint)) continue;
				await ctx.db.patch(subscription._id, {
					revokedAt: now,
					lastPushFailedAt: now,
					lastErrorMessage: args.lastErrorMessage,
					updatedAt: now
				});
			}
		}
		return { ok: true };
	}
});

export const markEventSending = internalMutation({
	args: {
		eventId: v.id('chapterNotificationEvents')
	},
	handler: async (ctx, args) => {
		const event = await ctx.db.get(args.eventId);
		if (
			!event ||
			!EVENT_RETRY_STATUSES.includes(event.status as (typeof EVENT_RETRY_STATUSES)[number])
		) {
			return { queued: false };
		}
		await ctx.db.patch(event._id, {
			status: PUSH_STATUS.SENDING,
			updatedAt: Date.now()
		});
		return { queued: true };
	}
});

export const listEventBatchByStatus = internalQuery({
	args: {
		status: v.union(v.literal('pending'), v.literal('partial'), v.literal('failed')),
		limit: v.float64()
	},
	handler: async (ctx, args) =>
		ctx.db
			.query('chapterNotificationEvents')
			.withIndex('by_status_created_at', (q) => q.eq('status', args.status))
			.order('asc')
			.take(Math.max(1, Math.min(Math.floor(args.limit), 50)))
});

export const getEventForDelivery = internalQuery({
	args: {
		eventId: v.id('chapterNotificationEvents')
	},
	handler: (ctx, args) => ctx.db.get(args.eventId)
});

export const getPreferencesForOwner = internalQuery({
	args: {
		ownerUserId: v.id('users')
	},
	handler: (ctx, args) => loadNotificationPreferences(ctx, args.ownerUserId)
});

export const listActiveSubscriptionsForOwner = internalQuery({
	args: {
		ownerUserId: v.id('users')
	},
	handler: (ctx, args) => loadActiveSubscriptions(ctx, args.ownerUserId)
});

export const getPushPayloadForEvent = internalQuery({
	args: {
		eventId: v.id('chapterNotificationEvents')
	},
	handler: async (ctx, args) => {
		const event = await ctx.db.get(args.eventId);
		if (!event) return null;
		return buildPushPayload(ctx, event);
	}
});

export const markSubscriptionPushSuccess = internalMutation({
	args: {
		subscriptionId: v.id('webPushSubscriptions')
	},
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.subscriptionId);
		if (!row) return { ok: false };
		const now = Date.now();
		await ctx.db.patch(row._id, {
			lastPushSucceededAt: now,
			lastErrorMessage: undefined,
			updatedAt: now
		});
		return { ok: true };
	}
});

export const markSubscriptionPushFailure = internalMutation({
	args: {
		subscriptionId: v.id('webPushSubscriptions'),
		errorMessage: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.subscriptionId);
		if (!row) return { ok: false };
		const now = Date.now();
		await ctx.db.patch(row._id, {
			lastPushFailedAt: now,
			lastErrorMessage: args.errorMessage,
			updatedAt: now
		});
		return { ok: true };
	}
});

function validateSubscriptionEndpoint(endpoint: string) {
	const trimmed = endpoint.trim();
	if (trimmed.length === 0 || trimmed.length > 4096) {
		throw new Error('Push subscription endpoint is invalid');
	}
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error('Push subscription endpoint is invalid');
	}
	if (url.protocol !== 'https:') {
		throw new Error('Push subscription endpoint must use HTTPS');
	}
	const hostname = url.hostname.toLowerCase();
	if (
		hostname === 'localhost' ||
		hostname === '::1' ||
		/^127\./.test(hostname) ||
		/^10\./.test(hostname) ||
		/^192\.168\./.test(hostname) ||
		/^169\.254\./.test(hostname) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
	) {
		throw new Error('Push subscription endpoint must be publicly routable');
	}
	return trimmed;
}

async function insertDeliveryForDevice(
	ctx: MutationCtx,
	args: {
		ownerUserId: GenericId<'users'>;
		eventId: GenericId<'notificationEvents'>;
		deviceId: GenericId<'notificationDevices'>;
		now: number;
		delayMs?: number;
	}
) {
	const dedupeKey = `web-push:${String(args.eventId)}:${String(args.deviceId)}`;
	const existing = await ctx.db
		.query('notificationDeliveries')
		.withIndex('by_dedupe_key', (q) => q.eq('dedupeKey', dedupeKey))
		.unique();
	if (existing) return existing._id;

	const receiptToken = createReceiptToken();
	const delayMs = Math.max(0, Math.min(Math.floor(args.delayMs ?? 0), 60_000));
	const deliveryId = await ctx.db.insert('notificationDeliveries', {
		ownerUserId: args.ownerUserId,
		eventId: args.eventId,
		deviceId: args.deviceId,
		channel: 'web_push',
		dedupeKey,
		status: 'queued',
		attemptCount: 0,
		nextAttemptAt: args.now + delayMs,
		receiptToken,
		receiptTokenHash: stableHash(receiptToken),
		createdAt: args.now,
		updatedAt: args.now
	});
	await ctx.scheduler.runAfter(delayMs, SEND_DELIVERY, { deliveryId });
	return deliveryId;
}

export const getOverview = query({
	args: {
		installationId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const ownerUserId = identity.subject as GenericId<'users'>;
		const preferences = await loadNotificationPreferences(ctx, ownerUserId);
		const devices = await ctx.db
			.query('notificationDevices')
			.withIndex('by_owner_user_id', (q) => q.eq('ownerUserId', ownerUserId))
			.collect();
		const activeDevices = devices.filter(
			(device) => device.state === 'active' && device.revokedAt === undefined
		);
		const installationId = args.installationId?.trim();
		const currentDevice = installationId
			? activeDevices.find((device) => device.installationId === installationId)
			: undefined;
		const latestDelivery = currentDevice
			? await ctx.db
					.query('notificationDeliveries')
					.withIndex('by_device_id_created_at', (q) => q.eq('deviceId', currentDevice._id))
					.order('desc')
					.first()
			: null;
		const unread = await ctx.db
			.query('notificationEvents')
			.withIndex('by_owner_user_id_read_at_created_at', (q) =>
				q.eq('ownerUserId', ownerUserId).eq('readAt', undefined)
			)
			.order('desc')
			.take(1000);
		const push = getPushConfiguration();
		return {
			preferences,
			backgroundPushConfigured: push.configured,
			vapidPublicKey: push.publicKey || null,
			vapidKeyId: push.publicKey ? stableHash(push.publicKey) : null,
			unreadCount: unread.length,
			currentDevice: currentDevice
				? {
						id: currentDevice._id,
						displayName: currentDevice.displayName,
						state: currentDevice.state,
						vapidKeyId: currentDevice.vapidKeyId,
						lastSeenAt: currentDevice.lastSeenAt,
						lastAcceptedAt: currentDevice.lastAcceptedAt ?? null,
						lastFailureAt: currentDevice.lastFailureAt ?? null,
						lastFailureCode: currentDevice.lastFailureCode ?? null,
						consecutiveFailures: currentDevice.consecutiveFailures
					}
				: null,
			latestDelivery: latestDelivery
				? {
						id: latestDelivery._id,
						status: latestDelivery.status,
						attemptCount: latestDelivery.attemptCount,
						providerStatusCode: latestDelivery.providerStatusCode ?? null,
						failureCode: latestDelivery.failureCode ?? null,
						failureSummary: latestDelivery.failureSummary ?? null,
						acceptedAt: latestDelivery.acceptedAt ?? null,
						receivedAt: latestDelivery.receivedAt ?? null,
						displayedAt: latestDelivery.displayedAt ?? null,
						clickedAt: latestDelivery.clickedAt ?? null,
						createdAt: latestDelivery.createdAt
					}
				: null,
			devices: devices
				.sort((left, right) => right.lastSeenAt - left.lastSeenAt)
				.map((device) => ({
					id: device._id,
					installationId: device.installationId,
					displayName: device.displayName,
					platform: device.platform ?? null,
					state: device.state,
					lastSeenAt: device.lastSeenAt,
					lastAcceptedAt: device.lastAcceptedAt ?? null,
					lastFailureAt: device.lastFailureAt ?? null,
					lastFailureCode: device.lastFailureCode ?? null,
					consecutiveFailures: device.consecutiveFailures,
					revokedAt: device.revokedAt ?? null
				}))
		};
	}
});

export const reconcileDevice = mutation({
	args: {
		installationId: v.string(),
		endpoint: v.string(),
		p256dh: v.string(),
		auth: v.string(),
		vapidKeyId: v.string(),
		expirationTime: v.optional(v.float64()),
		displayName: v.optional(v.string()),
		userAgent: v.optional(v.string()),
		platform: v.optional(v.string()),
		supportsBadging: v.boolean(),
		allowReactivate: v.boolean()
	},
	handler: async (ctx, args) => {
		const ownerUserId = await requireViewerUserId(ctx);
		const installationId = args.installationId.trim();
		if (installationId.length < 8 || installationId.length > 200) {
			throw new Error('Notification installation identifier is invalid');
		}
		const endpoint = validateSubscriptionEndpoint(args.endpoint);
		if (!args.p256dh.trim() || !args.auth.trim()) {
			throw new Error('Push subscription is missing encryption keys');
		}
		const push = getPushConfiguration();
		const currentVapidKeyId = push.publicKey ? stableHash(push.publicKey) : '';
		if (!currentVapidKeyId || args.vapidKeyId !== currentVapidKeyId) {
			throw new Error('Push subscription uses an outdated server key');
		}

		const now = Date.now();
		const endpointHash = stableHash(endpoint);
		const endpointRows = await ctx.db
			.query('notificationDevices')
			.withIndex('by_endpoint_hash', (q) => q.eq('endpointHash', endpointHash))
			.collect();
		for (const row of endpointRows) {
			if (row.endpoint !== endpoint) continue;
			if (row.ownerUserId === ownerUserId && row.installationId === installationId) continue;
			if (row.state === 'revoked') continue;
			await ctx.db.patch(row._id, { state: 'revoked', revokedAt: now, updatedAt: now });
		}

		const existing = await ctx.db
			.query('notificationDevices')
			.withIndex('by_owner_user_id_installation_id', (q) =>
				q.eq('ownerUserId', ownerUserId).eq('installationId', installationId)
			)
			.unique();
		if (existing?.state === 'revoked' && !args.allowReactivate) {
			return { deviceId: existing._id, reconciled: false, disabled: true };
		}
		const patch = {
			displayName:
				args.displayName?.trim().slice(0, 80) ||
				buildDeviceDisplayName(args.platform, args.userAgent),
			platform: args.platform?.trim().slice(0, 120) || undefined,
			userAgent: args.userAgent?.trim().slice(0, 500) || undefined,
			endpoint,
			endpointHash,
			p256dh: args.p256dh.trim(),
			auth: args.auth.trim(),
			vapidKeyId: currentVapidKeyId,
			expirationTime: args.expirationTime,
			supportsBadging: args.supportsBadging,
			state: 'active' as const,
			lastSeenAt: now,
			lastReconciledAt: now,
			lastFailureCode: undefined,
			consecutiveFailures: 0,
			revokedAt: undefined,
			updatedAt: now
		};
		if (existing) {
			await ctx.db.patch(existing._id, patch);
			return { deviceId: existing._id, reconciled: true };
		}
		const deviceId = await ctx.db.insert('notificationDevices', {
			ownerUserId,
			installationId,
			...patch,
			createdAt: now
		});
		return { deviceId, reconciled: true };
	}
});

export const revokeDevice = mutation({
	args: { installationId: v.string() },
	handler: async (ctx, args) => {
		const ownerUserId = await requireViewerUserId(ctx);
		const device = await ctx.db
			.query('notificationDevices')
			.withIndex('by_owner_user_id_installation_id', (q) =>
				q.eq('ownerUserId', ownerUserId).eq('installationId', args.installationId.trim())
			)
			.unique();
		if (!device) return { revoked: false };
		const now = Date.now();
		await ctx.db.patch(device._id, { state: 'revoked', revokedAt: now, updatedAt: now });
		return { revoked: true };
	}
});

export const revokeDeviceById = mutation({
	args: { deviceId: v.id('notificationDevices') },
	handler: async (ctx, args) => {
		const ownerUserId = await requireViewerUserId(ctx);
		const device = await ctx.db.get(args.deviceId);
		if (!device || device.ownerUserId !== ownerUserId) {
			throw new Error('Notification device not found');
		}
		if (device.state === 'revoked') return { revoked: false };
		const now = Date.now();
		await ctx.db.patch(device._id, { state: 'revoked', revokedAt: now, updatedAt: now });
		return { revoked: true };
	}
});

export const sendTest = mutation({
	args: {
		installationId: v.string(),
		delayMs: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		const ownerUserId = await requireViewerUserId(ctx);
		const device = await ctx.db
			.query('notificationDevices')
			.withIndex('by_owner_user_id_installation_id', (q) =>
				q.eq('ownerUserId', ownerUserId).eq('installationId', args.installationId.trim())
			)
			.unique();
		if (!device || device.state !== 'active' || device.revokedAt !== undefined) {
			throw new Error('This device is not subscribed');
		}
		const now = Date.now();
		const eventId = await ctx.db.insert('notificationEvents', {
			ownerUserId,
			kind: 'test',
			collectionIds: [],
			chapterGroupKeys: [],
			newChapterCount: 0,
			title: 'Mangarr notification test',
			body: args.delayMs ? 'Background delivery is working.' : 'Notifications are working.',
			navigatePath: '/settings',
			aggregateKey: `test:${String(ownerUserId)}:${now}:${stableHash(createReceiptToken())}`,
			createdAt: now,
			updatedAt: now
		});
		const deliveryId = await insertDeliveryForDevice(ctx, {
			ownerUserId,
			eventId,
			deviceId: device._id,
			now,
			delayMs: args.delayMs
		});
		return { eventId, deliveryId, scheduledAt: now + Math.max(0, args.delayMs ?? 0) };
	}
});

export const listInbox = query({
	args: { limit: v.optional(v.float64()) },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return { items: [], unreadCount: 0 };
		const ownerUserId = identity.subject as GenericId<'users'>;
		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 25), 100));
		const rows = await ctx.db
			.query('notificationEvents')
			.withIndex('by_owner_user_id_created_at', (q) => q.eq('ownerUserId', ownerUserId))
			.order('desc')
			.take(limit);
		const unread = await ctx.db
			.query('notificationEvents')
			.withIndex('by_owner_user_id_read_at_created_at', (q) =>
				q.eq('ownerUserId', ownerUserId).eq('readAt', undefined)
			)
			.take(1000);
		return {
			items: rows.map((row) => ({
				id: row._id,
				kind: row.kind,
				title: row.title,
				body: row.body,
				path: row.navigatePath,
				readAt: row.readAt ?? null,
				createdAt: row.createdAt
			})),
			unreadCount: unread.length
		};
	}
});

export const markEventRead = mutation({
	args: { eventId: v.id('notificationEvents'), clicked: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		const ownerUserId = await requireViewerUserId(ctx);
		const event = await ctx.db.get(args.eventId);
		if (!event || event.ownerUserId !== ownerUserId) throw new Error('Notification not found');
		const now = Date.now();
		await ctx.db.patch(event._id, { readAt: event.readAt ?? now, updatedAt: now });
		if (args.clicked) {
			const deliveries = await ctx.db
				.query('notificationDeliveries')
				.withIndex('by_event_id', (q) => q.eq('eventId', event._id))
				.collect();
			for (const delivery of deliveries) {
				if (delivery.clickedAt !== undefined) continue;
				await ctx.db.patch(delivery._id, { clickedAt: now, updatedAt: now });
			}
		}
		return { read: true };
	}
});

export const markAllEventsRead = mutation({
	args: {},
	handler: async (ctx) => {
		const ownerUserId = await requireViewerUserId(ctx);
		const rows = await ctx.db
			.query('notificationEvents')
			.withIndex('by_owner_user_id_read_at_created_at', (q) =>
				q.eq('ownerUserId', ownerUserId).eq('readAt', undefined)
			)
			.take(1000);
		const now = Date.now();
		for (const row of rows) {
			await ctx.db.patch(row._id, { readAt: now, updatedAt: now });
		}
		return { marked: rows.length };
	}
});

export const beginDeliveryAttempt = internalMutation({
	args: { deliveryId: v.id('notificationDeliveries') },
	handler: async (ctx, args) => {
		const delivery = await ctx.db.get(args.deliveryId);
		if (!delivery) return { started: false, reason: 'missing' as const };
		const now = Date.now();
		const canStart =
			(delivery.status === 'queued' || delivery.status === 'retry_wait') &&
			delivery.nextAttemptAt <= now;
		const canRecover = delivery.status === 'sending' && (delivery.leaseUntil ?? 0) <= now;
		if (!canStart && !canRecover) return { started: false, reason: 'not-due' as const };
		const attemptCount = delivery.attemptCount + 1;
		await ctx.db.patch(delivery._id, {
			status: 'sending',
			attemptCount,
			leaseUntil: now + 5 * 60 * 1000,
			updatedAt: now
		});
		return { started: true, attemptCount };
	}
});

export const getDeliveryContext = internalQuery({
	args: { deliveryId: v.id('notificationDeliveries') },
	handler: async (ctx, args) => {
		const delivery = await ctx.db.get(args.deliveryId);
		if (!delivery) return null;
		const [event, device] = await Promise.all([
			ctx.db.get(delivery.eventId),
			ctx.db.get(delivery.deviceId)
		]);
		if (!event || !device) return null;
		const [unread, preferences] = await Promise.all([
			ctx.db
				.query('notificationEvents')
				.withIndex('by_owner_user_id_read_at_created_at', (q) =>
					q.eq('ownerUserId', delivery.ownerUserId).eq('readAt', undefined)
				)
				.take(1000),
			loadNotificationPreferences(ctx, delivery.ownerUserId)
		]);
		return { delivery, event, device, preferences, unreadCount: unread.length };
	}
});

export const completeDeliveryAttempt = internalMutation({
	args: {
		deliveryId: v.id('notificationDeliveries'),
		attemptCount: v.float64(),
		outcome: v.union(
			v.literal('accepted'),
			v.literal('retry'),
			v.literal('permanent_failed'),
			v.literal('suppressed')
		),
		providerStatusCode: v.optional(v.float64()),
		failureCode: v.optional(v.string()),
		failureSummary: v.optional(v.string()),
		retryAfterMs: v.optional(v.float64()),
		revokeDevice: v.optional(v.boolean()),
		staleDevice: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const delivery = await ctx.db.get(args.deliveryId);
		if (!delivery || delivery.attemptCount !== args.attemptCount || delivery.status !== 'sending') {
			return { applied: false };
		}
		const device = await ctx.db.get(delivery.deviceId);
		const now = Date.now();
		if (args.outcome === 'accepted') {
			await ctx.db.patch(delivery._id, {
				status: 'accepted',
				providerStatusCode: args.providerStatusCode,
				failureCode: undefined,
				failureSummary: undefined,
				acceptedAt: now,
				leaseUntil: undefined,
				updatedAt: now
			});
			if (device) {
				await ctx.db.patch(device._id, {
					lastAcceptedAt: now,
					lastFailureCode: undefined,
					consecutiveFailures: 0,
					updatedAt: now
				});
			}
			return { applied: true, status: 'accepted' as const };
		}
		if (args.outcome === 'suppressed') {
			await ctx.db.patch(delivery._id, {
				status: 'suppressed',
				failureCode: args.failureCode,
				failureSummary: args.failureSummary,
				leaseUntil: undefined,
				updatedAt: now
			});
			return { applied: true, status: 'suppressed' as const };
		}

		const permanent = args.outcome === 'permanent_failed' || delivery.attemptCount >= 6;
		if (permanent) {
			await ctx.db.patch(delivery._id, {
				status: 'permanent_failed',
				providerStatusCode: args.providerStatusCode,
				failureCode: args.failureCode,
				failureSummary: args.failureSummary,
				leaseUntil: undefined,
				updatedAt: now
			});
		} else {
			const fallbackDelay = Math.min(8 * 60 * 60 * 1000, 60_000 * 5 ** (delivery.attemptCount - 1));
			const delayMs = Math.max(
				30_000,
				Math.min(args.retryAfterMs ?? fallbackDelay, 8 * 60 * 60 * 1000)
			);
			await ctx.db.patch(delivery._id, {
				status: 'retry_wait',
				providerStatusCode: args.providerStatusCode,
				failureCode: args.failureCode,
				failureSummary: args.failureSummary,
				nextAttemptAt: now + delayMs,
				leaseUntil: undefined,
				updatedAt: now
			});
			await ctx.scheduler.runAfter(delayMs, SEND_DELIVERY, {
				deliveryId: delivery._id
			});
		}
		if (device) {
			await ctx.db.patch(device._id, {
				state: args.revokeDevice ? 'revoked' : args.staleDevice ? 'stale' : device.state,
				revokedAt: args.revokeDevice ? now : device.revokedAt,
				lastFailureAt: now,
				lastFailureCode: args.failureCode,
				consecutiveFailures: device.consecutiveFailures + 1,
				updatedAt: now
			});
		}
		return {
			applied: true,
			status: permanent ? ('permanent_failed' as const) : ('retry_wait' as const)
		};
	}
});

export const listRecoverableDeliveries = internalQuery({
	args: {
		status: v.union(v.literal('queued'), v.literal('retry_wait'), v.literal('sending')),
		limit: v.float64()
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		if (args.status === 'sending') {
			const rows = await ctx.db
				.query('notificationDeliveries')
				.withIndex('by_status_next_attempt_at', (q) => q.eq('status', 'sending'))
				.take(Math.max(1, Math.min(Math.floor(args.limit), 100)));
			return rows.filter((row) => (row.leaseUntil ?? 0) <= now);
		}
		return ctx.db
			.query('notificationDeliveries')
			.withIndex('by_status_next_attempt_at', (q) =>
				q.eq('status', args.status).lte('nextAttemptAt', now)
			)
			.take(Math.max(1, Math.min(Math.floor(args.limit), 100)));
	}
});

export const recordDeliveryReceipt = internalMutation({
	args: {
		token: v.string(),
		phase: v.union(v.literal('received'), v.literal('displayed'))
	},
	handler: async (ctx, args) => {
		const tokenHash = stableHash(args.token);
		const candidates = await ctx.db
			.query('notificationDeliveries')
			.withIndex('by_receipt_token_hash', (q) => q.eq('receiptTokenHash', tokenHash))
			.collect();
		const delivery = candidates.find((row) => row.receiptToken === args.token);
		if (!delivery) return { recorded: false };
		const now = Date.now();
		await ctx.db.patch(delivery._id, {
			receivedAt: delivery.receivedAt ?? now,
			displayedAt:
				args.phase === 'displayed' ? (delivery.displayedAt ?? now) : delivery.displayedAt,
			updatedAt: now
		});
		return { recorded: true };
	}
});
