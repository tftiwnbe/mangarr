import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { convexApi } from '$lib/server/convex-api';
import { getConvexClient } from '$lib/server/convex';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.auth.user) {
		throw error(401, 'Not signed in');
	}

	const keyId = Number(params.key_id);
	if (!Number.isFinite(keyId)) {
		throw error(400, 'Invalid integration key id');
	}

	const client = getConvexClient();
	await client.mutation(convexApi.auth.revokeIntegrationApiKey, {
		userId: locals.auth.user.id,
		publicId: keyId,
		revokedAt: Date.now()
	});
	return new Response(null, { status: 204 });
};
