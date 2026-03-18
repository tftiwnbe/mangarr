import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { convexApi } from '$lib/server/convex-api';
import { getConvexClient } from '$lib/server/convex';

function getSafeRedirect(candidate: string | null) {
	if (candidate && candidate.startsWith('/') && !candidate.startsWith('//')) {
		return candidate;
	}

	return '/library';
}

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.auth.user) {
		throw error(401, 'Not signed in');
	}

	const client = getConvexClient();
	const installedExtensions = await client.query(convexApi.extensions.listInstalled, {});

	return json({
		redirect:
			installedExtensions.length === 0
				? '/setup'
				: getSafeRedirect(url.searchParams.get('redirect'))
	});
};
