// @ts-check

import fs from 'node:fs';
import path from 'node:path';

const GLOBAL_WEB_LOG_STATE_KEY = '__mangarrWebStructuredLogState';
const DEFAULT_REQUEST_LOG_SLOW_MS = 1_000;
const REQUEST_LOG_SLOW_MS_BY_PATH = new Map([
	['/api/covers/proxy', 10_000],
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
 *   isProbe?: boolean
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
 * @typedef {{
 *   filePath: string | null,
 *   stream: fs.WriteStream | null,
 *   writeErrorReported: boolean
 * }} WebStructuredLogState
 */

function getState() {
	const globals =
		/** @type {typeof globalThis & { [GLOBAL_WEB_LOG_STATE_KEY]?: WebStructuredLogState }} */ (
			globalThis
		);
	if (!globals[GLOBAL_WEB_LOG_STATE_KEY]) {
		globals[GLOBAL_WEB_LOG_STATE_KEY] = {
			filePath: null,
			stream: null,
			writeErrorReported: false
		};
	}
	return globals[GLOBAL_WEB_LOG_STATE_KEY];
}

/**
 * @param {string} pathname
 * @param {string | null | undefined} clientAddress
 */
export function detectWebProbeRequest(pathname, clientAddress) {
	return isLoopbackAddress(clientAddress) && (pathname === '/login' || pathname === '/metrics');
}

/**
 * @param {RequestLogDecision} input
 */
export function shouldLogRequestEvent({ status, durationMs, pathname, isProbe = false }) {
	const slowRequestThresholdMs = requestLogSlowThresholdMs(pathname);
	if (isProbe && status < 400 && durationMs < slowRequestThresholdMs) {
		return false;
	}
	if (status >= 500 || durationMs >= slowRequestThresholdMs) {
		return true;
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
		...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
	};
	writeStructuredEvent(payload);
	if (consoleMessage) {
		writeConsoleLine(level, consoleMessage);
	}
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
 * @param {Record<string, unknown>} payload
 */
function writeStructuredEvent(payload) {
	const state = getState();
	try {
		const stream = getStructuredLogStream(state);
		stream.write(`${JSON.stringify(payload)}\n`);
	} catch (error) {
		if (!state.writeErrorReported) {
			state.writeErrorReported = true;
			writeConsoleLine(
				'error',
				`web structured logging unavailable: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}
}

/**
 * @param {WebStructuredLogState} state
 */
function getStructuredLogStream(state) {
	const filePath = structuredLogPath();
	if (state.stream && state.filePath === filePath) {
		return state.stream;
	}
	if (state.stream) {
		state.stream.end();
	}
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const stream = fs.createWriteStream(filePath, { flags: 'a' });
	stream.on('error', () => {
		state.stream = null;
	});
	state.filePath = filePath;
	state.stream = stream;
	return stream;
}

function structuredLogPath() {
	const explicit = (process.env.MANGARR_WEB_EVENTS_LOG_FILE || '').trim();
	if (explicit) {
		return explicit;
	}
	const logDir =
		(process.env.MANGARR_SYSTEM_LOG_DIR || '').trim() || path.join(process.cwd(), '.mangarr-logs');
	return path.join(logDir, 'web-events.jsonl');
}

/**
 * @param {ServerLogLevel} level
 * @param {string} line
 */
function writeConsoleLine(level, line) {
	switch (level) {
		case 'error':
			console.error(line);
			break;
		case 'warn':
			console.warn(line);
			break;
		default:
			console.info(line);
			break;
	}
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
