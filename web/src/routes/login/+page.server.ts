import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { convexApi } from '$lib/server/convex-api';
import { getConvexClient } from '$lib/server/convex';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.auth.user) {
		const client = getConvexClient();
		const installedExtensions = await client.query(convexApi.extensions.listInstalled, {});
		throw redirect(
			303,
			installedExtensions.length === 0
				? '/setup'
				: getSafeRedirect(url.searchParams.get('redirect'))
		);
	}
};

function getSafeRedirect(candidate: string | null) {
	if (candidate && candidate.startsWith('/') && !candidate.startsWith('//')) {
		return candidate;
	}

	return '/library';
}
