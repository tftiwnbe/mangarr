import type { Handle } from '@sveltejs/kit';
import { resolveAuthState } from '$lib/server/auth';
import {
	getOrCreateRequestId,
	logRequestCompletion,
	logRequestFailure,
	REQUEST_ID_HEADER,
	withRequestIdHeader
} from '$lib/server/observability';

export const handle: Handle = async ({ event, resolve }) => {
	const startedAt = Date.now();
	event.locals.requestId = getOrCreateRequestId(event.request.headers.get(REQUEST_ID_HEADER));
	try {
		event.locals.auth = await resolveAuthState(event);
		const response = await resolve(event);
		const responseWithRequestId = withRequestIdHeader(response, event.locals.requestId);
		logRequestCompletion(event, responseWithRequestId, startedAt);
		return responseWithRequestId;
	} catch (cause) {
		logRequestFailure(event, startedAt, cause);
		throw cause;
	}
};
