import type { Handle } from '@sveltejs/kit';
import { resolveAuthState } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.auth = await resolveAuthState(event);
	return resolve(event);
};
