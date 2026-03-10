import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { convexApi } from '$lib/server/convex-api';
import { getConvexClient } from '$lib/server/convex';
import { hashPassword, validatePasswordStrength, verifyPassword } from '$lib/server/security';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.auth.user) {
		throw error(401, 'Not signed in');
	}

	const payload = (await request.json()) as {
		current_password?: string;
		new_password?: string;
	};

	const currentPassword = String(payload.current_password ?? '');
	const newPassword = String(payload.new_password ?? '');
	if (!currentPassword || !newPassword) {
		throw error(400, 'Current and new password are required');
	}
	const passwordResult = validatePasswordStrength(newPassword);
	if (!passwordResult.ok) {
		throw error(400, passwordResult.message);
	}

	const client = getConvexClient();
	const user = await client.query(convexApi.auth.getUserByUsername, {
		username: locals.auth.user.username
	});
	if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
		throw error(400, 'Current password is incorrect');
	}

	await client.mutation(convexApi.auth.updateUserPassword, {
		userId: locals.auth.user.id,
		passwordHash: hashPassword(passwordResult.value),
		now: Date.now()
	});

	return new Response(null, { status: 204 });
};
