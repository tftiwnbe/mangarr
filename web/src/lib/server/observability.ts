import type { RequestEvent } from '@sveltejs/kit';
import {
	detectWebProbeRequest,
	emitWebEvent,
	formatHttpRequestSummary,
	levelForStatus,
	shouldLogRequestEvent
} from '$lib/server/logging.js';

export const REQUEST_ID_HEADER = 'x-request-id';

const REQUEST_ID_MAX_LENGTH = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function normalizeIncomingRequestId(value: string | null | undefined) {
	const trimmed = value?.trim() ?? '';
	if (!trimmed || trimmed.length > REQUEST_ID_MAX_LENGTH || !REQUEST_ID_PATTERN.test(trimmed)) {
		return null;
	}
	return trimmed;
}

export function getOrCreateRequestId(value: string | null | undefined) {
	return normalizeIncomingRequestId(value) ?? crypto.randomUUID();
}

export function withRequestIdHeader(response: Response, requestId: string) {
	const headers = new Headers(response.headers);
	headers.set(REQUEST_ID_HEADER, requestId);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

export function logRequestCompletion(event: RequestEvent, response: Response, startedAt: number) {
	const durationMs = Math.max(0, Date.now() - startedAt);
	const status = response.status;
	const context = requestContext(event);
	if (
		!shouldLogRequestEvent({
			status,
			durationMs,
			pathname: event.url.pathname,
			isProbe: context.isProbe
		})
	) {
		return;
	}
	emitWebEvent(
		levelForStatus(status),
		{
			event: 'http_request_completed',
			request_id: event.locals.requestId,
			method: event.request.method,
			path: event.url.pathname,
			route_id: event.route.id ?? null,
			kind: context.kind,
			status,
			duration_ms: durationMs,
			user_id: event.locals.auth?.user?.id ?? null,
			client_address: context.clientAddress ?? null,
			probe: context.isProbe || undefined
		},
		formatHttpRequestSummary({
			status,
			method: event.request.method,
			pathname: event.url.pathname,
			durationMs,
			requestId: event.locals.requestId,
			kind: context.kind
		})
	);
}

export function logRequestFailure(event: RequestEvent, startedAt: number, cause: unknown) {
	const status =
		typeof cause === 'object' &&
		cause !== null &&
		'status' in cause &&
		typeof cause.status === 'number'
			? cause.status
			: 500;
	const durationMs = Math.max(0, Date.now() - startedAt);
	const context = requestContext(event);
	const error =
		cause instanceof Error
			? {
					error_name: cause.name,
					error_message: cause.message
				}
			: {
					error_name: 'UnknownError',
					error_message: String(cause)
				};
	if (
		!shouldLogRequestEvent({
			status,
			durationMs,
			pathname: event.url.pathname,
			isProbe: context.isProbe
		})
	) {
		return;
	}
	emitWebEvent(
		levelForStatus(status),
		{
			event: 'http_request_failed',
			request_id: event.locals.requestId,
			method: event.request.method,
			path: event.url.pathname,
			route_id: event.route.id ?? null,
			kind: context.kind,
			status,
			duration_ms: durationMs,
			user_id: event.locals.auth?.user?.id ?? null,
			client_address: context.clientAddress ?? null,
			probe: context.isProbe || undefined,
			...error
		},
		formatHttpRequestSummary({
			status,
			method: event.request.method,
			pathname: event.url.pathname,
			durationMs,
			requestId: event.locals.requestId,
			kind: context.kind
		})
	);
}

export function startRequestMetrics(
	event: Pick<RequestEvent, 'route' | 'url' | 'request' | 'getClientAddress'>
) {
	void event;
}

function classifyRequestKind(pathname: string) {
	if (pathname.startsWith('/api/')) {
		return 'api';
	}
	if (pathname.startsWith('/_app/')) {
		return 'asset';
	}
	return 'page';
}

function metricRouteId(event: Pick<RequestEvent, 'route' | 'url'>) {
	if (event.route.id) {
		return event.route.id;
	}
	if (event.url.pathname.startsWith('/_app/')) {
		return '/_app/*';
	}
	return event.url.pathname || '/';
}

function requestContext(
	event: Pick<RequestEvent, 'route' | 'url' | 'request' | 'getClientAddress'>
) {
	const clientAddress = safeGetClientAddress(event);
	return {
		clientAddress,
		isProbe: detectWebProbeRequest(event.url.pathname, clientAddress),
		kind: classifyRequestKind(event.url.pathname),
		route: metricRouteId(event)
	};
}

function safeGetClientAddress(event: Pick<RequestEvent, 'getClientAddress'>) {
	try {
		return event.getClientAddress();
	} catch {
		return null;
	}
}
