import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	installation: defineTable({
		key: v.string(),
		setupState: v.union(v.literal('open'), v.literal('configured')),
		schemaVersion: v.string(),
		extensionRepoUrl: v.optional(v.string()),
		extensionRepoLanguages: v.optional(v.array(v.string())),
		preferredContentLanguages: v.optional(v.array(v.string())),
		defaultAdminCreatedAt: v.optional(v.float64()),
		createdAt: v.float64(),
		updatedAt: v.float64()
	}).index('by_key', ['key']),

	users: defineTable({
		username: v.string(),
		passwordHash: v.string(),
		isAdmin: v.boolean(),
		status: v.union(v.literal('active'), v.literal('disabled')),
		createdAt: v.float64(),
		updatedAt: v.float64(),
		lastLoginAt: v.optional(v.float64())
	}).index('by_username', ['username']),

	browserSessions: defineTable({
		ownerUserId: v.id('users'),
		sessionTokenHash: v.string(),
		createdAt: v.float64(),
		expiresAt: v.float64(),
		revokedAt: v.optional(v.float64()),
		lastUsedAt: v.optional(v.float64())
	})
		.index('by_token_hash', ['sessionTokenHash'])
		.index('by_owner_user_id', ['ownerUserId'])
		.index('by_expires_at', ['expiresAt']),

	integrationApiKeys: defineTable({
		ownerUserId: v.id('users'),
		publicId: v.float64(),
		name: v.string(),
		keyHash: v.string(),
		keyPrefix: v.string(),
		createdAt: v.float64(),
		lastUsedAt: v.optional(v.float64()),
		revokedAt: v.optional(v.float64())
	})
		.index('by_key_hash', ['keyHash'])
		.index('by_owner_user_id', ['ownerUserId'])
		.index('by_owner_user_id_public_id', ['ownerUserId', 'publicId'])
		.index('by_revoked_at', ['revokedAt']),

	bridgeState: defineTable({
		bridgeId: v.string(),
		version: v.string(),
		capabilities: v.array(v.string()),
		lastHeartbeatAt: v.float64(),
		status: v.union(
			v.literal('stopped'),
			v.literal('starting'),
			v.literal('ready'),
			v.literal('error')
		),
		port: v.optional(v.float64()),
		ready: v.boolean(),
		restartCount: v.float64(),
		lastStartupError: v.optional(v.string()),
		lastHeartbeatError: v.optional(v.string()),
		updatedAt: v.float64()
	})
		.index('by_bridge_id', ['bridgeId'])
		.index('by_last_heartbeat_at', ['lastHeartbeatAt']),

	installedExtensions: defineTable({
		pkg: v.string(),
		name: v.string(),
		lang: v.string(),
		version: v.string(),
		sourceIds: v.array(v.string()),
		sources: v.optional(
			v.array(
				v.object({
					id: v.string(),
					name: v.string(),
					lang: v.string(),
					supportsLatest: v.boolean(),
					enabled: v.optional(v.boolean())
				})
			)
		),
		status: v.union(v.literal('installed'), v.literal('disabled')),
		installedAt: v.float64(),
		updatedAt: v.float64()
	})
		.index('by_pkg', ['pkg'])
		.index('by_installed_at', ['installedAt']),

	libraryTitles: defineTable({
		ownerUserId: v.id('users'),
		canonicalKey: v.string(),
		title: v.string(),
		sourcePkg: v.string(),
		sourceLang: v.string(),
		sourceId: v.string(),
		titleUrl: v.string(),
		author: v.optional(v.string()),
		artist: v.optional(v.string()),
		description: v.optional(v.string()),
		coverUrl: v.optional(v.string()),
		genre: v.optional(v.string()),
		status: v.optional(v.float64()),
		preferredVariantId: v.optional(v.id('titleVariants')),
		listedInLibrary: v.optional(v.boolean()),
		userStatusId: v.optional(v.id('libraryUserStatuses')),
		userRating: v.optional(v.float64()),
		localCoverPath: v.optional(v.string()),
		createdAt: v.float64(),
		updatedAt: v.float64(),
		lastReadAt: v.optional(v.float64())
	})
		.index('by_owner_user_id', ['ownerUserId'])
		.index('by_owner_user_id_canonical_key', ['ownerUserId', 'canonicalKey'])
		.index('by_owner_user_id_updated_at', ['ownerUserId', 'updatedAt'])
		.index('by_source_id_title_url', ['sourceId', 'titleUrl']),

	libraryUserStatuses: defineTable({
		ownerUserId: v.id('users'),
		key: v.string(),
		label: v.string(),
		position: v.float64(),
		isDefault: v.boolean(),
		createdAt: v.float64(),
		updatedAt: v.float64()
	})
		.index('by_owner_user_id', ['ownerUserId'])
		.index('by_owner_user_id_key', ['ownerUserId', 'key']),

	libraryCollections: defineTable({
		ownerUserId: v.id('users'),
		name: v.string(),
		position: v.float64(),
		isDefault: v.boolean(),
		createdAt: v.float64(),
		updatedAt: v.float64()
	}).index('by_owner_user_id', ['ownerUserId']),

	titleVariants: defineTable({
		ownerUserId: v.id('users'),
		libraryTitleId: v.id('libraryTitles'),
		sourceId: v.string(),
		sourcePkg: v.string(),
		sourceLang: v.string(),
		titleUrl: v.string(),
		title: v.string(),
		author: v.optional(v.string()),
		artist: v.optional(v.string()),
		description: v.optional(v.string()),
		coverUrl: v.optional(v.string()),
		genre: v.optional(v.string()),
		status: v.optional(v.float64()),
		isPreferred: v.boolean(),
		createdAt: v.float64(),
		updatedAt: v.float64(),
		lastSyncedAt: v.optional(v.float64())
	})
		.index('by_owner_user_id_library_title_id', ['ownerUserId', 'libraryTitleId'])
		.index('by_owner_user_id_source_id_title_url', ['ownerUserId', 'sourceId', 'titleUrl'])
		.index('by_library_title_id_source_id_title_url', ['libraryTitleId', 'sourceId', 'titleUrl'])
		.index('by_source_id_title_url', ['sourceId', 'titleUrl']),

	exploreTitleDetailsCache: defineTable({
		sourceId: v.string(),
		titleUrl: v.string(),
		sourcePkg: v.optional(v.string()),
		sourceLang: v.optional(v.string()),
		title: v.string(),
		author: v.optional(v.string()),
		artist: v.optional(v.string()),
		description: v.optional(v.string()),
		coverUrl: v.optional(v.string()),
		genre: v.optional(v.string()),
		status: v.optional(v.float64()),
		fetchedAt: v.float64(),
		createdAt: v.float64(),
		updatedAt: v.float64()
	})
		.index('by_source_id_title_url', ['sourceId', 'titleUrl'])
		.index('by_fetched_at', ['fetchedAt']),

	libraryCollectionTitles: defineTable({
		ownerUserId: v.id('users'),
		libraryTitleId: v.id('libraryTitles'),
		collectionId: v.id('libraryCollections'),
		createdAt: v.float64()
	})
		.index('by_owner_user_id', ['ownerUserId'])
		.index('by_owner_user_id_library_title_id', ['ownerUserId', 'libraryTitleId'])
		.index('by_owner_user_id_collection_id', ['ownerUserId', 'collectionId']),

	libraryChapters: defineTable({
		ownerUserId: v.id('users'),
		libraryTitleId: v.id('libraryTitles'),
		titleVariantId: v.optional(v.id('titleVariants')),
		sourceId: v.string(),
		sourcePkg: v.string(),
		sourceLang: v.string(),
		titleUrl: v.string(),
		chapterUrl: v.string(),
		chapterName: v.string(),
		chapterNumber: v.optional(v.float64()),
		scanlator: v.optional(v.string()),
		dateUpload: v.optional(v.float64()),
		sequence: v.float64(),
		downloadStatus: v.union(
			v.literal('missing'),
			v.literal('queued'),
			v.literal('downloading'),
			v.literal('downloaded'),
			v.literal('failed')
		),
		totalPages: v.optional(v.float64()),
		downloadedPages: v.float64(),
		localRelativePath: v.optional(v.string()),
		storageKind: v.optional(v.union(v.literal('directory'), v.literal('archive'))),
		fileSizeBytes: v.optional(v.float64()),
		lastErrorMessage: v.optional(v.string()),
		downloadedAt: v.optional(v.float64()),
		createdAt: v.float64(),
		updatedAt: v.float64()
	})
		.index('by_library_title_id', ['libraryTitleId'])
		.index('by_library_title_id_download_status', ['libraryTitleId', 'downloadStatus'])
		.index('by_owner_user_id_library_title_id', ['ownerUserId', 'libraryTitleId'])
		.index('by_owner_user_id_download_status', ['ownerUserId', 'downloadStatus'])
		.index('by_library_title_id_chapter_url', ['libraryTitleId', 'chapterUrl']),

	downloadProfiles: defineTable({
		ownerUserId: v.id('users'),
		libraryTitleId: v.id('libraryTitles'),
		enabled: v.boolean(),
		paused: v.boolean(),
		autoDownload: v.boolean(),
		lastCheckedAt: v.optional(v.float64()),
		lastSuccessAt: v.optional(v.float64()),
		lastError: v.optional(v.string()),
		createdAt: v.float64(),
		updatedAt: v.float64()
	})
		.index('by_owner_user_id', ['ownerUserId'])
		.index('by_owner_user_id_library_title_id', ['ownerUserId', 'libraryTitleId'])
		.index('by_owner_user_id_enabled_updated_at', ['ownerUserId', 'enabled', 'updatedAt']),

	downloadTasks: defineTable({
		ownerUserId: v.id('users'),
		requestedByUserId: v.optional(v.id('users')),
		libraryTitleId: v.id('libraryTitles'),
		libraryChapterId: v.id('libraryChapters'),
		commandId: v.optional(v.id('commands')),
		trigger: v.union(v.literal('manual'), v.literal('watch'), v.literal('retry')),
		attemptNumber: v.float64(),
		status: v.union(
			v.literal('queued'),
			v.literal('downloading'),
			v.literal('completed'),
			v.literal('failed'),
			v.literal('cancelled')
		),
		titleName: v.string(),
		chapterName: v.string(),
		chapterUrl: v.string(),
		coverUrl: v.optional(v.string()),
		localCoverPath: v.optional(v.string()),
		downloadedPages: v.optional(v.float64()),
		totalPages: v.optional(v.float64()),
		progressPercent: v.optional(v.float64()),
		localRelativePath: v.optional(v.string()),
		storageKind: v.optional(v.union(v.literal('directory'), v.literal('archive'))),
		fileSizeBytes: v.optional(v.float64()),
		errorMessage: v.optional(v.string()),
		startedAt: v.optional(v.float64()),
		completedAt: v.optional(v.float64()),
		cancelledAt: v.optional(v.float64()),
		createdAt: v.float64(),
		updatedAt: v.float64()
	})
		.index('by_status_updated_at', ['status', 'updatedAt'])
		.index('by_owner_user_id_updated_at', ['ownerUserId', 'updatedAt'])
		.index('by_owner_user_id_status_updated_at', ['ownerUserId', 'status', 'updatedAt'])
		.index('by_library_chapter_id_created_at', ['libraryChapterId', 'createdAt'])
		.index('by_command_id', ['commandId']),

	chapterProgress: defineTable({
		ownerUserId: v.id('users'),
		libraryTitleId: v.id('libraryTitles'),
		chapterId: v.id('libraryChapters'),
		pageIndex: v.float64(),
		createdAt: v.float64(),
		updatedAt: v.float64()
	})
		.index('by_owner_user_id_chapter_id', ['ownerUserId', 'chapterId'])
		.index('by_owner_user_id_library_title_id_updated_at', [
			'ownerUserId',
			'libraryTitleId',
			'updatedAt'
		]),

	chapterComments: defineTable({
		ownerUserId: v.id('users'),
		libraryTitleId: v.id('libraryTitles'),
		chapterId: v.id('libraryChapters'),
		pageIndex: v.float64(),
		message: v.string(),
		createdAt: v.float64(),
		updatedAt: v.float64()
	})
		.index('by_owner_user_id_chapter_id_updated_at', ['ownerUserId', 'chapterId', 'updatedAt'])
		.index('by_owner_user_id_library_title_id_updated_at', [
			'ownerUserId',
			'libraryTitleId',
			'updatedAt'
		]),

	commands: defineTable({
		commandType: v.string(),
		targetCapability: v.string(),
		requestedByUserId: v.optional(v.id('users')),
		payload: v.any(),
		idempotencyKey: v.string(),
		status: v.union(
			v.literal('queued'),
			v.literal('leased'),
			v.literal('running'),
			v.literal('succeeded'),
			v.literal('failed'),
			v.literal('cancelled'),
			v.literal('dead_letter')
		),
		priority: v.float64(),
		runAfter: v.float64(),
		leaseOwnerBridgeId: v.optional(v.string()),
		leaseExpiresAt: v.optional(v.float64()),
		attemptCount: v.float64(),
		maxAttempts: v.float64(),
		lastErrorMessage: v.optional(v.string()),
		progress: v.optional(v.any()),
		result: v.optional(v.any()),
		createdAt: v.float64(),
		updatedAt: v.float64(),
		startedAt: v.optional(v.float64()),
		completedAt: v.optional(v.float64())
	})
		.index('by_status_priority_run_after', ['status', 'priority', 'runAfter'])
		.index('by_status_target_capability_priority_run_after', [
			'status',
			'targetCapability',
			'runAfter',
			'priority'
		])
		.index('by_status_lease_expires_at', ['status', 'leaseExpiresAt'])
		.index('by_lease_owner_bridge_id', ['leaseOwnerBridgeId'])
		.index('by_idempotency_key', ['idempotencyKey'])
		.index('by_requested_by_user_id_created_at', ['requestedByUserId', 'createdAt'])
		.index('by_requested_by_user_id_command_type_status_created_at', [
			'requestedByUserId',
			'commandType',
			'status',
			'createdAt'
		])
		.index('by_created_at', ['createdAt'])
});
