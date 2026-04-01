import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth';
import { getUserConvexClient } from '$lib/server/convex';

export async function requireAdminConvexClient(event: RequestEvent) {
	const user = requireUser(event);
	if (!user.isAdmin) {
		throw error(403, 'Admin privileges are required');
	}

	return {
		user,
		client: await getUserConvexClient(user)
	};
}

export function commandFailure(cause: unknown, fallback: string) {
	if (cause instanceof Error && cause.message.trim()) {
		return cause.message.trim();
	}
	return fallback;
}
