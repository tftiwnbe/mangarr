import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { convexApi } from '$lib/server/convex-api';
import { getConvexClient } from '$lib/server/convex';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.auth.user) {
		throw redirect(303, `/login?redirect=${encodeURIComponent(url.pathname)}`);
	}

	const client = getConvexClient();
	const installedExtensions = await client.query(convexApi.extensions.listInstalled, {});
	if (installedExtensions.length > 0) {
		throw redirect(303, '/library');
	}
};
