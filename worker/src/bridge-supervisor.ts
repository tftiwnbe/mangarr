import type { WorkerConfig } from './config.js';

export type BridgeStatus = 'stopped' | 'starting' | 'ready' | 'error';

export class BridgeSupervisor {
  constructor(private readonly config: WorkerConfig) {}

  snapshot() {
    const jarConfigured = this.config.bridgeJarPath.length > 0;

    return {
      status: (jarConfigured ? 'stopped' : 'error') as BridgeStatus,
      ready: false,
      running: false,
      port: this.config.bridgePort,
      restartCount: 0,
      jarPathConfigured: jarConfigured,
      lastStartupError: jarConfigured ? null : 'TACHIBRIDGE_JAR_PATH is not configured'
    };
  }
}
