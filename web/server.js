import http from 'node:http';
import { randomUUID } from 'node:crypto';
import net from 'node:net';

import { handler } from './build/handler.js';
import {
	emitWebEvent,
	formatHttpRequestSummary,
	levelForStatus,
	shouldLogRequestEvent
} from './src/lib/server/logging.js';

const REQUEST_ID_HEADER = 'x-request-id';
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? '3737');
const convexTarget = new URL(
	process.env.CONVEX_URL ?? process.env.CONVEX_SELF_HOSTED_URL ?? 'http://127.0.0.1:3210'
);
const convexAgent = new http.Agent({
	keepAlive: true,
	keepAliveMsecs: 30_000,
	maxSockets: 16
});
const convexPrefix = normalizePrefix(process.env.PUBLIC_CONVEX_PROXY_PREFIX ?? '/convex');
const webviewSocketTarget = new URL(
	process.env.MANGARR_WEBVIEW_SOCKET_URL ?? 'http://127.0.0.1:3213'
);
const webviewSocketPrefix = '/api/internal/bridge/webview/socket';

function normalizePrefix(value) {
	const trimmed = value.trim();
	if (!trimmed || trimmed === '/') {
		return '/convex';
	}
	return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}

function matchProxyPath(url = '/') {
	const path = url.split('?')[0] || '/';
	return path === convexPrefix || path.startsWith(`${convexPrefix}/`);
}

function stripProxyPrefix(url = '/', prefix = convexPrefix) {
	const [path = '/', query = ''] = url.split('?', 2);
	const strippedPath = path === prefix ? '/' : path.slice(prefix.length) || '/';
	return query ? `${strippedPath}?${query}` : strippedPath;
}

function matchWebviewSocketPath(url = '/') {
	return (url.split('?')[0] || '/') === webviewSocketPrefix;
}

function isSameOriginUpgrade(req) {
	const host = req.headers.host;
	const origin = req.headers.origin;
	if (typeof host !== 'string' || typeof origin !== 'string') return false;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}

function readIncomingRequestId(value) {
	const first = Array.isArray(value) ? value[0] : value;
	const trimmed = typeof first === 'string' ? first.trim() : '';
	return trimmed && trimmed.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(trimmed)
		? trimmed
		: null;
}

function getOrCreateRequestId(value) {
	return readIncomingRequestId(value) ?? randomUUID();
}

function proxyHttp(req, res) {
	const requestId = getOrCreateRequestId(req.headers[REQUEST_ID_HEADER]);
	const startedAt = Date.now();
	const upstreamPath = stripProxyPrefix(req.url);
	res.setHeader(REQUEST_ID_HEADER, requestId);
	res.once('finish', () => {
		const status = res.statusCode || 500;
		const durationMs = Math.max(0, Date.now() - startedAt);
		const pathname = req.url?.split('?')[0] || '/';
		if (!shouldLogRequestEvent({ status, durationMs, pathname, requestId })) {
			return;
		}
		emitWebEvent(
			levelForStatus(status),
			{
				event: 'convex_proxy_request_completed',
				request_id: requestId,
				method: req.method,
				path: pathname,
				target_path: upstreamPath.split('?')[0] || '/',
				status,
				duration_ms: durationMs
			},
			formatHttpRequestSummary({
				status,
				method: req.method || 'GET',
				pathname,
				durationMs,
				requestId,
				kind: 'convex_proxy'
			})
		);
	});

	const upstream = http.request(
		{
			protocol: convexTarget.protocol,
			hostname: convexTarget.hostname,
			port: convexTarget.port,
			method: req.method,
			path: upstreamPath,
			headers: {
				...req.headers,
				host: convexTarget.host,
				[REQUEST_ID_HEADER]: requestId
			},
			agent: convexAgent
		},
		(upstreamRes) => {
			res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
			upstreamRes.pipe(res);
		}
	);

	upstream.on('error', () => {
		if (!res.headersSent) {
			res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
		}
		res.end('Convex proxy is unavailable');
	});

	req.on('aborted', () => upstream.destroy());
	req.pipe(upstream);
}

function proxyUpgrade(
	req,
	socket,
	head,
	{ target = convexTarget, prefix = convexPrefix, upstreamPath, kind = 'convex' } = {}
) {
	const requestId = getOrCreateRequestId(req.headers[REQUEST_ID_HEADER]);
	const pathname = req.url?.split('?')[0] || '/';
	let failureLogged = false;
	const upstream = net.connect(Number(target.port || 80), target.hostname, () => {
		const lines = [
			`${req.method} ${upstreamPath ?? stripProxyPrefix(req.url, prefix)} HTTP/${req.httpVersion}`
		];
		for (const [name, rawValue] of Object.entries(req.headers)) {
			if (rawValue == null) continue;
			if (name.toLowerCase() === REQUEST_ID_HEADER) continue;
			if (kind === 'webview' && ['cookie', 'authorization'].includes(name.toLowerCase())) continue;
			const value = Array.isArray(rawValue) ? rawValue.join(', ') : rawValue;
			lines.push(`${name}: ${name.toLowerCase() === 'host' ? target.host : value}`);
		}
		lines.push(`${REQUEST_ID_HEADER}: ${requestId}`);
		lines.push('', '');
		upstream.write(lines.join('\r\n'));
		if (head.length > 0) {
			upstream.write(head);
		}
		socket.pipe(upstream).pipe(socket);
	});

	const logUpgradeFailure = (source, error) => {
		if (failureLogged) {
			return;
		}
		failureLogged = true;
		emitWebEvent(
			'warn',
			{
				event: `${kind}_proxy_upgrade_failed`,
				request_id: requestId,
				method: req.method,
				path: pathname,
				source,
				error_message: error instanceof Error ? error.message : String(error)
			},
			`${kind} upgrade failed ${req.method || 'GET'} ${pathname} req=${requestId}`
		);
	};

	const destroyBoth = () => {
		upstream.destroy();
		socket.destroy();
	};

	upstream.on('error', (error) => {
		logUpgradeFailure('upstream', error);
		destroyBoth();
	});
	socket.on('error', (error) => {
		logUpgradeFailure('socket', error);
		destroyBoth();
	});
}

const server = http.createServer((req, res) => {
	if (matchProxyPath(req.url)) {
		proxyHttp(req, res);
		return;
	}
	handler(req, res);
});

server.on('upgrade', (req, socket, head) => {
	if (matchProxyPath(req.url)) {
		proxyUpgrade(req, socket, head);
		return;
	}
	if (matchWebviewSocketPath(req.url) && isSameOriginUpgrade(req)) {
		proxyUpgrade(req, socket, head, {
			target: webviewSocketTarget,
			prefix: webviewSocketPrefix,
			upstreamPath: '/webview',
			kind: 'webview'
		});
		return;
	}
	socket.destroy();
});

server.listen(port, host, () => {
	emitWebEvent(
		'info',
		{
			event: 'server_started',
			host,
			port
		},
		`server started http://${host}:${port}`
	);
});
