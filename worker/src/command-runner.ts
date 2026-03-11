import type { FastifyBaseLogger } from 'fastify';

import type { WorkerConfig } from './config.js';
import type { WorkerConvexClient } from './convex.js';

type RunnerState = {
	configured: boolean;
	running: boolean;
	lastPollAt: number | null;
	lastSuccessAt: number | null;
	lastError: string | null;
};

type LeasedCommand = {
	id: string;
	commandType: string;
	payload: unknown;
	requestedByUserId?: string;
	attemptCount: number;
	maxAttempts: number;
};

function asObject(value: unknown): Record<string, unknown> {
	if (value && typeof value === 'object') {
		return value as Record<string, unknown>;
	}
	return {};
}

function asString(value: unknown, fallback = '') {
	return typeof value === 'string' ? value : fallback;
}

export class CommandRunner {
	#timer: NodeJS.Timeout | null = null;
	#state: RunnerState;
	#busy = false;

	constructor(
		private readonly logger: FastifyBaseLogger,
		private readonly config: WorkerConfig,
		private readonly convex: WorkerConvexClient | null
	) {
		this.#state = {
			configured: convex !== null,
			running: false,
			lastPollAt: null,
			lastSuccessAt: null,
			lastError: convex ? null : 'Convex URL or admin key is not configured'
		};
	}

	snapshot() {
		return { ...this.#state };
	}

	start() {
		if (!this.convex) {
			return;
		}
		this.#state.running = true;
		void this.poll();
		this.#timer = setInterval(() => {
			void this.poll();
		}, this.config.commandPollIntervalMs);
		this.#timer.unref();
	}

	stop() {
		this.#state.running = false;
		if (this.#timer) {
			clearInterval(this.#timer);
			this.#timer = null;
		}
	}

	private async poll() {
		if (!this.convex || this.#busy) {
			return;
		}
		this.#busy = true;
		const now = Date.now();
		this.#state.lastPollAt = now;

		try {
			const leased = await this.convex.leaseCommands({
				workerId: this.config.workerId,
				capabilities: this.capabilities(),
				now,
				limit: 10,
				leaseDurationMs: this.config.commandLeaseDurationMs
			});

			for (const command of leased) {
				await this.handleCommand(command);
			}

			this.#state.lastSuccessAt = now;
			this.#state.lastError = null;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown command-runner error';
			this.#state.lastError = message;
			this.logger.error({ error }, 'Command runner poll failed');
		} finally {
			this.#busy = false;
		}
	}

	private async handleCommand(command: LeasedCommand) {
		if (!this.convex) {
			return;
		}

		const now = Date.now();
		await this.convex.markCommandRunning({
			commandId: command.id,
			workerId: this.config.workerId,
			now,
			leaseDurationMs: this.config.commandLeaseDurationMs
		});

		try {
			await this.convex.renewCommandLease({
				commandId: command.id,
				workerId: this.config.workerId,
				now: Date.now(),
				leaseDurationMs: this.config.commandLeaseDurationMs
			});

			const payload = asObject(command.payload);
			const result = await this.executeCommand(command, payload);

			await this.convex.completeCommand({
				commandId: command.id,
				workerId: this.config.workerId,
				now: Date.now(),
				result
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unhandled command error';
			await this.convex.failCommand({
				commandId: command.id,
				workerId: this.config.workerId,
				now: Date.now(),
				message,
				retryDelayMs: 5_000
			});
			this.logger.error({ commandType: command.commandType, error }, 'Command execution failed');
		}
	}

	private async executeCommand(command: LeasedCommand, payload: Record<string, unknown>) {
		if (!this.convex) {
			throw new Error('Convex client is not configured');
		}

		switch (command.commandType) {
			case 'extensions.repo.sync': {
				const url = asString(payload.url).trim();
				if (!url) {
					throw new Error('Missing repository URL');
				}
				const result = await this.convex.setExtensionRepository({ url, now: Date.now() });
				return { ok: true, ...result };
			}
			case 'extensions.install': {
				const pkg = asString(payload.pkg).trim();
				if (!pkg) {
					throw new Error('Missing extension package');
				}
				const name = asString(payload.name, pkg).trim();
				const lang = asString(payload.lang, 'en').trim() || 'en';
				const version = asString(payload.version, '1.0.0').trim() || '1.0.0';
				await this.convex.upsertInstalledExtension({
					pkg,
					name,
					lang,
					version,
					now: Date.now()
				});
				return { ok: true, pkg, name, lang, version };
			}
			case 'explore.search': {
				const query = asString(payload.query).trim();
				const limit = Number(payload.limit ?? 30);
				const items = await this.convex.searchExplore({
					query,
					limit: Number.isFinite(limit) ? limit : 30
				});
				return { ok: true, items };
			}
			case 'explore.title.fetch': {
				const canonicalKey = asString(payload.canonicalKey).trim();
				if (!canonicalKey) {
					throw new Error('Missing canonical key');
				}
				const title = await this.convex.fetchExploreTitle({ canonicalKey });
				return { ok: true, title };
			}
			case 'library.import': {
				const canonicalKey = asString(payload.canonicalKey).trim();
				if (!canonicalKey) {
					throw new Error('Missing canonical key');
				}
				const userId = asString(payload.userId || command.requestedByUserId).trim();
				if (!userId) {
					throw new Error('Missing user id');
				}
				const result = await this.convex.importLibraryTitle({
					userId,
					canonicalKey,
					now: Date.now()
				});
				return { ok: true, ...result };
			}
			default:
				throw new Error(`Unsupported command type: ${command.commandType}`);
		}
	}

	private capabilities() {
		return [
			'extensions.repo',
			'extensions.install',
			'explore.search',
			'explore.title.fetch',
			'library.import'
		];
	}
}
