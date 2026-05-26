import { describe, expect, it } from 'vitest';

import {
	buildNotificationEventDedupeKey,
	createNotificationEventForNewChapters
} from './notifications';

type QuerySpec = {
	collect?: unknown[];
	unique?: unknown;
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
	title?: { _id: string; ownerUserId: string; title: string; routeBase?: string; coverUrl?: string };
	existingEvent?: { _id: string };
}) {
	const inserted: Array<{ table: string; value: Record<string, unknown> }> = [];
	const collectionLinks = args.collectionLinks ?? [];
	const collections = args.collections ?? {};
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
			'chapterNotificationEvents:by_dedupe_key',
			{
				unique: args.existingEvent ?? null
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
				return collections[id] ?? null;
			},
			insert: async (table: string, value: Record<string, unknown>) => {
				inserted.push({ table, value });
				return 'event-created';
			}
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
			collectionLinks: [{ collectionId: 'collection-1', ownerUserId: 'user-1', libraryTitleId: 'title-1' }],
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
			collectionLinks: [{ collectionId: 'collection-1', ownerUserId: 'user-1', libraryTitleId: 'title-1' }],
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

		expect(result).toEqual({ created: true, eventId: 'event-created' });
		expect(inserted).toHaveLength(1);
		expect(inserted[0]?.table).toBe('chapterNotificationEvents');
		expect(inserted[0]?.value).toMatchObject({
			ownerUserId: 'user-1',
			libraryTitleId: 'title-1',
			collectionIds: ['collection-1'],
			newChapterCount: 2,
			titleName: 'Blue Box',
			latestChapterName: 'Chapter 2',
			status: 'pending'
		});
	});
});
