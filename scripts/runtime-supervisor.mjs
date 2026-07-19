#!/usr/bin/env node

import { randomBytes, createHash, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';

const requireFromWeb = createRequire(new URL('../web/package.json', import.meta.url));

const state = {
	children: new Map(),
	shuttingDown: false,
	intervals: new Set(),
	exitCode: 0
};

main().catch((error) => {
	emitEvent('error', 'runtime.supervisor_failed', error instanceof Error ? error.message : String(error), {
		error_name: error instanceof Error ? error.name : 'Error'
	});
	process.exit(1);
});

async function main() {
	registerSignalHandlers();

	const env = buildRuntimeEnv(process.env);

	ensureDevelopmentWebDependencies(env);
	await prepareRuntime(env);
	await prepareKcefRuntime(env);

	const convex = startManagedProcess('convex', env.convexCommand, env.childEnv, routeConvexLine);
	await waitForHttp('Convex backend', `http://127.0.0.1:${env.convexPort}/version`);
	await synchronizeConvexRuntime(env);

	const bridge = startManagedProcess('bridge', env.bridgeCommand, env.childEnv, routeBridgeLine);
	await waitForHttp('Bridge runtime', `http://127.0.0.1:${env.bridgePort}/health`);

	const web = startManagedProcess('web', env.webCommand, env.childEnv, routeGenericLine);
	await waitForHttp('Web app', `http://127.0.0.1:${env.webPort}`);

	emitEvent('info', 'runtime.ready', 'Mangarr ready', {
		web_url: env.publicOrigin,
		convex_url: env.publicConvexUrl,
		bridge_url: env.bridgeInternalUrl
	});

	await Promise.race([convex.done, bridge.done, web.done]);
	await shutdown();
	process.exit(state.exitCode);
}

function buildRuntimeEnv(input) {
	const root = {
		convexInternalUrl: readVar(input, ['CONVEX_URL', 'CONVEX_SELF_HOSTED_URL'], 'http://127.0.0.1:3210'),
		convexRoot: readVar(input, ['CONVEX_ROOT'], '/app/config/convex'),
		convexStorageDir: readVar(input, ['CONVEX_STORAGE_DIR'], null),
		convexTmpDir: readVar(input, ['CONVEX_TMP_DIR'], null),
		convexPostgresUrl: readVar(input, ['CONVEX_POSTGRES_URL'], ''),
		instanceName: readVar(input, ['INSTANCE_NAME'], 'mangarr'),
		bridgeHost: readVar(input, ['MANGARR_BRIDGE_HOST'], '127.0.0.1'),
		bridgePort: Number.parseInt(readVar(input, ['MANGARR_BRIDGE_PORT'], '3212'), 10),
		bridgeDataDir: readVar(input, ['MANGARR_BRIDGE_DATA_DIR'], '/app/config/bridge'),
		downloadsDir: readVar(input, ['MANGARR_DOWNLOADS_DIR'], '/app/downloads'),
		publicUrl: readVar(input, ['MANGARR_PUBLIC_URL'], 'http://127.0.0.1:3737'),
		logRoot: readVar(input, ['MANGARR_LOG_ROOT'], '/app/config/logs'),
		systemLogDir: readVar(input, ['MANGARR_SYSTEM_LOG_DIR'], null),
		bridgeLogDir: readVar(input, ['MANGARR_BRIDGE_LOG_DIR'], null),
		authIssuer: readVar(input, ['MANGARR_CONVEX_AUTH_ISSUER'], 'https://auth.mangarr.local/convex'),
		authApplicationId: readVar(input, ['MANGARR_CONVEX_AUTH_APPLICATION_ID'], 'mangarr-web'),
		authTokenTtlSeconds: readVar(input, ['MANGARR_CONVEX_AUTH_TOKEN_TTL_SECONDS'], '3600'),
		authKeyId: readVar(input, ['MANGARR_CONVEX_AUTH_KEY_ID'], 'mangarr-20260310'),
		kcefEnabled: truthy(readVar(input, ['MANGARR_KCEF_ENABLED'], 'true')),
		xvfbDisplay: readVar(input, ['MANGARR_XVFB_DISPLAY'], ':99'),
		appMode: readVar(input, ['MANGARR_APP_MODE'], 'prod'),
		rustLog: readVar(input, ['RUST_LOG'], 'error,database::search_index_workers::retriable_worker=off'),
		bridgeId: readVar(input, ['MANGARR_BRIDGE_ID'], 'main'),
		bridgeHeartbeatIntervalMs: readVar(input, ['MANGARR_BRIDGE_HEARTBEAT_INTERVAL_MS'], '15000'),
		bridgeCommandPollIntervalMs: readVar(input, ['MANGARR_BRIDGE_COMMAND_POLL_INTERVAL_MS'], '350'),
		bridgeCommandLeaseDurationMs: readVar(input, ['MANGARR_BRIDGE_COMMAND_LEASE_DURATION_MS'], '30000'),
		webPort: Number.parseInt(readVar(input, ['PORT'], '3737'), 10),
		host: readVar(input, ['HOST'], '0.0.0.0'),
		forceConvexSync: readVar(input, ['MANGARR_FORCE_CONVEX_SYNC'], '0') === '1'
	};

	root.convexPort = Number.parseInt(readVar(input, ['CONVEX_PORT'], '3210'), 10);
	root.convexSiteProxyPort = Number.parseInt(readVar(input, ['CONVEX_SITE_PROXY_PORT'], '3211'), 10);
	root.convexStorageDir ??= `${root.convexRoot}/storage`;
	root.convexTmpDir ??= `${root.convexRoot}/tmp`;
	root.systemLogDir ??= `${root.logRoot}/system`;
	root.bridgeLogDir ??= `${root.logRoot}/bridge`;
	root.bridgeInternalUrl = readVar(input, ['MANGARR_BRIDGE_INTERNAL_URL'], `http://127.0.0.1:${root.bridgePort}`);
	root.webViewPort = Number.parseInt(readVar(input, ['MANGARR_WEBVIEW_PORT'], String(root.bridgePort + 1)), 10);
	root.webViewSocketUrl = readVar(input, ['MANGARR_WEBVIEW_SOCKET_URL'], `http://127.0.0.1:${root.webViewPort}`);

	if (!root.convexPostgresUrl.trim()) {
		emitEvent('error', 'runtime.configuration_error', 'CONVEX_POSTGRES_URL must be set for the Postgres-backed Convex runtime.');
		process.exit(1);
	}

	const site = new URL(root.publicUrl);
	site.pathname = '/';
	site.search = '';
	site.hash = '';
	root.publicOrigin = site.toString().replace(/\/$/, '');
	root.publicConvexUrl = readVar(input, ['PUBLIC_CONVEX_URL'], new URL('/convex', root.publicOrigin).toString().replace(/\/$/, ''));
	root.convexSiteOrigin = readVar(input, ['CONVEX_SITE_ORIGIN'], root.publicOrigin);

	return root;
}

async function prepareRuntime(env) {
	mkdirSync(env.convexRoot, { recursive: true });
	mkdirSync(env.convexStorageDir, { recursive: true });
	mkdirSync(env.convexTmpDir, { recursive: true });
	mkdirSync(env.systemLogDir, { recursive: true });
	mkdirSync(env.bridgeLogDir, { recursive: true });
	mkdirSync(env.downloadsDir, { recursive: true });

	const instanceSecret = ensureHexSecret(join(env.convexRoot, 'instance_secret'));
	const serviceSecret = readVar(process.env, ['MANGARR_SERVICE_SECRET'], ensureHexSecret(join(env.convexRoot, 'service_secret')));
	const authPrivateJwk = ensureJwk(join(env.convexRoot, 'auth_private_jwk.json'));

	writeFileSync('/app/web/.env.local', '');

	const adminKey = generateAdminKey(env.instanceName, instanceSecret);
	if (env.appMode === 'dev') {
		emitEvent('info', 'runtime.dev_mode', 'Convex dev admin key generated');
	}

	const vapid = ensureVapid(join(env.convexRoot, 'web_push_vapid.json'), env.publicOrigin);
	const childEnv = {
		...process.env,
		HOST: env.host,
		PORT: String(env.webPort),
		PUBLIC_CONVEX_URL: env.publicConvexUrl,
		CONVEX_URL: env.convexInternalUrl,
		CONVEX_SELF_HOSTED_URL: env.convexInternalUrl,
		CONVEX_ADMIN_KEY: adminKey,
		CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
		MANGARR_SERVICE_SECRET: serviceSecret,
		MANGARR_BRIDGE_HOST: env.bridgeHost,
		MANGARR_BRIDGE_PORT: String(env.bridgePort),
		MANGARR_WEBVIEW_PORT: String(env.webViewPort),
		MANGARR_WEBVIEW_SOCKET_URL: env.webViewSocketUrl,
		MANGARR_BRIDGE_INTERNAL_URL: env.bridgeInternalUrl,
		MANGARR_BRIDGE_DATA_DIR: env.bridgeDataDir,
		MANGARR_BRIDGE_ID: env.bridgeId,
		MANGARR_BRIDGE_HEARTBEAT_INTERVAL_MS: env.bridgeHeartbeatIntervalMs,
		MANGARR_BRIDGE_COMMAND_POLL_INTERVAL_MS: env.bridgeCommandPollIntervalMs,
		MANGARR_BRIDGE_COMMAND_LEASE_DURATION_MS: env.bridgeCommandLeaseDurationMs,
		MANGARR_DOWNLOADS_DIR: env.downloadsDir,
		MANGARR_PUBLIC_URL: env.publicOrigin,
		MANGARR_CONVEX_AUTH_ISSUER: env.authIssuer,
		MANGARR_CONVEX_AUTH_APPLICATION_ID: env.authApplicationId,
		MANGARR_CONVEX_AUTH_TOKEN_TTL_SECONDS: env.authTokenTtlSeconds,
		MANGARR_CONVEX_AUTH_KEY_ID: env.authKeyId,
		MANGARR_CONVEX_AUTH_PRIVATE_JWK: authPrivateJwk,
		MANGARR_KCEF_ENABLED: String(env.kcefEnabled),
		MANGARR_LOG_ROOT: env.logRoot,
		MANGARR_SYSTEM_LOG_DIR: env.systemLogDir,
		MANGARR_BRIDGE_LOG_DIR: env.bridgeLogDir,
		MANGARR_WEB_PUSH_VAPID_PUBLIC_KEY: vapid.publicKey,
		MANGARR_WEB_PUSH_VAPID_PRIVATE_KEY: vapid.privateKey,
		MANGARR_WEB_PUSH_SUBJECT: vapid.subject,
		TACHIBRIDGE_JAR_PATH: readVar(process.env, ['TACHIBRIDGE_JAR_PATH'], '/app/bin/tachibridge.jar'),
		LD_LIBRARY_PATH: `/opt/java/openjdk/lib/server:/opt/java/openjdk/lib:${process.env.LD_LIBRARY_PATH ?? ''}`.replace(/:$/, ''),
		RUST_LOG: env.rustLog
	};

	Object.assign(env, {
		instanceSecret,
		serviceSecret,
		authPrivateJwk,
		adminKey,
		vapid,
		childEnv,
		webCommand: env.appMode === 'dev' ? { cmd: 'pnpm', args: ['run', 'dev'], cwd: '/app/web' } : { cmd: 'node', args: ['server.js'], cwd: '/app/web' },
		bridgeCommand: { cmd: 'java', args: ['-jar', childEnv.TACHIBRIDGE_JAR_PATH, '--port', String(env.bridgePort), '--data-dir', env.bridgeDataDir], cwd: '/app' },
		convexCommand: {
			cmd: '/app/convex/convex-local-backend',
			args: [
				'--db', 'postgres-v5',
				'--instance-name', env.instanceName,
				'--instance-secret', instanceSecret,
				'--port', String(env.convexPort),
				'--site-proxy-port', String(env.convexSiteProxyPort),
				// Node actions call back into this origin for ctx.runQuery/runMutation.
				// Keep that path internal; the browser still uses PUBLIC_CONVEX_URL.
				'--convex-origin', env.convexInternalUrl,
				'--convex-site', env.convexSiteOrigin,
				'--beacon-tag', 'mangarr',
				'--disable-beacon',
				'--do-not-require-ssl',
				'--local-storage', env.convexStorageDir,
				env.convexPostgresUrl
			],
			cwd: '/app'
		}
	});
}

async function synchronizeConvexRuntime(env) {
	const fingerprintPath = join(env.convexRoot, 'convex_sync_fingerprint');
	const fingerprint = computeConvexSyncFingerprint(env);
	let syncRequired = env.forceConvexSync || !existsSync(fingerprintPath);
	if (!syncRequired && readFileSync(fingerprintPath, 'utf8').trim() !== fingerprint) {
		syncRequired = true;
	}

	if (!syncRequired) {
		emitEvent('info', 'runtime.convex_sync_skipped', 'Convex runtime inputs unchanged; skipping function sync');
		return;
	}

	emitEvent('info', 'runtime.convex_sync_started', 'Syncing Convex runtime functions');
	for (const [key, value] of [
		['MANGARR_PUBLIC_URL', env.publicOrigin],
		['MANGARR_CONVEX_AUTH_ISSUER', env.authIssuer],
		['MANGARR_CONVEX_AUTH_APPLICATION_ID', env.authApplicationId],
		['MANGARR_CONVEX_AUTH_KEY_ID', env.authKeyId],
		['MANGARR_CONVEX_AUTH_PRIVATE_JWK', env.authPrivateJwk],
		['MANGARR_SERVICE_SECRET', env.serviceSecret],
		['MANGARR_BRIDGE_INTERNAL_URL', env.bridgeInternalUrl],
		['MANGARR_WEB_PUSH_VAPID_PUBLIC_KEY', env.vapid.publicKey],
		['MANGARR_WEB_PUSH_VAPID_PRIVATE_KEY', env.vapid.privateKey],
		['MANGARR_WEB_PUSH_SUBJECT', env.vapid.subject]
	]) {
		runCommand({ cmd: 'pnpm', args: ['exec', 'convex', 'env', 'set', key, value], cwd: '/app/web', env: env.childEnv, quiet: true });
	}

	if (existsSync('/app/web/node_modules/.bin/svelte-kit')) {
		runCommand({ cmd: 'pnpm', args: ['exec', 'svelte-kit', 'sync'], cwd: '/app/web', env: env.childEnv, routeAs: 'runtime' });
	}

	runCommand({
		cmd: 'pnpm',
		args: ['exec', 'convex', 'dev', '--once', '--typecheck', 'disable', '--codegen', 'disable'],
		cwd: '/app/web',
		env: env.childEnv,
		routeAs: 'runtime'
	});

	writeFileSync(fingerprintPath, fingerprint);
	chmodSync(fingerprintPath, 0o600);
	emitEvent('info', 'runtime.convex_sync_completed', 'Convex runtime sync completed');
}

async function prepareKcefRuntime(env) {
	const kcefLibraryDir = readVar(process.env, ['KCEF_INSTALL_DIR'], `${env.bridgeDataDir}/bin/kcef`);
	const kcefCacheDir = `${env.bridgeDataDir}/cache/kcef`;
	const javaLibraryPath = `${kcefLibraryDir}:/usr/lib/jni:/opt/java/openjdk/lib/server:/opt/java/openjdk/lib:/usr/lib:/lib`;

	env.childEnv.KCEF_LIBRARY_DIR = kcefLibraryDir;
	env.childEnv.KCEF_CACHE_DIR = kcefCacheDir;
	env.childEnv.LD_LIBRARY_PATH = `${kcefLibraryDir}:/usr/lib/jni:/opt/java/openjdk/lib/server:/opt/java/openjdk/lib:${process.env.LD_LIBRARY_PATH ?? ''}`.replace(/:$/, '');
	env.childEnv.JAVA_TOOL_OPTIONS = `${process.env.JAVA_TOOL_OPTIONS ? `${process.env.JAVA_TOOL_OPTIONS} ` : ''}-Djava.library.path=${javaLibraryPath}`;
	env.childEnv.CHROME_DEVEL_SANDBOX = `${kcefLibraryDir}/chrome-sandbox`;

	if (existsSync('/usr/bin/dbus-daemon') || existsSync('/bin/dbus-daemon')) {
		mkdirSync('/run/dbus', { recursive: true });
		runCommand({ cmd: 'dbus-daemon', args: ['--system', '--fork', '--nopidfile'], cwd: '/app', allowFailure: true, quiet: true });
		env.childEnv.DBUS_SESSION_BUS_ADDRESS = readVar(process.env, ['DBUS_SESSION_BUS_ADDRESS'], 'unix:path=/run/dbus/system_bus_socket');
	}

	if (!env.kcefEnabled) {
		return;
	}

	if (commandExists('Xvfb')) {
		mkdirSync('/tmp/.X11-unix', { recursive: true });
		env.childEnv.DISPLAY = readVar(process.env, ['DISPLAY'], env.xvfbDisplay);
		const displayNumber = env.childEnv.DISPLAY.replace(/^:/, '');
		runCommand({ cmd: 'pkill', args: ['-f', `Xvfb ${env.childEnv.DISPLAY}`], cwd: '/app', allowFailure: true, quiet: true });
		rmSync(`/tmp/.X${displayNumber}-lock`, { force: true });
		rmSync(`/tmp/.X11-unix/X${displayNumber}`, { force: true });
		startManagedProcess('xvfb', { cmd: 'Xvfb', args: [env.childEnv.DISPLAY, '-screen', '0', '1920x1080x24', '-nolisten', 'tcp', '-ac'], cwd: '/app' }, env.childEnv, routeAuxiliaryLine);
	}

	mkdirSync(kcefCacheDir, { recursive: true });
	for (const entry of readdirSafe(kcefCacheDir)) {
		if (entry.startsWith('Singleton')) {
			rmSync(join(kcefCacheDir, entry), { recursive: true, force: true });
		}
	}

	syncKcefRuntimeFiles(kcefLibraryDir);
	const interval = setInterval(() => syncKcefRuntimeFiles(kcefLibraryDir), 1_000);
	state.intervals.add(interval);
	writeJcefHelper(kcefLibraryDir);
}

function routeConvexLine(component, stream, line) {
	if (stream === 'stderr') {
		if (line.includes('ValidationError(Expired(')) return null;
		if ((line.includes('cron_commit_mutation') || line.includes('finish_push')) && line.includes('_modules.by_path')) return null;
	}
	const parsed = parseConvexPlainLine(component, stream, line);
	if (parsed) {
		return parsed;
	}
	return routeGenericLine(component, stream, line);
}

function routeBridgeLine(component, stream, line) {
	if (
		line.startsWith('Picked up JAVA_TOOL_OPTIONS:') ||
		line.includes('dbus/object_proxy.cc:590') && line.includes('UPower') ||
		line.includes('Failed to connect to the bus:') ||
		line.includes('dbus/bus.cc') ||
		line.includes('gpu_process_host.cc') ||
		line.includes('gpu_memory_buffer_support_x11.cc') ||
		line.includes('viz_main_impl.cc') ||
		line.includes('ssl_client_socket_impl.cc') ||
		line.includes('ui/gfx/x/connection.cc') ||
		(line.startsWith('JCEF_') || line.startsWith('JCEF(')) &&
			!/(?:error|failed|exception|can't)/i.test(line) ||
		line.startsWith('CEF Version =') ||
		line.startsWith('Chromium Version =')
	) {
		return null;
	}
	return routeGenericLine(component, stream, line);
}

function routeAuxiliaryLine(component, stream, line) {
	return wrapPlainLine(component, stream, line, stream === 'stderr' ? 'warn' : 'info', 'process.output');
}

function routeGenericLine(component, stream, line) {
	const cleanedLine = stripAnsi(line);
	const parsed = parseObjectJson(cleanedLine);
	if (parsed) {
		const payload = { ...parsed };
		payload.timestamp = stringValue(parsed.timestamp) || new Date().toISOString();
		payload.level = normalizeLevel(parsed.level ?? (stream === 'stderr' ? 'warn' : 'info'));
		payload.service = parsed.service ?? component;
		payload.component = parsed.component ?? component;
		payload.stream = parsed.stream ?? stream;
		if (!payload.event) {
			payload.event = 'process.output';
		}
		return payload;
	}
	return wrapPlainLine(
		component,
		stream,
		cleanedLine,
		inferPlaintextLevel(cleanedLine, stream),
		'process.output'
	);
}

function parseConvexPlainLine(component, stream, line) {
	const cleaned = stripAnsi(line).trim();
	if (!cleaned) {
		return null;
	}

	const rustLogMatch = cleaned.match(
		/^(?<timestamp>\d{4}-\d{2}-\d{2}T\S+)\s+(?<level>TRACE|DEBUG|INFO|WARN|ERROR)\s+(?<logger>[A-Za-z0-9_.:]+):\s+(?<message>.+)$/
	);
	if (rustLogMatch?.groups?.message) {
		const message = rustLogMatch.groups.message.trim();
		return {
			timestamp: rustLogMatch.groups.timestamp,
			level: normalizeLevel(rustLogMatch.groups.level),
			service: 'convex',
			component,
			stream,
			event: inferConvexRustEvent(rustLogMatch.groups.logger, message),
			logger: rustLogMatch.groups.logger,
			message
		};
	}

	const tempdirMatch = cleaned.match(/^Node executor using tempdir: (?<tempdir>.+)$/);
	if (tempdirMatch?.groups?.tempdir) {
		return {
			timestamp: new Date().toISOString(),
			level: 'info',
			service: 'convex',
			component,
			stream,
			event: 'convex.executor.tempdir',
			message: 'Convex node executor tempdir selected',
			tempdir: tempdirMatch.groups.tempdir
		};
	}

	const socketMatch = cleaned.match(/^Node executor server listening on path (?<socket_path>.+)$/);
	if (socketMatch?.groups?.socket_path) {
		return {
			timestamp: new Date().toISOString(),
			level: 'info',
			service: 'convex',
			component,
			stream,
			event: 'convex.executor.socket_ready',
			message: 'Convex node executor socket ready',
			socket_path: socketMatch.groups.socket_path
		};
	}

	return null;
}

function inferConvexRustEvent(logger, message) {
	if (logger === 'common::errors' && message.includes('terminating connection due to administrator command')) {
		return 'convex.postgres.connection_terminated';
	}
	return 'convex.process.output';
}

function wrapPlainLine(component, stream, line, level, event) {
	const trimmed = line.trim();
	if (!trimmed) {
		return null;
	}
	return {
		timestamp: new Date().toISOString(),
		level: normalizeLevel(level),
		service: component === 'runtime' || component === 'xvfb' ? 'runtime' : component,
		component,
		stream,
		event,
		message: trimmed
	};
}

function inferPlaintextLevel(line, stream) {
	const normalized = line.trim();
	if (/\b(ERROR|FATAL)\b/.test(normalized)) {
		return 'error';
	}
	if (/\bWARN(ING)?\b/.test(normalized)) {
		return 'warn';
	}
	if (/\b(INFO|DEBUG|TRACE)\b/.test(normalized)) {
		return 'info';
	}
	return stream === 'stderr' ? 'warn' : 'info';
}

function startManagedProcess(name, command, env, router) {
	const child = spawn(command.cmd, command.args, {
		cwd: command.cwd,
		env,
		stdio: ['ignore', 'pipe', 'pipe']
	});

	const done = new Promise((resolveDone) => {
		child.once('exit', (code, signal) => {
			state.children.delete(name);
			const unexpected = !state.shuttingDown;
			emitEvent(unexpected ? 'error' : 'info', 'runtime.process_exited', `${name} exited`, {
				component_name: name,
				exit_code: code,
				signal: signal ?? null,
				unexpected
			});
			if (unexpected) {
				state.exitCode = code ?? 1;
				void shutdown();
			}
			resolveDone({ code, signal });
		});
	});

	state.children.set(name, child);
	attachLineReader(child.stdout, (line) => maybeEmit(router(name, 'stdout', line)));
	attachLineReader(child.stderr, (line) => maybeEmit(router(name, 'stderr', line)));

	emitEvent('info', 'runtime.process_started', `${name} started`, {
		component_name: name,
		command: [command.cmd, ...command.args].join(' ')
	});

	return { child, done };
}

function attachLineReader(stream, onLine) {
	let buffer = '';
	stream.setEncoding('utf8');
	stream.on('data', (chunk) => {
		buffer += chunk;
		while (true) {
			const index = buffer.indexOf('\n');
			if (index === -1) break;
			const line = buffer.slice(0, index).replace(/\r$/, '');
			buffer = buffer.slice(index + 1);
			onLine(line);
		}
	});
	stream.on('end', () => {
		if (buffer.length > 0) {
			onLine(buffer.replace(/\r$/, ''));
		}
	});
}

function maybeEmit(payload) {
	if (payload) {
		writeEvent(payload);
	}
}

function emitEvent(level, event, message, fields = {}) {
	writeEvent({
		timestamp: new Date().toISOString(),
		level: normalizeLevel(level),
		service: 'runtime',
		component: 'runtime',
		stream: normalizeLevel(level) === 'error' || normalizeLevel(level) === 'warn' ? 'stderr' : 'stdout',
		event,
		message,
		...fields
	});
}

function writeEvent(payload) {
	const stream = payload.level === 'error' || payload.level === 'warn' ? process.stderr : process.stdout;
	stream.write(`${JSON.stringify(payload)}\n`);
}

async function waitForHttp(name, url, attempts = 120, delayMs = 1000) {
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const response = await fetch(url);
			if (response.ok) {
				emitEvent('info', 'runtime.readiness', `${name} ready`, { target_url: url });
				return;
			}
		} catch {
			// keep retrying
		}
		await delay(delayMs);
	}
	emitEvent('error', 'runtime.readiness_failed', `${name} failed to become ready`, { target_url: url });
	throw new Error(`${name} readiness failed for ${url}`);
}

