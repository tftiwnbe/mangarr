import type { RequestHandler } from './$types';

import { proxyBridgeRequest } from '$lib/server/bridge-proxy';

export const POST: RequestHandler = async (event) =>
	proxyBridgeRequest(event, 'bridge/restart', { method: 'POST' });
