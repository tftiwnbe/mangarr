import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { logout } from '$lib/server/auth';

export const POST: RequestHandler = async (event) => {
	await logout(event);
	return json({ ok: true });
};
