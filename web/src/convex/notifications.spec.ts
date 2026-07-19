import { describe, expect, it } from 'vitest';

import {
	buildNotificationEventDedupeKey,
	createNotificationEventForNewChapters
} from './notifications';

type QuerySpec = {
	collect?: unknown[];
	unique?: unknown;
};

type ChapterFixture = {
	_id: string;
	ownerUserId: string;
	chapterName: string;
	chapterNumber?: number;
	chapterGroupKey?: string;
};

function createCtx(args: {
	preferences?: {
		collectionNotificationsEnabled?: boolean;
		iosPwaPushEnabled?: boolean;
		foregroundNotificationsEnabled?: boolean;
	};
	downloadProfile?: {
		enabled: boolean;
		paused: boolean;
		ownerUserId: string;
		libraryTitleId: string;
	};
	collectionLinks?: Array<{ collectionId: string; ownerUserId: string; libraryTitleId: string }>;
	collections?: Record<string, { _id: string; ownerUserId: string; notifyOnNewChapters?: boolean }>;
	chapters?: Record<string, ChapterFixture>;
	title?: {
		_id: string;
		ownerUserId: string;
		title: string;
		routeBase?: string;
		coverUrl?: string;
	};
	existingEvent?: { _id: string };
	devices?: Array<{
		_id: string;
		ownerUserId: string;
		state: 'active' | 'revoked';
		revokedAt?: number;
	}>;
}) {
	const inserted: Array<{ table: string; value: Record<string, unknown> }> = [];
	const collectionLinks = args.collectionLinks ?? [];
	const collections = args.collections ?? {};
	const chapters: Record<string, ChapterFixture> = args.chapters ?? {
		'chapter-1': {
			_id: 'chapter-1',
			ownerUserId: 'user-1',
			chapterName: 'Chapter 1',
			chapterNumber: 1,
			chapterGroupKey: 'chapter:1'
		},
		'chapter-2': {
			_id: 'chapter-2',
			ownerUserId: 'user-1',
			chapterName: 'Chapter 2',
			chapterNumber: 2,
			chapterGroupKey: 'chapter:2'
		}
	};
	const title = args.title ?? {
		_id: 'title-1',
		ownerUserId: 'user-1',
		title: 'Blue Box'
	};

	const queries = new Map<string, QuerySpec>([
		[
			'notificationPreferences:by_owner_user_id',
			{
				unique: args.preferences
					? {
							_id: 'pref-1',
							ownerUserId: 'user-1',
							collectionNotificationsEnabled:
								args.preferences.collectionNotificationsEnabled ?? true,
							iosPwaPushEnabled: args.preferences.iosPwaPushEnabled ?? true,
							foregroundNotificationsEnabled:
								args.preferences.foregroundNotificationsEnabled ?? true
						}
					: null
			}
		],
		[
			'downloadProfiles:by_owner_user_id_library_title_id',
			{
				unique: args.downloadProfile ?? null
			}
		],
		[
			'libraryCollectionTitles:by_owner_user_id_library_title_id',
			{
				collect: collectionLinks
			}
		],
		[
			'notificationEvents:by_aggregate_key',
			{
				unique: args.existingEvent ?? null
			}
		],
		[
			'notificationDevices:by_owner_user_id',
			{
				collect: args.devices ?? []
			}
		]
	]);

	const ctx = {
		db: {
			query(table: string) {
				return {
					withIndex(index: string) {
						const spec = queries.get(`${table}:${index}`) ?? {};
						return {
							collect: async () => spec.collect ?? [],
							unique: async () => spec.unique ?? null
						};
					}
				};
			},
			get: async (id: string) => {
				if (id === title._id) return title;
				return collections[id] ?? chapters[id] ?? null;
			},
			insert: async (table: string, value: Record<string, unknown>) => {
				inserted.push({ table, value });
				return `${table}-created`;
			}
		},
		scheduler: {
			runAfter: async () => 'scheduled-1'
		}
	};

	return { ctx, inserted };
}

describe('notification event dedupe key', () => {
	it('is stable regardless of chapter id order', () => {
		const left = buildNotificationEventDedupeKey({
			ownerUserId: 'user-1' as never,
			libraryTitleId: 'title-1' as never,
			chapterIds: ['chapter-2', 'chapter-1'] as never
		});
		const right = buildNotificationEventDedupeKey({
			ownerUserId: 'user-1' as never,
			libraryTitleId: 'title-1' as never,
			chapterIds: ['chapter-1', 'chapter-2'] as never
		});

		expect(left).toBe(right);
	});
});

