import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { convexApi } from '$lib/server/convex-api';
import { getConvexClient } from '$lib/server/convex';
import { generateOpaqueToken, hashToken } from '$lib/server/security';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.auth.user) {
		throw error(401, 'Not signed in');
	}

	const client = getConvexClient();
	const keys = (await client.query(convexApi.auth.listIntegrationApiKeys, {
		userId: locals.auth.user.id
	})) as Array<{
		publicId: number;
		name: string;
		keyPrefix: string;
		createdAt: number;
		lastUsedAt?: number;
		revokedAt?: number;
	}>;

	return json(
		keys.map((entry) => ({
			id: entry.publicId,
			name: entry.name,
			key_prefix: entry.keyPrefix,
			created_at: new Date(entry.createdAt).toISOString(),
			last_used_at: entry.lastUsedAt ? new Date(entry.lastUsedAt).toISOString() : null,
			revoked_at: entry.revokedAt ? new Date(entry.revokedAt).toISOString() : null
		}))
	);
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.auth.user) {
		throw error(401, 'Not signed in');
	}

	const payload = (await request.json()) as { name?: string };
	const name = String(payload.name ?? '').trim();
	if (!name) {
		throw error(400, 'Key name is required');
	}

	const apiKey = `mgr_${generateOpaqueToken()}`;
	const client = getConvexClient();
	const created = await client.mutation(convexApi.auth.createIntegrationApiKey, {
		userId: locals.auth.user.id,
		name,
		keyHash: hashToken(apiKey),
		keyPrefix: apiKey.slice(0, 12),
		createdAt: Date.now()
	});

	return json({
		api_key: apiKey,
		key: {
			id: created.publicId,
			name: created.name,
			key_prefix: created.keyPrefix,
			created_at: new Date(created.createdAt).toISOString(),
			last_used_at: created.lastUsedAt ? new Date(created.lastUsedAt).toISOString() : null,
			revoked_at: created.revokedAt ? new Date(created.revokedAt).toISOString() : null
		}
	});
};
