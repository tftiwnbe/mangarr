import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

import { convexApi } from '$lib/server/convex-api';
import { getConvexClient, getUserConvexClient } from '$lib/server/convex';
import type { SessionUser } from '$lib/server/auth';
import { hashToken } from '$lib/server/security';

const INTEGRATION_KEY_TOUCH_DEBOUNCE_MS = 60 * 1000;
const recentIntegrationKeyTouches = new Map<string, number>();

type IntegrationApiKeyLookup = {
	key: {
		publicId: number;
		name: string;
		keyPrefix: string;
		createdAt: number;
		lastUsedAt?: number;
		revokedAt?: number;
	};
	user: {
		_id: string;
		username: string;
		isAdmin: boolean;
		status: 'active' | 'disabled';
		createdAt: number;
		updatedAt: number;
		lastLoginAt?: number;
	};
} | null;

export type IntegrationAuthContext = {
	user: SessionUser;
	key: NonNullable<IntegrationApiKeyLookup>['key'];
	rawKey: string;
	client: Awaited<ReturnType<typeof getUserConvexClient>>;
};

export async function requireIntegrationApiUser(
	event: RequestEvent
): Promise<IntegrationAuthContext> {
	const rawKey = readIntegrationApiKey(event.request.headers);
	if (!rawKey) {
		throw error(401, 'Integration API key is required');
	}

	const keyHash = hashToken(rawKey);
	const client = getConvexClient();
	const lookup = (await client.query(convexApi.auth.getIntegrationApiKeyByHash, {
		keyHash,
		now: Date.now()
	})) as IntegrationApiKeyLookup;

	if (!lookup) {
		throw error(401, 'Integration API key is invalid or revoked');
	}

	const now = Date.now();
	const previousTouchAt = Math.max(
		recentIntegrationKeyTouches.get(keyHash) ?? 0,
		lookup.key.lastUsedAt ?? lookup.key.createdAt
	);
	if (now - previousTouchAt >= INTEGRATION_KEY_TOUCH_DEBOUNCE_MS) {
		recentIntegrationKeyTouches.set(keyHash, now);
		try {
			await client.mutation(convexApi.auth.touchIntegrationApiKey, {
				keyHash,
				lastUsedAt: now
			});
		} catch {
			// Key touches are best-effort and should not fail the request.
		}
	}

	const user: SessionUser = {
		id: lookup.user._id,
		username: lookup.user.username,
		isAdmin: lookup.user.isAdmin,
		createdAt: lookup.user.createdAt,
		lastLoginAt: lookup.user.lastLoginAt
	};

	return {
		user,
		key: lookup.key,
		rawKey,
		client: await getUserConvexClient(user)
	};
}

function readIntegrationApiKey(headers: Headers) {
	const bearer = headers.get('authorization');
	if (bearer) {
		const match = bearer.match(/^Bearer\s+(.+)$/i);
		if (match?.[1]?.trim()) {
			return match[1].trim();
		}
	}

	const direct = headers.get('x-api-key');
	if (direct?.trim()) {
		return direct.trim();
	}

	return null;
}
