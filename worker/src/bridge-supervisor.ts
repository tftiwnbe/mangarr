import { access, mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

import type { WorkerConfig } from './config.js';

export type BridgeStatus = 'stopped' | 'starting' | 'ready' | 'error';

type BridgeState = {
  status: BridgeStatus;
  ready: boolean;
  running: boolean;
  port: number;
  restartCount: number;
  jarPathConfigured: boolean;
  lastStartupError: string | null;
};

const READY_CHECK_INTERVAL_MS = 300;
const CONNECT_TIMEOUT_MS = 1_000;

export class BridgeSupervisor {
  #state: BridgeState;
  #bridgeProcess: ChildProcessByStdio<null, Readable, Readable> | null = null;
  #restartRequested = false;
  #stopping = false;
  #operation: Promise<void> = Promise.resolve();

  constructor(private readonly config: WorkerConfig) {
    const jarConfigured = this.config.bridgeJarPath.length > 0;
    this.#state = {
      status: jarConfigured ? 'stopped' : 'error',
      ready: false,
      running: false,
      port: this.config.bridgePort,
      restartCount: 0,
      jarPathConfigured: jarConfigured,
      lastStartupError: jarConfigured ? null : 'TACHIBRIDGE_JAR_PATH is not configured'
    };
  }

  snapshot() {
    return { ...this.#state };
  }

  async start() {
    await this.#enqueue(async () => {
      await this.#startInternal();
    });
  }

  async stop() {
    await this.#enqueue(async () => {
      await this.#stopInternal();
    });
  }

  async restart() {
    await this.#enqueue(async () => {
      this.#state.restartCount += 1;
      await this.#stopInternal();
      await this.#startInternal();
    });
  }

  async #enqueue(operation: () => Promise<void>) {
    let release = () => {};
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    const previous = this.#operation;
    this.#operation = next;
    await previous;
    try {
      await operation();
    } finally {
      release();
    }
  }

  async #startInternal() {
    if (this.#bridgeProcess) {
      return;
    }

    this.#state.jarPathConfigured = this.config.bridgeJarPath.length > 0;
    if (!this.#state.jarPathConfigured) {
      this.#state.status = 'error';
      this.#state.lastStartupError = 'TACHIBRIDGE_JAR_PATH is not configured';
      this.#state.ready = false;
      this.#state.running = false;
      return;
    }

    try {
      await access(this.config.bridgeJarPath);
    } catch {
      this.#state.status = 'error';
      this.#state.lastStartupError = `Tachibridge JAR is not readable: ${this.config.bridgeJarPath}`;
      this.#state.ready = false;
      this.#state.running = false;
      return;
    }

    const dataDir = path.resolve(process.cwd(), this.config.bridgeDataDir);
    await mkdir(dataDir, { recursive: true });

    this.#state.status = 'starting';
    this.#state.ready = false;
    this.#state.running = false;
    this.#state.lastStartupError = null;
    this.#restartRequested = false;
    this.#stopping = false;

    const args = [
      '-jar',
      this.config.bridgeJarPath,
      '--port',
      String(this.config.bridgePort),
      '--data-dir',
      dataDir
    ];

    let startupError: Error | null = null;
    let exitedBeforeReady = false;

    try {
      const processRef = spawn('java', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env
        }
      });

      this.#bridgeProcess = processRef;
      this.#attachProcessHandlers(processRef);

      await this.#waitForBridgeReady(processRef);
      this.#state.status = 'ready';
      this.#state.ready = true;
      this.#state.running = true;
    } catch (error) {
      startupError = error instanceof Error ? error : new Error('Unknown bridge startup error');
      exitedBeforeReady = !this.#bridgeProcess;
    }

    if (!startupError) {
      return;
    }

    this.#state.status = 'error';
    this.#state.ready = false;
    this.#state.running = false;
    this.#state.lastStartupError = startupError.message;

    if (this.#bridgeProcess) {
      await this.#terminateProcess(this.#bridgeProcess);
      this.#bridgeProcess = null;
    }

    if (exitedBeforeReady && this.#restartRequested && this.#state.restartCount < 1) {
      this.#state.restartCount += 1;
      this.#restartRequested = false;
      await this.#startInternal();
    }
  }

  async #stopInternal() {
    const active = this.#bridgeProcess;
    if (!active) {
      this.#state.status = 'stopped';
      this.#state.ready = false;
      this.#state.running = false;
      return;
    }

    this.#stopping = true;
    this.#state.status = 'stopped';
    this.#state.ready = false;
    this.#state.running = false;
    await this.#terminateProcess(active);
    this.#bridgeProcess = null;
    this.#stopping = false;
  }

  #attachProcessHandlers(processRef: ChildProcessByStdio<null, Readable, Readable>) {
    processRef.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      this.#inspectProcessOutput(text);
    });

    processRef.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      this.#inspectProcessOutput(text);
    });

    processRef.on('error', (error) => {
      this.#state.status = 'error';
      this.#state.ready = false;
      this.#state.running = false;
      this.#state.lastStartupError = `Bridge process failed: ${error.message}`;
      if (this.#bridgeProcess === processRef) {
        this.#bridgeProcess = null;
      }
    });

    processRef.on('exit', (code, signal) => {
      const expected = this.#stopping;
      if (this.#bridgeProcess === processRef) {
        this.#bridgeProcess = null;
      }

      this.#state.ready = false;
      this.#state.running = false;

      if (expected) {
        this.#state.status = 'stopped';
        return;
      }

      const reason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
      this.#state.status = 'error';
      this.#state.lastStartupError = `Bridge process exited (${reason})`;
    });
  }

  #inspectProcessOutput(text: string) {
    if (text.includes('KCEF restart required')) {
      this.#restartRequested = true;
    }
  }

  async #waitForBridgeReady(processRef: ChildProcessByStdio<null, Readable, Readable>) {
    const deadline = Date.now() + this.config.bridgeReadyTimeoutMs;
    while (Date.now() < deadline) {
      if (processRef.exitCode !== null || processRef.killed) {
        throw new Error(
          `Bridge process exited before becoming ready (code: ${processRef.exitCode ?? 'unknown'})`
        );
      }

      const ready = await canConnect(this.config.bridgePort);
      if (ready) {
        return;
      }

      await sleep(READY_CHECK_INTERVAL_MS);
    }

    throw new Error(`Bridge health timeout after ${this.config.bridgeReadyTimeoutMs}ms`);
  }

  async #terminateProcess(processRef: ChildProcessByStdio<null, Readable, Readable>) {
    if (processRef.exitCode !== null || processRef.killed) {
      return;
    }

    processRef.kill('SIGTERM');
    const exitedGracefully = await waitForExit(processRef, this.config.bridgeShutdownTimeoutMs);
    if (exitedGracefully) {
      return;
    }

    processRef.kill('SIGKILL');
    await waitForExit(processRef, 1_500);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function canConnect(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForExit(
  processRef: ChildProcessByStdio<null, Readable, Readable>,
  timeoutMs: number
) {
  if (processRef.exitCode !== null) {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    const onExit = () => {
      cleanup();
      resolve(true);
    };

    const cleanup = () => {
      clearTimeout(timer);
      processRef.off('exit', onExit);
    };

    processRef.once('exit', onExit);
  });
}
