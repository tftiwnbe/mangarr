import { ConvexHttpClient } from 'convex/browser';

import type { WorkerConfig } from './config.js';
import { workerApi } from './convex-api.js';

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
	leaseCommands(args: {
		workerId: string;
		capabilities: string[];
		now: number;
		limit: number;
		leaseDurationMs: number;
	}): Promise<
		Array<{
			id: string;
			commandType: string;
			payload: unknown;
			requestedByUserId?: string;
			attemptCount: number;
			maxAttempts: number;
		}>
	>;
	markCommandRunning(args: {
		commandId: string;
		workerId: string;
		now: number;
		leaseDurationMs: number;
	}): Promise<{ ok: boolean }>;
	renewCommandLease(args: {
		commandId: string;
		workerId: string;
		now: number;
		leaseDurationMs: number;
	}): Promise<{ ok: boolean }>;
	completeCommand(args: {
		commandId: string;
		workerId: string;
		now: number;
		result: unknown;
	}): Promise<{ ok: boolean }>;
	failCommand(args: {
		commandId: string;
		workerId: string;
		now: number;
		message: string;
		retryDelayMs?: number;
	}): Promise<{ ok: boolean; retried: boolean }>;
	setExtensionRepository(args: { url: string; now: number }): Promise<{ updated: boolean; created: boolean }>;
	upsertInstalledExtension(args: {
		pkg: string;
		name: string;
		lang: string;
		version: string;
		now: number;
	}): Promise<{ ok: boolean }>;
	searchExplore(args: { query: string; limit?: number }): Promise<unknown[]>;
	fetchExploreTitle(args: { canonicalKey: string }): Promise<unknown | null>;
	importLibraryTitle(args: { userId: string; canonicalKey: string; now: number }): Promise<{
		created: boolean;
		titleId: string;
	}>;
};

export function createConvexClient(config: WorkerConfig): WorkerConvexClient | null {
	if (!config.convexUrl || !config.convexAdminKey) {
		return null;
	}

	const client = new ConvexHttpClient(config.convexUrl, {
		skipConvexDeploymentUrlCheck: true,
		logger: false
	});

	(client as ConvexHttpClient & { setAdminAuth(token: string): void }).setAdminAuth(config.convexAdminKey);

	return {
		async reportHeartbeat(args) {
			await client.mutation(workerApi.worker.reportHeartbeat, args);
		},
		async leaseCommands(args) {
			return (await client.mutation(workerApi.commands.lease, args)) as Array<{
				id: string;
				commandType: string;
				payload: unknown;
				requestedByUserId?: string;
				attemptCount: number;
				maxAttempts: number;
			}>;
		},
		async markCommandRunning(args) {
			return (await client.mutation(workerApi.commands.markRunning, args)) as { ok: boolean };
		},
		async renewCommandLease(args) {
			return (await client.mutation(workerApi.commands.renewLease, args)) as { ok: boolean };
		},
		async completeCommand(args) {
			return (await client.mutation(workerApi.commands.complete, args)) as { ok: boolean };
		},
		async failCommand(args) {
			return (await client.mutation(workerApi.commands.fail, args)) as {
				ok: boolean;
				retried: boolean;
			};
		},
		async setExtensionRepository(args) {
			return (await client.mutation(workerApi.extensions.setRepository, args)) as {
				updated: boolean;
				created: boolean;
			};
		},
		async upsertInstalledExtension(args) {
			return (await client.mutation(workerApi.extensions.upsertInstalled, args)) as { ok: boolean };
		},
		async searchExplore(args) {
			return (await client.query(workerApi.explore.search, args)) as unknown[];
		},
		async fetchExploreTitle(args) {
			return (await client.query(workerApi.explore.getTitle, args)) as unknown | null;
		},
		async importLibraryTitle(args) {
			return (await client.mutation(workerApi.library.importForUser, args)) as {
				created: boolean;
				titleId: string;
			};
		}
	};
}
