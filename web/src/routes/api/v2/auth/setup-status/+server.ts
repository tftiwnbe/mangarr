import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { getSetupState } from '$lib/server/auth';

export const GET: RequestHandler = async () => {
	return json({ needs_setup: await getSetupState() });
};
