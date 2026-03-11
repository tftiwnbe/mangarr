import type { RequestHandler } from './$types';

import { proxyWorkerRequest } from '$lib/server/worker-proxy';

export const POST: RequestHandler = async (event) => {
	return proxyWorkerRequest(event, 'bridge/stop', { method: 'POST' });
};
