const DEFAULT_WORKER_PORT = 3212;
const DEFAULT_BRIDGE_PORT = 8181;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

function parsePort(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig() {
  return {
    host: process.env.MANGARR_WORKER_HOST ?? '127.0.0.1',
    port: parsePort(process.env.MANGARR_WORKER_PORT, DEFAULT_WORKER_PORT),
    serviceSecret: process.env.MANGARR_WORKER_SERVICE_SECRET ?? '',
    workerId: process.env.MANGARR_WORKER_ID ?? 'main',
    version: process.env.npm_package_version ?? '0.0.1',
    convexUrl: process.env.CONVEX_URL ?? process.env.CONVEX_SELF_HOSTED_URL ?? '',
    convexAdminKey: process.env.CONVEX_ADMIN_KEY ?? process.env.CONVEX_SELF_HOSTED_ADMIN_KEY ?? '',
    heartbeatIntervalMs: parsePort(
      process.env.MANGARR_WORKER_HEARTBEAT_INTERVAL_MS,
      DEFAULT_HEARTBEAT_INTERVAL_MS
    ),
    bridgeJarPath: process.env.TACHIBRIDGE_JAR_PATH ?? '',
    bridgePort: parsePort(process.env.TACHIBRIDGE_PORT, DEFAULT_BRIDGE_PORT)
  };
}

export type WorkerConfig = ReturnType<typeof loadConfig>;
