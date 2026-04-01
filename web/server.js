import http from 'node:http';
import net from 'node:net';

import { handler } from './build/handler.js';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? '3737');
const convexTarget = new URL(
	process.env.CONVEX_URL ?? process.env.CONVEX_SELF_HOSTED_URL ?? 'http://127.0.0.1:3210'
);
const convexPrefix = normalizePrefix(process.env.PUBLIC_CONVEX_PROXY_PREFIX ?? '/convex');

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

function stripProxyPrefix(url = '/') {
	const [path = '/', query = ''] = url.split('?', 2);
	const strippedPath = path === convexPrefix ? '/' : path.slice(convexPrefix.length) || '/';
	return query ? `${strippedPath}?${query}` : strippedPath;
}

function proxyHttp(req, res) {
	const upstream = http.request(
		{
			protocol: convexTarget.protocol,
			hostname: convexTarget.hostname,
			port: convexTarget.port,
			method: req.method,
			path: stripProxyPrefix(req.url),
			headers: {
				...req.headers,
				host: convexTarget.host
			}
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

function proxyUpgrade(req, socket, head) {
	const upstream = net.connect(Number(convexTarget.port || 80), convexTarget.hostname, () => {
		const lines = [`${req.method} ${stripProxyPrefix(req.url)} HTTP/${req.httpVersion}`];
		for (const [name, rawValue] of Object.entries(req.headers)) {
			if (rawValue == null) continue;
			const value = Array.isArray(rawValue) ? rawValue.join(', ') : rawValue;
			lines.push(`${name}: ${name.toLowerCase() === 'host' ? convexTarget.host : value}`);
		}
		lines.push('', '');
		upstream.write(lines.join('\r\n'));
		if (head.length > 0) {
			upstream.write(head);
		}
		socket.pipe(upstream).pipe(socket);
	});

	const destroyBoth = () => {
		upstream.destroy();
		socket.destroy();
	};

	upstream.on('error', destroyBoth);
	socket.on('error', destroyBoth);
}

const server = http.createServer((req, res) => {
	if (matchProxyPath(req.url)) {
		proxyHttp(req, res);
		return;
	}
	handler(req, res);
});

server.on('upgrade', (req, socket, head) => {
	if (!matchProxyPath(req.url)) {
		socket.destroy();
		return;
	}
	proxyUpgrade(req, socket, head);
});

server.listen(port, host, () => {
	console.log(`Listening on http://${host}:${port}`);
});
