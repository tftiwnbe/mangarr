import type { RequestHandler } from './$types';

import { proxyBridgeRequest } from '$lib/server/bridge-proxy';

export const GET: RequestHandler = async (event) =>
	proxyBridgeRequest(event, 'extensions/installed', { requireAdmin: false });
