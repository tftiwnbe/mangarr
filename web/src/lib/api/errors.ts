export class ApiError extends Error {
	readonly status: number;
	readonly payload: unknown;

	constructor(status: number, payload: unknown, message: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.payload = payload;
	}
}

type ClientResult<T> = {
	data?: T;
	error?: unknown;
	response: Response;
};

function extractErrorMessage(payload: unknown, fallback: string): string {
	if (typeof payload === 'string' && payload.trim().length > 0) {
		return payload;
	}
	if (payload && typeof payload === 'object' && 'detail' in payload) {
		const detail = (payload as { detail?: unknown }).detail;
		if (typeof detail === 'string' && detail.trim().length > 0) {
			return detail;
		}
	}
	return fallback;
}

function toApiError(result: ClientResult<unknown>, fallbackMessage: string): ApiError {
	const payload = result.error ?? null;
	const message = extractErrorMessage(payload, fallbackMessage);
	return new ApiError(result.response.status, payload, message);
}

export function expectData<T>(result: ClientResult<T>, fallbackMessage = 'Request failed'): T {
	if (!result.response.ok || result.error !== undefined) {
		throw toApiError(result, fallbackMessage);
	}
	if (result.data === undefined) {
		throw new ApiError(result.response.status, null, 'Missing response payload');
	}
	return result.data;
}

export function expectNoContent(
	result: ClientResult<unknown>,
	fallbackMessage = 'Request failed'
): void {
	if (!result.response.ok || result.error !== undefined) {
		throw toApiError(result, fallbackMessage);
	}
}
