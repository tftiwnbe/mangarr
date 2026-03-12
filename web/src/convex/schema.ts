import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	installation: defineTable({
		key: v.string(),
		setupState: v.union(v.literal('open'), v.literal('configured')),
		schemaVersion: v.string(),
		extensionRepoUrl: v.optional(v.string()),
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
					supportsLatest: v.boolean()
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
		description: v.optional(v.string()),
		coverUrl: v.optional(v.string()),
		genre: v.optional(v.string()),
		status: v.optional(v.float64()),
		localCoverPath: v.optional(v.string()),
		createdAt: v.float64(),
		updatedAt: v.float64(),
		lastReadAt: v.optional(v.float64())
	})
		.index('by_owner_user_id', ['ownerUserId'])
		.index('by_owner_user_id_canonical_key', ['ownerUserId', 'canonicalKey'])
		.index('by_owner_user_id_updated_at', ['ownerUserId', 'updatedAt']),

	libraryChapters: defineTable({
		ownerUserId: v.id('users'),
		libraryTitleId: v.id('libraryTitles'),
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
		.index('by_owner_user_id_download_status', ['ownerUserId', 'downloadStatus'])
		.index('by_library_title_id_chapter_url', ['libraryTitleId', 'chapterUrl']),

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
		.index('by_lease_owner_bridge_id', ['leaseOwnerBridgeId'])
		.index('by_idempotency_key', ['idempotencyKey'])
		.index('by_requested_by_user_id_created_at', ['requestedByUserId', 'createdAt'])
		.index('by_created_at', ['createdAt'])
});
