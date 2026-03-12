import { error, json } from '@sveltejs/kit';
import type { GenericId } from 'convex/values';
import type { RequestHandler } from './$types';

import { convexApi } from '$lib/server/convex-api';
import { getConvexClient } from '$lib/server/convex';
import { generateOpaqueToken, hashToken } from '$lib/server/security';

const MAX_KEY_NAME_LENGTH = 120;

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.auth.user;
	if (!user) {
		throw error(401, 'Not signed in');
	}

	const client = getConvexClient();
	const keys = await client.query(convexApi.auth.listIntegrationApiKeys, {
		userId: user.id as GenericId<'users'>
	});

	return json({ keys });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.auth.user;
	if (!user) {
		throw error(401, 'Not signed in');
	}

	let payload: { name?: string };
	try {
		payload = (await request.json()) as { name?: string };
	} catch {
		throw error(400, 'Request body must be valid JSON');
	}

	const name = String(payload.name ?? '').trim();
	if (!name) {
		throw error(400, 'Key name is required');
	}
	if (name.length > MAX_KEY_NAME_LENGTH) {
		throw error(400, `Key name must be at most ${MAX_KEY_NAME_LENGTH} characters`);
	}

	const rawKey = `mgr_${generateOpaqueToken()}`;
	const keyPrefix = rawKey.slice(0, 12);
	const now = Date.now();

	const client = getConvexClient();
	const created = await client.mutation(convexApi.auth.createIntegrationApiKey, {
		userId: user.id as GenericId<'users'>,
		name,
		keyHash: hashToken(rawKey),
		keyPrefix,
		createdAt: now
	});

	return json({
		key: rawKey,
		item: created
	});
};
