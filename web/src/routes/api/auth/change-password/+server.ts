import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { changePasswordWithCredentials } from '$lib/server/auth';

export const POST: RequestHandler = async (event) => {
	if (!event.locals.auth.user) {
		throw error(401, 'Not signed in');
	}

	let payload: { current_password?: string; new_password?: string };
	try {
		payload = (await event.request.json()) as { current_password?: string; new_password?: string };
	} catch {
		throw error(400, 'Request body must be valid JSON');
	}

	const result = await changePasswordWithCredentials(event, {
		currentPassword: String(payload.current_password ?? ''),
		newPassword: String(payload.new_password ?? '')
	});

	if (!result.ok) {
		throw error(result.field === 'auth' ? 401 : 400, result.message);
	}

	return json({ ok: true });
};
