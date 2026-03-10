import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { convexApi } from '$lib/server/convex-api';
import { getConvexClient } from '$lib/server/convex';
import { registerFirstUserWithCredentials, serializeUserProfile } from '$lib/server/auth';
import { normalizeUsername } from '$lib/server/security';

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.auth.setupOpen) {
		throw error(409, 'Setup is already complete');
	}

	const payload = (await request.json()) as { username?: string; password?: string };
	const username = String(payload.username ?? '').trim();
	const password = String(payload.password ?? '');

	if (!username || password.length === 0) {
		throw error(400, 'Username and password are required');
	}

	const result = await registerFirstUserWithCredentials(event, {
		username,
		password,
		confirmPassword: password
	});
	if (!result.ok) {
		throw error(400, result.message);
	}

	const normalized = normalizeUsername(username);
	if (!normalized.ok) {
		throw error(400, normalized.message);
	}

	const client = getConvexClient();
	const user = await client.query(convexApi.auth.getUserByUsername, {
		username: normalized.value
	});
	if (!user) {
		throw error(500, 'Failed to load created user');
	}

	return json({
		user: serializeUserProfile({
			id: user._id,
			username: user.username,
			isAdmin: user.isAdmin,
			createdAt: user.createdAt,
			lastLoginAt: user.lastLoginAt
		})
	});
};
