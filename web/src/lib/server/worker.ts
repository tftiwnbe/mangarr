import { env as privateEnv } from '$env/dynamic/private';

const DEFAULT_WORKER_PORT = '3212';

export function getWorkerBaseUrl() {
	const explicitUrl = (privateEnv.MANGARR_WORKER_INTERNAL_URL ?? '').trim();
	if (explicitUrl) {
		return explicitUrl.replace(/\/+$/, '');
	}
	const port = (privateEnv.MANGARR_WORKER_PORT ?? DEFAULT_WORKER_PORT).trim() || DEFAULT_WORKER_PORT;
	return `http://127.0.0.1:${port}`;
}

export function getWorkerServiceSecret() {
	const secret = (privateEnv.MANGARR_SERVICE_SECRET ?? '').trim();
	if (!secret) {
		throw new Error('MANGARR_SERVICE_SECRET is not configured');
	}
	return secret;
}

export function buildWorkerInternalHeaders(input?: HeadersInit) {
	const headers = new Headers(input);
	headers.set('x-mangarr-service-secret', getWorkerServiceSecret());
	return headers;
}
