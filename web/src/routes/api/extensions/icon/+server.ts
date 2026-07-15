import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env as privateEnv } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { requireUser } from '$lib/server/auth';
import { readResponseBodyWithinLimit } from '$lib/server/bounded-response';
import { convexApi } from '$lib/server/convex-api';
import { getConvexClient } from '$lib/server/convex';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const CACHE_CONTROL = 'private, max-age=86400, stale-while-revalidate=604800';
const MAX_ICON_BYTES = 2 * 1024 * 1024;
const FALLBACK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none">
<rect width="96" height="96" rx="20" fill="#161b22"/>
<path d="M48 22c4.418 0 8 3.582 8 8v6h6c4.418 0 8 3.582 8 8s-3.582 8-8 8h-6v6c0 4.418-3.582 8-8 8s-8-3.582-8-8v-6h-6c-4.418 0-8-3.582-8-8s3.582-8 8-8h6v-6c0-4.418 3.582-8 8-8Z" fill="#6b7280"/>
</svg>`;

type CachedIconMeta = {
	contentType: string;
	fetchedAt: number;
};

export const GET: RequestHandler = async (event) => {
	requireUser(event);

	const { url } = event;

	const pkg = url.searchParams.get('pkg')?.trim() ?? '';
	const target = url.searchParams.get('url')?.trim() ?? '';
	if (!pkg || !target) {
		throw error(400, 'pkg and url are required');
	}

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		throw error(400, 'Invalid icon url');
	}

	if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
		throw error(400, 'Unsupported protocol');
	}

	const repository = (await getConvexClient().query(convexApi.extensions.getRepository, {})) as {
		url?: string;
	};
	const repoUrl = repository.url?.trim() ?? '';
	if (!repoUrl) {
		throw error(404, 'Extension repository is not configured');
	}

	let repositoryIconBase: URL;
	try {
		repositoryIconBase = new URL('icon/', repoUrl);
	} catch {
		throw error(500, 'Extension repository URL is invalid');
	}
	if (
		parsed.origin !== repositoryIconBase.origin ||
		!parsed.pathname.startsWith(repositoryIconBase.pathname) ||
		parsed.username ||
		parsed.password
	) {
		throw error(400, 'Unsupported icon url');
	}

	const cacheDir = getIconCacheDir();
	const cacheKey = createHash('sha256').update(target).digest('hex');
	const dataPath = path.join(cacheDir, `${sanitizePkg(pkg)}-${cacheKey}.bin`);
	const metaPath = `${dataPath}.json`;

	const cached = await readCachedIcon(dataPath, metaPath);
	if (cached) {
		return buildIconResponse(cached.body, cached.meta.contentType);
	}

	let upstream: Response;
	try {
		upstream = await fetch(parsed, {
			redirect: 'error',
			headers: {
				accept: 'image/png,image/*;q=0.8,*/*;q=0.5',
				'user-agent': 'Mozilla/5.0 (compatible; MangarrExtensionIconProxy/1.0)'
			},
			signal: AbortSignal.timeout(15_000)
		});
	} catch {
		return buildFallbackIconResponse();
	}

	if (!upstream.ok) {
		return buildFallbackIconResponse();
	}

	const contentType = upstream.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? '';
	if (!isImageContentType(contentType)) {
		return buildFallbackIconResponse();
	}

	let payload: Uint8Array | null;
	try {
		payload = await readResponseBodyWithinLimit(upstream, MAX_ICON_BYTES);
	} catch {
		return buildFallbackIconResponse();
	}
	if (!payload || payload.byteLength === 0) {
		return buildFallbackIconResponse();
	}
	const body = Buffer.from(payload);

	await writeCachedIcon(dataPath, metaPath, body, {
		contentType,
		fetchedAt: Date.now()
	});

	return buildIconResponse(body, contentType);
};

function buildIconResponse(body: Buffer, contentType: string) {
	const payload = body.buffer.slice(
		body.byteOffset,
		body.byteOffset + body.byteLength
	) as ArrayBuffer;
	return new Response(payload, {
		status: 200,
		headers: {
			'cache-control': CACHE_CONTROL,
			'content-security-policy': "default-src 'none'; sandbox",
			'content-type': contentType,
			'x-content-type-options': 'nosniff'
		}
	});
}

function buildFallbackIconResponse() {
	return new Response(FALLBACK_ICON, {
		status: 200,
		headers: {
			'cache-control': CACHE_CONTROL,
			'content-security-policy': "default-src 'none'; sandbox",
			'content-type': 'image/svg+xml; charset=utf-8',
			'x-content-type-options': 'nosniff'
		}
	});
}

function getIconCacheDir() {
	const configured = privateEnv.MANGARR_EXTENSION_ICON_CACHE_DIR?.trim();
	if (configured) {
		return configured;
	}

	const cwd = process.cwd();
	const appRoot = path.basename(cwd) === 'web' ? path.resolve(cwd, '..') : cwd;
	return path.join(appRoot, 'config', 'cache', 'extension-icons');
}

async function readCachedIcon(dataPath: string, metaPath: string) {
	try {
		const file = await stat(dataPath);
		if (file.size === 0 || file.size > MAX_ICON_BYTES) {
			return null;
		}

		const [body, metaRaw] = await Promise.all([readFile(dataPath), readFile(metaPath, 'utf8')]);
		const meta = JSON.parse(metaRaw) as CachedIconMeta;
		if (!isImageContentType(meta.contentType)) {
			return null;
		}
		return { body, meta };
	} catch {
		return null;
	}
}

async function writeCachedIcon(
	dataPath: string,
	metaPath: string,
	body: Buffer,
	meta: CachedIconMeta
) {
	const cacheDir = path.dirname(dataPath);
	await mkdir(cacheDir, { recursive: true });
	const suffix = `${process.pid}-${randomUUID()}.tmp`;
	const temporaryDataPath = `${dataPath}.${suffix}`;
	const temporaryMetaPath = `${metaPath}.${suffix}`;

	try {
		await Promise.all([
			writeFile(temporaryDataPath, body),
			writeFile(temporaryMetaPath, JSON.stringify(meta))
		]);
		await rename(temporaryDataPath, dataPath);
		await rename(temporaryMetaPath, metaPath);
	} finally {
		await Promise.all([
			rm(temporaryDataPath, { force: true }),
			rm(temporaryMetaPath, { force: true })
		]);
	}
}

function isImageContentType(contentType: string) {
	return /^image\/[a-z0-9.+-]+$/i.test(contentType);
}

function sanitizePkg(pkg: string) {
	return pkg.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160) || 'icon';
}
