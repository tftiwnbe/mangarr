import type { GenericId } from 'convex/values';
import { v } from 'convex/values';

import {
	internalMutation,
	internalQuery,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import { resolveOwnerTitleRouteSegment } from './library_reader_support';
import { requireViewerUserId } from './library_shared_access';

const DEFAULT_PREFERENCES: NotificationPreferences = {
	collectionNotificationsEnabled: true,
	iosPwaPushEnabled: true,
	foregroundNotificationsEnabled: true
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

type NotificationPreferences = {
	collectionNotificationsEnabled: boolean;
	iosPwaPushEnabled: boolean;
	foregroundNotificationsEnabled: boolean;
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
		configured: Boolean(publicKey && privateKey && subject)
	};
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
			row?.foregroundNotificationsEnabled ?? DEFAULT_PREFERENCES.foregroundNotificationsEnabled
	};
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

	const dedupeKey = buildNotificationEventDedupeKey({
		ownerUserId: args.ownerUserId,
		libraryTitleId: args.libraryTitleId,
		chapterIds: args.newChapterIds
	});
	const existing = await ctx.db
		.query('chapterNotificationEvents')
		.withIndex('by_dedupe_key', (q) => q.eq('dedupeKey', dedupeKey))
		.unique();
	if (existing) {
		return { created: false, reason: 'duplicate' as const, eventId: existing._id };
	}

	const eventId = await ctx.db.insert('chapterNotificationEvents', {
		ownerUserId: args.ownerUserId,
		libraryTitleId: args.libraryTitleId,
		collectionIds: trackedCollectionIds,
		newChapterIds: args.newChapterIds,
		newChapterCount: args.newChapterIds.length,
		titleName: title.title,
		latestChapterName: args.latestChapterName,
		coverUrl: title.coverUrl,
		routeBase: title.routeBase,
		dedupeKey,
		status: PUSH_STATUS.PENDING,
		attemptCount: 0,
		createdAt: args.now,
		updatedAt: args.now
	});

	return { created: true, eventId };
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
		foregroundNotificationsEnabled: v.optional(v.boolean())
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
					foregroundNotificationsEnabled: existing.foregroundNotificationsEnabled
				}
			: DEFAULT_PREFERENCES;
		const next = {
			collectionNotificationsEnabled:
				args.collectionNotificationsEnabled ?? current.collectionNotificationsEnabled,
			iosPwaPushEnabled: args.iosPwaPushEnabled ?? current.iosPwaPushEnabled,
			foregroundNotificationsEnabled:
				args.foregroundNotificationsEnabled ?? current.foregroundNotificationsEnabled
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
