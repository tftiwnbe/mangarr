import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { changePasswordWithCredentials } from '$lib/server/auth';

export const POST: RequestHandler = async (event) => {
	const { locals, request } = event;
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

	const result = await changePasswordWithCredentials(event, {
		currentPassword,
		newPassword
	});
	if (!result.ok) {
		throw error(result.field === 'auth' ? 401 : 400, result.message);
	}

	return new Response(null, { status: 204 });
};
