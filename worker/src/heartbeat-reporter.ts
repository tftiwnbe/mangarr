import type { FastifyBaseLogger } from 'fastify';

import type { BridgeSupervisor } from './bridge-supervisor.js';
import type { WorkerConfig } from './config.js';
import type { WorkerConvexClient } from './convex.js';

type Snapshot = ReturnType<BridgeSupervisor['snapshot']>;

type HeartbeatState = {
  configured: boolean;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
};

export class HeartbeatReporter {
  #timer: NodeJS.Timeout | null = null;
  #state: HeartbeatState;

  constructor(
    private readonly logger: FastifyBaseLogger,
    private readonly config: WorkerConfig,
    private readonly bridge: BridgeSupervisor,
    private readonly convex: WorkerConvexClient | null
  ) {
    this.#state = {
      configured: convex !== null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: convex ? null : 'Convex URL or admin key is not configured'
    };
  }

  snapshot() {
    return { ...this.#state };
  }

  start() {
    void this.run();
    this.#timer = setInterval(() => {
      void this.run();
    }, this.config.heartbeatIntervalMs);
    this.#timer.unref();
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  private async run() {
    const now = Date.now();
    this.#state.lastAttemptAt = now;

    if (!this.convex) {
      return;
    }

    const bridge = this.bridge.snapshot();

    try {
      await this.convex.reportHeartbeat({
        workerId: this.config.workerId,
        version: this.config.version,
        capabilities: this.capabilities(),
        lastHeartbeatAt: now,
        bridgeStatus: bridge.status,
        bridgePort: bridge.port,
        bridgeReady: bridge.ready,
        restartCount: bridge.restartCount,
        lastStartupError: bridge.lastStartupError ?? undefined,
        lastHeartbeatError: undefined
      });

      this.#state.lastSuccessAt = now;
      this.#state.lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown heartbeat error';
      this.#state.lastError = message;
      this.logger.error({ error }, 'Failed to report worker heartbeat to Convex');

      const retrySnapshot: Snapshot = this.bridge.snapshot();
      try {
        await this.convex.reportHeartbeat({
          workerId: this.config.workerId,
          version: this.config.version,
          capabilities: this.capabilities(),
          lastHeartbeatAt: now,
          bridgeStatus: retrySnapshot.status,
          bridgePort: retrySnapshot.port,
          bridgeReady: retrySnapshot.ready,
          restartCount: retrySnapshot.restartCount,
          lastStartupError: retrySnapshot.lastStartupError ?? undefined,
          lastHeartbeatError: message
        });
      } catch {
        // Keep the original error and retry on the next interval.
      }
    }
  }

  private capabilities() {
    return ['bridge.health'];
  }
}
