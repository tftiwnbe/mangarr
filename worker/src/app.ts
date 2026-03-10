import Fastify, { type FastifyRequest } from 'fastify';

import { BridgeSupervisor } from './bridge-supervisor.js';
import type { WorkerConfig } from './config.js';

function readServiceSecret(request: FastifyRequest) {
  const header = request.headers['x-mangarr-service-secret'];
  return Array.isArray(header) ? header[0] ?? '' : header ?? '';
}

export function buildApp(config: WorkerConfig) {
  const app = Fastify({ logger: true });
  const bridge = new BridgeSupervisor(config);
  const startedAt = Date.now();

  app.get('/health', async () => ({
    ok: true,
    workerId: config.workerId,
    version: config.version,
    uptimeMs: Date.now() - startedAt,
    bridge: bridge.snapshot()
  }));

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') {
      return;
    }

    if (!config.serviceSecret) {
      reply.code(503);
      return reply.send({
        ok: false,
        code: 'worker_secret_missing',
        message: 'MANGARR_WORKER_SERVICE_SECRET is not configured'
      });
    }

    if (readServiceSecret(request) !== config.serviceSecret) {
      reply.code(401);
      return reply.send({
        ok: false,
        code: 'worker_unauthorized',
        message: 'Missing or invalid worker service secret'
      });
    }
  });

  app.get('/bridge', async () => ({
    workerId: config.workerId,
    bridge: bridge.snapshot()
  }));

  app.get('/files/*', async (_request, reply) => {
    reply.code(501);
    return { ok: false, code: 'files_not_ready', message: 'File proxy routes are not implemented yet' };
  });

  app.get('/covers/*', async (_request, reply) => {
    reply.code(501);
    return { ok: false, code: 'covers_not_ready', message: 'Cover proxy routes are not implemented yet' };
  });

  app.get('/reader/*', async (_request, reply) => {
    reply.code(501);
    return { ok: false, code: 'reader_not_ready', message: 'Reader proxy routes are not implemented yet' };
  });

  return app;
}
