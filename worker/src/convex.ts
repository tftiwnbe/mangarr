import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

import type { WorkerConfig } from './config.js';

const reportHeartbeat = makeFunctionReference<'mutation'>('worker:reportHeartbeat');

export type WorkerConvexClient = {
  reportHeartbeat(args: {
    workerId: string;
    version: string;
    capabilities: string[];
    lastHeartbeatAt: number;
    bridgeStatus: 'stopped' | 'starting' | 'ready' | 'error';
    bridgePort?: number;
    bridgeReady: boolean;
    restartCount: number;
    lastStartupError?: string;
    lastHeartbeatError?: string;
  }): Promise<void>;
};

export function createConvexClient(config: WorkerConfig): WorkerConvexClient | null {
  if (!config.convexUrl || !config.convexAdminKey) {
    return null;
  }

  const client = new ConvexHttpClient(config.convexUrl, {
    skipConvexDeploymentUrlCheck: true,
    logger: false
  });

  (
    client as ConvexHttpClient & {
      setAdminAuth(token: string): void;
    }
  ).setAdminAuth(config.convexAdminKey);

  return {
    async reportHeartbeat(args) {
      await client.mutation(reportHeartbeat, args);
    }
  };
}
