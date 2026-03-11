import type { RequestHandler } from './$types';

import { proxyWorkerRequest } from '$lib/server/worker-proxy';

export const GET: RequestHandler = async (event) => {
	return proxyWorkerRequest(event, 'bridge');
};
