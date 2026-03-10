import { ConvexHttpClient } from 'convex/browser';

import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

export function getConvexClient() {
	const url =
		privateEnv.CONVEX_URL || privateEnv.CONVEX_SELF_HOSTED_URL || publicEnv.PUBLIC_CONVEX_URL;
	if (!url) {
		throw new Error('Convex URL is not configured');
	}

  const client = new ConvexHttpClient(url, {
    skipConvexDeploymentUrlCheck: true,
    logger: false
  });

	const adminKey = privateEnv.CONVEX_ADMIN_KEY || privateEnv.CONVEX_SELF_HOSTED_ADMIN_KEY;
	if (adminKey) {
		(
			client as ConvexHttpClient & {
				setAdminAuth(token: string): void;
			}
		).setAdminAuth(adminKey);
	}

  return client;
}
