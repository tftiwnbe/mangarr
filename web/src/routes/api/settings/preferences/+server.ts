import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { convexApi } from '$lib/server/convex-api';
import { getUserConvexClient } from '$lib/server/convex';

function requireUser(locals: App.Locals) {
	const user = locals.auth.user;
	if (!user) {
		throw error(401, 'Not signed in');
	}
	return user;
}

export const GET: RequestHandler = async ({ locals }) => {
	const user = requireUser(locals);
	const client = await getUserConvexClient(user);
	return json(await client.query(convexApi.user_preferences.getMine, {}));
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);

	let payload: Record<string, unknown>;
	try {
		payload = (await request.json()) as Record<string, unknown>;
	} catch {
		throw error(400, 'Request body must be valid JSON');
	}

	const args: {
		theme?: string | null;
		locale?: string | null;
		pwaResumeEnabled?: boolean | null;
	} = {};
	if ('theme' in payload) {
		const value = payload.theme;
		if (value === null || typeof value === 'string') args.theme = value;
		else throw error(400, 'theme must be a string or null');
	}
	if ('locale' in payload) {
		const value = payload.locale;
		if (value === null || typeof value === 'string') args.locale = value;
		else throw error(400, 'locale must be a string or null');
	}
	if ('pwaResumeEnabled' in payload) {
		const value = payload.pwaResumeEnabled;
		if (value === null || typeof value === 'boolean') args.pwaResumeEnabled = value;
		else throw error(400, 'pwaResumeEnabled must be a boolean or null');
	}

	const client = await getUserConvexClient(user);
	return json(await client.mutation(convexApi.user_preferences.updateMine, args));
};
