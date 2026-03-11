import Fastify from 'fastify';

import { BridgeSupervisor } from './bridge-supervisor.js';
import type { WorkerConfig } from './config.js';
import { createConvexClient } from './convex.js';
import { HeartbeatReporter } from './heartbeat-reporter.js';

export function buildApp(config: WorkerConfig) {
  const app = Fastify({ logger: true });
  const bridge = new BridgeSupervisor(config);
  const convex = createConvexClient(config);
  const heartbeat = new HeartbeatReporter(app.log, config, bridge, convex);
  const startedAt = Date.now();

  const requireLocalhost = async (
    request: { ip: string },
    reply: { code(status: number): { send(payload: unknown): void } }
  ) => {
    if (!isLoopbackIp(request.ip)) {
      reply.code(401).send({
        ok: false,
        code: 'localhost_only',
        message: 'Worker internal routes accept only localhost requests'
      });
      return;
    }
  };

  app.addHook('onReady', async () => {
    await bridge.start();
    heartbeat.start();
  });

  app.addHook('onClose', async () => {
    heartbeat.stop();
    await bridge.stop();
  });

  app.get('/health', async () => ({
    ok: true,
    workerId: config.workerId,
    version: config.version,
    uptimeMs: Date.now() - startedAt,
    convex: heartbeat.snapshot(),
    bridge: bridge.snapshot()
  }));

  app.get(
    '/bridge',
    {
      preHandler: requireLocalhost
    },
    async () => ({
      workerId: config.workerId,
      bridge: bridge.snapshot()
    })
  );

  app.post(
    '/bridge/start',
    {
      preHandler: requireLocalhost
    },
    async () => {
      await bridge.start();
      return {
        ok: true,
        bridge: bridge.snapshot()
      };
    }
  );

  app.post(
    '/bridge/stop',
    {
      preHandler: requireLocalhost
    },
    async () => {
      await bridge.stop();
      return {
        ok: true,
        bridge: bridge.snapshot()
      };
    }
  );

  app.post(
    '/bridge/restart',
    {
      preHandler: requireLocalhost
    },
    async () => {
      await bridge.restart();
      return {
        ok: true,
        bridge: bridge.snapshot()
      };
    }
  );

  app.get<{ Querystring: { url?: string } }>(
    '/covers/proxy',
    {
      preHandler: requireLocalhost
    },
    async (request, reply) => {
      const rawUrl = String(request.query.url ?? '').trim();
      if (!rawUrl) {
        reply.code(400);
        return {
          ok: false,
          code: 'invalid_url',
          message: 'Query parameter "url" is required'
        };
      }

      let target: URL;
      try {
        target = new URL(rawUrl);
      } catch {
        reply.code(400);
        return { ok: false, code: 'invalid_url', message: 'URL must be a valid absolute URL' };
      }

      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        reply.code(400);
        return { ok: false, code: 'invalid_url', message: 'Only http and https URLs are allowed' };
      }

      let upstream: Response;
      try {
        upstream = await fetch(target, {
          signal: AbortSignal.timeout(15_000),
          headers: {
            accept: 'image/*,*/*;q=0.8',
            'user-agent': 'MangarrWorker/0.1'
          }
        });
      } catch {
        reply.code(502);
        return {
          ok: false,
          code: 'upstream_unreachable',
          message: 'Unable to fetch upstream cover URL'
        };
      }

      if (!upstream.ok) {
        reply.code(upstream.status);
        return {
          ok: false,
          code: 'upstream_error',
          message: `Upstream returned ${upstream.status}`
        };
      }

      const body = Buffer.from(await upstream.arrayBuffer());
      reply.header('content-type', upstream.headers.get('content-type') ?? 'application/octet-stream');
      reply.header('cache-control', upstream.headers.get('cache-control') ?? 'public, max-age=300');

      const etag = upstream.headers.get('etag');
      if (etag) {
        reply.header('etag', etag);
      }

      const lastModified = upstream.headers.get('last-modified');
      if (lastModified) {
        reply.header('last-modified', lastModified);
      }

      return reply.send(body);
    }
  );

  app.get('/files/*', { preHandler: requireLocalhost }, async (_request, reply) => {
    reply.code(501);
    return { ok: false, code: 'files_not_ready', message: 'File proxy routes are not implemented yet' };
  });

  app.get('/covers/*', { preHandler: requireLocalhost }, async (_request, reply) => {
    reply.code(501);
    return { ok: false, code: 'covers_not_ready', message: 'Cover proxy routes are not implemented yet' };
  });

  app.get('/reader/*', { preHandler: requireLocalhost }, async (_request, reply) => {
    reply.code(501);
    return { ok: false, code: 'reader_not_ready', message: 'Reader proxy routes are not implemented yet' };
  });

  return app;
}

function isLoopbackIp(value: string) {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}
