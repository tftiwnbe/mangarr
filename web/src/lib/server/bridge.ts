import { env as privateEnv } from '$env/dynamic/private';

const DEFAULT_BRIDGE_PORT = '3212';

export function getBridgeBaseUrl() {
	const explicitUrl = (privateEnv.MANGARR_BRIDGE_INTERNAL_URL ?? '').trim();
	if (explicitUrl) {
		return explicitUrl.replace(/\/+$/, '');
	}
	const port =
		(privateEnv.MANGARR_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT).trim() || DEFAULT_BRIDGE_PORT;
	return `http://127.0.0.1:${port}`;
}

export function getBridgeServiceSecret() {
	const secret = (privateEnv.MANGARR_SERVICE_SECRET ?? '').trim();
	if (!secret) {
		throw new Error('MANGARR_SERVICE_SECRET is not configured');
	}
	return secret;
}

export function buildBridgeInternalHeaders(input?: HeadersInit) {
	const headers = new Headers(input);
	headers.set('x-mangarr-service-secret', getBridgeServiceSecret());
	return headers;
}