describe('createNotificationEventForNewChapters', () => {
	it('skips event creation when the monitored profile is disabled', async () => {
		const { ctx, inserted } = createCtx({
			downloadProfile: {
				enabled: false,
				paused: false,
				ownerUserId: 'user-1',
				libraryTitleId: 'title-1'
			}
		});

		const result = await createNotificationEventForNewChapters(ctx as never, {
			ownerUserId: 'user-1' as never,
			libraryTitleId: 'title-1' as never,
			newChapterIds: ['chapter-1' as never],
			latestChapterName: 'Chapter 1',
			now: 123
		});

		expect(result).toEqual({ created: false, reason: 'monitor-disabled' });
		expect(inserted).toHaveLength(0);
	});

	it('skips event creation when no tracked manual collections match', async () => {
		const { ctx, inserted } = createCtx({
			downloadProfile: {
				enabled: true,
				paused: false,
				ownerUserId: 'user-1',
				libraryTitleId: 'title-1'
			},
			collectionLinks: [
				{ collectionId: 'collection-1', ownerUserId: 'user-1', libraryTitleId: 'title-1' }
			],
			collections: {
				'collection-1': {
					_id: 'collection-1',
					ownerUserId: 'user-1',
					notifyOnNewChapters: false
				}
			}
		});

		const result = await createNotificationEventForNewChapters(ctx as never, {
			ownerUserId: 'user-1' as never,
			libraryTitleId: 'title-1' as never,
			newChapterIds: ['chapter-1' as never],
			latestChapterName: 'Chapter 1',
			now: 123
		});

		expect(result).toEqual({ created: false, reason: 'no-tracked-collections' });
		expect(inserted).toHaveLength(0);
	});

	it('creates one aggregated event for newly inserted chapters in tracked collections', async () => {
		const { ctx, inserted } = createCtx({
			downloadProfile: {
				enabled: true,
				paused: false,
				ownerUserId: 'user-1',
				libraryTitleId: 'title-1'
			},
			collectionLinks: [
				{ collectionId: 'collection-1', ownerUserId: 'user-1', libraryTitleId: 'title-1' }
			],
			collections: {
				'collection-1': {
					_id: 'collection-1',
					ownerUserId: 'user-1',
					notifyOnNewChapters: true
				}
			}
		});

		const result = await createNotificationEventForNewChapters(ctx as never, {
			ownerUserId: 'user-1' as never,
			libraryTitleId: 'title-1' as never,
			newChapterIds: ['chapter-2' as never, 'chapter-1' as never],
			latestChapterName: 'Chapter 2',
			now: 123
		});

		expect(result).toEqual({
			created: true,
			eventId: 'notificationEvents-created',
			deliveryCount: 0
		});
		expect(inserted.filter((row) => row.table === 'notificationChapterMarkers')).toHaveLength(2);
		const event = inserted.find((row) => row.table === 'notificationEvents');
		expect(event?.value).toMatchObject({
			ownerUserId: 'user-1',
			libraryTitleId: 'title-1',
			collectionIds: ['collection-1'],
			newChapterCount: 2,
			title: 'Blue Box',
			chapterGroupKeys: ['chapter:1', 'chapter:2']
		});
	});

	it('establishes markers without sending a notification for the first monitored sync', async () => {
		const { ctx, inserted } = createCtx({
			downloadProfile: {
				enabled: true,
				paused: false,
				ownerUserId: 'user-1',
				libraryTitleId: 'title-1'
			},
			collectionLinks: [
				{ collectionId: 'collection-1', ownerUserId: 'user-1', libraryTitleId: 'title-1' }
			],
			collections: {
				'collection-1': {
					_id: 'collection-1',
					ownerUserId: 'user-1',
					notifyOnNewChapters: true
				}
			}
		});

		const result = await createNotificationEventForNewChapters(ctx as never, {
			ownerUserId: 'user-1' as never,
			libraryTitleId: 'title-1' as never,
			newChapterIds: ['chapter-1' as never],
			latestChapterName: 'Chapter 1',
			now: 123,
			suppressInitial: true
		});

		expect(result).toEqual({ created: false, reason: 'baseline-established' });
		expect(inserted.filter((row) => row.table === 'notificationChapterMarkers')).toHaveLength(1);
		expect(inserted.some((row) => row.table === 'notificationEvents')).toBe(false);
	});

	it('fans one delivery out to every active device', async () => {
		const { ctx, inserted } = createCtx({
			downloadProfile: {
				enabled: true,
				paused: false,
				ownerUserId: 'user-1',
				libraryTitleId: 'title-1'
			},
			collectionLinks: [
				{ collectionId: 'collection-1', ownerUserId: 'user-1', libraryTitleId: 'title-1' }
			],
			collections: {
				'collection-1': {
					_id: 'collection-1',
					ownerUserId: 'user-1',
					notifyOnNewChapters: true
				}
			},
			devices: [
				{ _id: 'desktop', ownerUserId: 'user-1', state: 'active' },
				{ _id: 'android', ownerUserId: 'user-1', state: 'active' },
				{ _id: 'old-phone', ownerUserId: 'user-1', state: 'revoked', revokedAt: 100 }
			]
		});

		const result = await createNotificationEventForNewChapters(ctx as never, {
			ownerUserId: 'user-1' as never,
			libraryTitleId: 'title-1' as never,
			newChapterIds: ['chapter-1' as never],
			latestChapterName: 'Chapter 1',
			now: 123
		});

		expect(result).toMatchObject({ created: true, deliveryCount: 2 });
		const deliveries = inserted.filter((row) => row.table === 'notificationDeliveries');
		expect(deliveries).toHaveLength(2);
		expect(deliveries.map((row) => row.value.deviceId)).toEqual(['desktop', 'android']);
	});
});
