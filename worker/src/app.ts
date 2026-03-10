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

  app.addHook('onReady', async () => {
    heartbeat.start();
  });

  app.addHook('onClose', async () => {
    heartbeat.stop();
  });

  app.get('/health', async () => ({
    ok: true,
    workerId: config.workerId,
    version: config.version,
    uptimeMs: Date.now() - startedAt,
    convex: heartbeat.snapshot(),
    bridge: bridge.snapshot()
  }));

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