async function shutdown() {
	if (state.shuttingDown) {
		return;
	}
	state.shuttingDown = true;

	for (const interval of state.intervals) {
		clearInterval(interval);
	}
	state.intervals.clear();

	const children = [...state.children.entries()];
	for (const [, child] of children) {
		child.kill('SIGTERM');
	}
	await delay(2_000);
	for (const [, child] of [...state.children.entries()]) {
		if (!child.killed) {
			child.kill('SIGKILL');
		}
	}
}

function registerSignalHandlers() {
	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.on(signal, () => {
			state.exitCode = 0;
			void shutdown().then(() => process.exit(0));
		});
	}
}

function runCommand({ cmd, args, cwd, env = process.env, allowFailure = false, quiet = false, routeAs = null }) {
	const child = spawnSync(cmd, args, {
		cwd,
		env,
		encoding: 'utf8'
	});
	if (child.error) {
		if (!allowFailure) {
			throw child.error;
		}
		return child;
	}

	if (!quiet) {
		for (const line of splitLines(child.stdout ?? '')) {
			if (routeAs) maybeEmit(routeGenericLine(routeAs, 'stdout', line));
		}
		for (const line of splitLines(child.stderr ?? '')) {
			if (routeAs) maybeEmit(routeGenericLine(routeAs, 'stderr', line));
		}
	}

	if (child.status !== 0 && !allowFailure) {
		throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${child.status ?? 'unknown'}`);
	}
	return child;
}

function ensureDevelopmentWebDependencies(env) {
	if (env.appMode !== 'dev') {
		return;
	}

	const dependenciesReady =
		existsSync('/app/web/node_modules/.pnpm') &&
		existsSync('/app/web/node_modules/.bin/convex') &&
		existsSync('/app/web/node_modules/.bin/vite') &&
		existsSync('/app/web/node_modules/web-push');
	if (dependenciesReady) {
		return;
	}

	runCommand({
		cmd: 'pnpm',
		args: ['install', '--frozen-lockfile', '--force'],
		cwd: '/app/web',
		routeAs: 'runtime'
	});
}

function generateAdminKey(instanceName, instanceSecret) {
	const child = spawnSync('/app/convex/generate_key', [instanceName, instanceSecret], {
		encoding: 'utf8'
	});
	if (child.status !== 0) {
		throw new Error('Failed to generate Convex admin key');
	}
	for (const line of splitLines(child.stderr ?? '')) {
		if (line !== 'Admin key:') {
			maybeEmit(routeGenericLine('runtime', 'stderr', line));
		}
	}
	const key = splitLines(child.stdout ?? '').at(-1)?.trim() ?? '';
	if (!key) {
		throw new Error('Convex admin key generation returned an empty key');
	}
	return key;
}

function computeConvexSyncFingerprint(env) {
	const hash = createHash('sha256');
	for (const line of [
		`CONVEX_BACKEND_DRIVER=postgres-v5`,
		`CONVEX_STORAGE_DIR=${env.convexStorageDir}`,
		`MANGARR_PUBLIC_URL=${env.publicOrigin}`,
		`MANGARR_CONVEX_AUTH_ISSUER=${env.authIssuer}`,
		`MANGARR_CONVEX_AUTH_APPLICATION_ID=${env.authApplicationId}`,
		`MANGARR_CONVEX_AUTH_KEY_ID=${env.authKeyId}`,
		`MANGARR_CONVEX_AUTH_PRIVATE_JWK=${env.authPrivateJwk}`,
		`MANGARR_SERVICE_SECRET=${env.serviceSecret}`,
		`MANGARR_BRIDGE_INTERNAL_URL=${env.bridgeInternalUrl}`,
		`MANGARR_WEB_PUSH_VAPID_PUBLIC_KEY=${env.vapid.publicKey}`,
		`MANGARR_WEB_PUSH_VAPID_PRIVATE_KEY=${env.vapid.privateKey}`,
		`MANGARR_WEB_PUSH_SUBJECT=${env.vapid.subject}`
	]) {
		hash.update(line);
	}

	for (const path of [
		'/app/web/package.json',
		'/app/web/pnpm-lock.yaml',
		'/app/web/convex.json',
		'/app/web/src/lib/server/convex-auth-config.ts',
		...listFiles('/app/web/src/convex'),
		...listFiles('/app/web/src/lib/utils')
	]) {
		if (!existsSync(path)) continue;
		hash.update(path);
		hash.update(readFileSync(path));
	}

	return hash.digest('hex');
}

function ensureHexSecret(path) {
	if (!existsSync(path) || !readFileSync(path, 'utf8').trim()) {
		writeFileSync(path, randomBytes(32).toString('hex'));
	}
	chmodSync(path, 0o600);
	return readFileSync(path, 'utf8').trim();
}

function ensureJwk(path) {
	if (!existsSync(path) || !readFileSync(path, 'utf8').trim()) {
		const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
		writeFileSync(path, JSON.stringify(privateKey.export({ format: 'jwk' })));
	}
	chmodSync(path, 0o600);
	return readFileSync(path, 'utf8').trim();
}

function ensureVapid(path, defaultSubject) {
	let payload = {};
	if (existsSync(path) && readFileSync(path, 'utf8').trim()) {
		payload = JSON.parse(readFileSync(path, 'utf8'));
	}
	if (!payload.publicKey || !payload.privateKey) {
		const webpush = requireFromWeb('web-push');
		const keys = webpush.generateVAPIDKeys();
		payload.publicKey = payload.publicKey || keys.publicKey;
		payload.privateKey = payload.privateKey || keys.privateKey;
	}
	const configuredSubject = readVar(process.env, ['MANGARR_WEB_PUSH_SUBJECT'], '').trim();
	if (configuredSubject && !isValidVapidSubject(configuredSubject)) {
		throw new Error('MANGARR_WEB_PUSH_SUBJECT must be an https: or mailto: URL');
	}
	if (configuredSubject) {
		payload.subject = configuredSubject;
	} else if (!isValidVapidSubject(payload.subject)) {
		payload.subject = isValidVapidSubject(defaultSubject)
			? defaultSubject
			: 'mailto:notifications@mangarr.local';
	}
	writeFileSync(path, JSON.stringify(payload));
	chmodSync(path, 0o600);
	return payload;
}

function isValidVapidSubject(value) {
	try {
		const url = new URL(String(value ?? '').trim());
		return url.protocol === 'https:' || url.protocol === 'mailto:';
	} catch {
		return false;
	}
}

function syncKcefRuntimeFiles(kcefLibraryDir) {
	const destination = '/opt/java/openjdk/lib';
	if (!existsSync(kcefLibraryDir)) {
		return;
	}

	mkdirSync(destination, { recursive: true });
	for (const name of [
		'cef_server',
		'chrome-sandbox',
		'libcef.so',
		'libjcef.so',
		'libEGL.so',
		'libGLESv2.so',
		'libvk_swiftshader.so',
		'libvulkan.so.1',
		'vk_swiftshader_icd.json',
		'resources.pak',
		'chrome_100_percent.pak',
		'chrome_200_percent.pak',
		'icudtl.dat',
		'v8_context_snapshot.bin'
	]) {
		const source = join(kcefLibraryDir, name);
		const target = join(destination, name);
		if (existsSync(source)) {
			replaceSymlink(source, target);
		}
	}

	const locales = join(kcefLibraryDir, 'locales');
	if (existsSync(locales)) {
		replaceSymlink(locales, join(destination, 'locales'));
	}

	const sandbox = join(kcefLibraryDir, 'chrome-sandbox');
	if (existsSync(sandbox)) {
		runCommand({ cmd: 'chown', args: ['root:root', sandbox], cwd: '/app', allowFailure: true, quiet: true });
		runCommand({ cmd: 'chmod', args: ['4755', sandbox], cwd: '/app', allowFailure: true, quiet: true });
	}
}

function writeJcefHelper(kcefLibraryDir) {
	const helperPath = '/opt/java/openjdk/lib/jcef_helper';
	writeFileSync(
		helperPath,
		`#!/bin/sh
TARGET="${kcefLibraryDir}/jcef_helper"
DEST="/opt/java/openjdk/lib"
for _ in $(seq 1 120); do
  if [ -x "$TARGET" ]; then
    exec "$TARGET" "$@"
  fi
  sleep 1
done
echo "jcef_helper did not become available at $TARGET" >&2
exit 127
`
	);
	chmodSync(helperPath, 0o755);
}

function replaceSymlink(source, target) {
	try {
		unlinkSync(target);
	} catch {}
	try {
		symlinkSync(source, target);
	} catch {
		try {
			rmSync(target, { recursive: true, force: true });
		} catch {}
		symlinkSync(source, target);
	}
}

function commandExists(name) {
	return spawnSync('sh', ['-lc', `command -v ${name}`], { encoding: 'utf8' }).status === 0;
}

function listFiles(root) {
	if (!existsSync(root)) return [];
	const entries = [];
	for (const dirent of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, dirent.name);
		if (dirent.isDirectory()) {
			entries.push(...listFiles(path));
		} else if (dirent.isFile()) {
			entries.push(path);
		}
	}
	return entries.sort();
}

function readdirSafe(root) {
	try {
		return readdirSync(root);
	} catch {
		return [];
	}
}

function splitLines(text) {
	return String(text)
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter(Boolean);
}

function parseObjectJson(line) {
	const trimmed = line.trim();
	if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
	try {
		const parsed = JSON.parse(trimmed);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function stripAnsi(line) {
	return String(line).replace(
		// eslint-disable-next-line no-control-regex
		/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
		''
	);
}

function normalizeLevel(level) {
	switch (String(level ?? '').toLowerCase()) {
		case 'trace':
		case 'debug':
			return 'debug';
		case 'warn':
		case 'warning':
			return 'warn';
		case 'error':
		case 'fatal':
			return 'error';
		default:
			return 'info';
	}
}

function truthy(value) {
	return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function readVar(source, keys, fallback) {
	for (const key of keys) {
		const value = source[key];
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return fallback;
}

function stringValue(value) {
	return typeof value === 'string' && value.trim() ? value : null;
}

function delay(ms) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
