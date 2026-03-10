import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { convexApi } from '$lib/server/convex-api';
import { getConvexClient } from '$lib/server/convex';
import { loginWithCredentials, serializeUserProfile } from '$lib/server/auth';
import { normalizeUsername } from '$lib/server/security';

export const POST: RequestHandler = async (event) => {
	const { request } = event;
	const payload = (await request.json()) as {
		username?: string;
		password?: string;
		remember_me?: boolean;
	};
	const username = String(payload.username ?? '').trim();
	const password = String(payload.password ?? '').trim();

	if (!username || !password) {
		throw error(400, 'Username and password are required');
	}

	const result = await loginWithCredentials(event, {
		username,
		password,
		rememberMe: Boolean(payload.remember_me)
	});
	if (!result.ok) {
		throw error(result.field === 'rate' ? 429 : 401, result.message);
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
		throw error(500, 'Failed to load signed-in user');
	}

	return json({
		user: serializeUserProfile({
			id: user._id,
			username: user.username,
			isAdmin: user.isAdmin,
			createdAt: user.createdAt,
			lastLoginAt: user.lastLoginAt
		}),
		issued_at: new Date().toISOString()
	});
};
