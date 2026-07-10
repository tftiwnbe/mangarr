// @ts-check

const DEFAULT_REQUEST_LOG_SLOW_MS = 1_000;
const SUCCESSFUL_REQUEST_SAMPLE_RATE = 100;
const REQUEST_LOG_SLOW_MS_BY_PATH = new Map([
	['/api/covers/proxy', 10_000],
	['/api/internal/bridge/library/page', 5_000],
	['/api/internal/bridge/reader/page', 5_000]
]);
const KNOWN_BROWSER_PROBE_404_PATHS = new Set([
	'/apple-touch-icon.png',
	'/apple-touch-icon-precomposed.png',
	'/favicon.ico'
]);

/**
 * @typedef {{
 *   status: number,
 *   durationMs: number,
 *   pathname: string,
 *   isProbe?: boolean,
 *   requestId?: string | null
 * }} RequestLogDecision
 */

/**
 * @typedef {{
 *   status: number,
 *   method: string,
 *   pathname: string,
 *   durationMs: number,
 *   requestId?: string | null,
 *   kind?: string | null
 * }} HttpRequestSummary
 */

/**
 * @typedef {'info' | 'warn' | 'error'} ServerLogLevel
 */

/**
 * @typedef {Record<string, boolean | number | string | null | undefined>} ServerLogFields
 */

/**
 * @param {string} pathname
 * @param {string | null | undefined} clientAddress
 */
export function detectWebProbeRequest(pathname, clientAddress) {
	return isLoopbackAddress(clientAddress) && pathname === '/login';
}

/**
 * @param {RequestLogDecision} input
 */
export function shouldLogRequestEvent({
	status,
	durationMs,
	pathname,
	isProbe = false,
	requestId
}) {
	const slowRequestThresholdMs = requestLogSlowThresholdMs(pathname);
	if (isProbe && status < 400 && durationMs < slowRequestThresholdMs) {
		return false;
	}
	if (status >= 500 || durationMs >= slowRequestThresholdMs) {
		return true;
	}
	if (status >= 200 && status < 300) {
		return !isProbe && shouldSampleSuccessfulRequest(requestId);
	}
	if (status < 400) {
		return false;
	}
	if (status === 404 && KNOWN_BROWSER_PROBE_404_PATHS.has(pathname)) {
		return false;
	}
	return true;
}

/**
 * Deterministically retain one in every 100 ordinary successful requests.
 * The request ID makes repeated handling of the same request make the same decision.
 *
 * @param {string | null | undefined} requestId
 */
function shouldSampleSuccessfulRequest(requestId) {
	if (!requestId) {
		return false;
	}

	let hash = 2_166_136_261;
	for (let index = 0; index < requestId.length; index += 1) {
		hash ^= requestId.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return (hash >>> 0) % SUCCESSFUL_REQUEST_SAMPLE_RATE === 0;
}

/**
 * @param {string} pathname
 */
function requestLogSlowThresholdMs(pathname) {
	return REQUEST_LOG_SLOW_MS_BY_PATH.get(pathname) ?? DEFAULT_REQUEST_LOG_SLOW_MS;
}

/**
 * @param {number} status
 * @returns {ServerLogLevel}
 */
export function levelForStatus(status) {
	if (status >= 500) {
		return 'error';
	}
	if (status >= 400) {
		return 'warn';
	}
	return 'info';
}

/**
 * @param {ServerLogLevel} level
 * @param {ServerLogFields} fields
 * @param {string | null | undefined} [consoleMessage]
 */
export function emitWebEvent(level, fields, consoleMessage = null) {
	const payload = {
		timestamp: new Date().toISOString(),
		level,
		service: 'web',
		component: 'web',
		...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
	};
	void consoleMessage;
	writeStructuredEvent(payload);
	return payload;
}

/**
 * @param {HttpRequestSummary} input
 */
export function formatHttpRequestSummary({
	status,
	method,
	pathname,
	durationMs,
	requestId,
	kind
}) {
	const kindPrefix = kind ? `${kind} ` : '';
	const requestSuffix = requestId ? ` req=${requestId}` : '';
	return `${kindPrefix}http ${status} ${method.toUpperCase()} ${pathname} ${durationMs}ms${requestSuffix}`;
}

/**
 * @param {{ level: ServerLogLevel } & Record<string, unknown>} payload
 */
function writeStructuredEvent(payload) {
	const stream = levelToStream(payload.level);
	stream.write(`${JSON.stringify(payload)}\n`);
}

/**
 * @param {ServerLogLevel} level
 */
function levelToStream(level) {
	return level === 'error' || level === 'warn' ? process.stderr : process.stdout;
}

/**
 * @param {string | null | undefined} value
 */
function isLoopbackAddress(value) {
	const normalized = String(value || '')
		.trim()
		.toLowerCase();
	return (
		normalized === '127.0.0.1' ||
		normalized === '::1' ||
		normalized === '::ffff:127.0.0.1' ||
		normalized.startsWith('127.')
	);
}
