import { env as privateEnv } from '$env/dynamic/private';

const DEFAULT_WORKER_PORT = '3212';

export function getWorkerBaseUrl() {
	const port = (privateEnv.MANGARR_WORKER_PORT ?? DEFAULT_WORKER_PORT).trim() || DEFAULT_WORKER_PORT;
	return `http://127.0.0.1:${port}`;
}
