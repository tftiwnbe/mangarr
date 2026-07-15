import { error, json } from '@sveltejs/kit';
import type { GenericId } from 'convex/values';
import type { RequestHandler } from './$types';

import { convexInternal } from '$lib/server/convex-api';
import { getConvexAdminClient } from '$lib/server/convex';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const user = locals.auth.user;
	if (!user) {
		throw error(401, 'Not signed in');
	}

	const publicId = Number(params.publicId);
	if (!Number.isFinite(publicId)) {
		throw error(400, 'Invalid key id');
	}

	const client = getConvexAdminClient();
	const result = await client.mutation(convexInternal.auth.revokeIntegrationApiKey, {
		userId: user.id as GenericId<'users'>,
		publicId,
		revokedAt: Date.now()
	});

	if (!result.revoked) {
		throw error(404, 'Integration key not found');
	}

	return json(
		{ revoked: true },
		{
			headers: {
				'cache-control': 'no-store'
			}
		}
	);
};
