import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	installation: defineTable({
		key: v.string(),
		setupState: v.union(v.literal('open'), v.literal('configured')),
		schemaVersion: v.string(),
		releaseChannel: v.string(),
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

	workerState: defineTable({
		workerId: v.string(),
		version: v.string(),
		capabilities: v.array(v.string()),
		lastHeartbeatAt: v.float64(),
		bridgeStatus: v.union(
			v.literal('stopped'),
			v.literal('starting'),
			v.literal('ready'),
			v.literal('error')
		),
		bridgePort: v.optional(v.float64()),
		bridgeReady: v.boolean(),
		restartCount: v.float64(),
		lastStartupError: v.optional(v.string()),
		lastHeartbeatError: v.optional(v.string()),
		updatedAt: v.float64()
	})
		.index('by_worker_id', ['workerId'])
		.index('by_last_heartbeat_at', ['lastHeartbeatAt']),

	libraryTitles: defineTable({
		ownerUserId: v.id('users'),
		canonicalKey: v.string(),
		title: v.string(),
		coverRef: v.optional(v.string()),
		preferredVariantId: v.optional(v.string()),
		createdAt: v.float64(),
		updatedAt: v.float64(),
		lastRefreshedAt: v.optional(v.float64())
	})
		.index('by_owner_user_id', ['ownerUserId'])
		.index('by_owner_user_id_canonical_key', ['ownerUserId', 'canonicalKey'])
		.index('by_owner_user_id_updated_at', ['ownerUserId', 'updatedAt']),

	commands: defineTable({
		commandType: v.string(),
		targetCapability: v.string(),
		scopeType: v.string(),
		scopeId: v.string(),
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
		leaseOwnerWorkerId: v.optional(v.string()),
		leaseExpiresAt: v.optional(v.float64()),
		attemptCount: v.float64(),
		maxAttempts: v.float64(),
		lastErrorCode: v.optional(v.string()),
		lastErrorMessage: v.optional(v.string()),
		result: v.optional(v.any()),
		createdAt: v.float64(),
		updatedAt: v.float64(),
		startedAt: v.optional(v.float64()),
		completedAt: v.optional(v.float64()),
		parentCommandId: v.optional(v.id('commands'))
	})
		.index('by_status_priority_run_after', ['status', 'priority', 'runAfter'])
		.index('by_lease_owner_worker_id', ['leaseOwnerWorkerId'])
		.index('by_idempotency_key', ['idempotencyKey'])
		.index('by_scope', ['scopeType', 'scopeId'])
		.index('by_target_capability', ['targetCapability'])
		.index('by_created_at', ['createdAt'])
});
