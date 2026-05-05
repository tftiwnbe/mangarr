import { ActionCache } from '@convex-dev/action-cache';
import { v } from 'convex/values';

import { components, internal } from './_generated/api';
import { internalAction } from './_generated/server';

type ComponentsWithActionCache = typeof components & {
	actionCache: ConstructorParameters<typeof ActionCache>[0];
};

const actionCacheComponent = (components as ComponentsWithActionCache).actionCache;

type BridgeCommandRequestArgs = {
	commandType: string;
	payload: unknown;
	requestedByUserId?: string;
};

const sourceReadCache = new ActionCache(actionCacheComponent, {
	action: internal.bridge_workpool.executeCacheableBridgeCommand,
	name: 'bridge-source-read-v1',
	log: false
});

export const executeCommand = internalAction({
	args: {
		commandId: v.id('commands')
	},
	handler: async (ctx, args): Promise<unknown> => {
		const command = await ctx.runQuery(internal.commands.getWorkpoolCommand, {
			commandId: args.commandId
		});
		// Command was cancelled, completed by another path, or never made it to the
		// terminal table. Treat as a no-op success so the Workpool stops retrying —
		// the source-of-truth is whichever path moved the command out of pending.
		if (!command) {
			return { ok: true, skipped: true };
		}

		// library.title.stats.refresh only mutates Convex tables — running it
		// through the bridge HTTP server is a wasted round trip that also breaks
		// when the bridge isn't reachable from the Convex isolate. Run inline.
		if (command.commandType === 'library.title.stats.refresh') {
			const payload = command.payload as { titleId?: string };
			if (typeof payload?.titleId !== 'string') {
				throw new Error('library.title.stats.refresh requires a titleId');
			}
			await ctx.runMutation(internal.commands.refreshTitleStatsInternal, {
				titleId: payload.titleId as never,
				now: Date.now()
			});
			return { ok: true };
		}

		const executionArgs = { commandType: command.commandType, payload: command.payload };

		if (isCacheableSourceRead(command.commandType)) {
			try {
				return await sourceReadCache.fetch(ctx, executionArgs, {
					ttl: cacheTtlMs(command.commandType)
				});
			} catch (error) {
				console.warn('Falling back to uncached bridge command execution', {
					commandType: command.commandType,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}

		return executeBridgeCommandRequest({
			...executionArgs,
			requestedByUserId: command.requestedByUserId
		});
	}
});

export const executeCacheableBridgeCommand = internalAction({
	args: {
		commandType: v.string(),
		payload: v.any()
	},
	handler: async (_ctx, args): Promise<unknown> => executeBridgeCommandRequest(args)
});

export function isCacheableSourceRead(commandType: string) {
	return (
		commandType === 'explore.search' ||
		commandType === 'explore.popular' ||
		commandType === 'explore.latest' ||
		commandType === 'explore.title.fetch' ||
		commandType === 'explore.chapters.fetch' ||
		commandType === 'reader.pages.fetch'
	);
}

export function cacheTtlMs(commandType: string) {
	switch (commandType) {
		case 'explore.title.fetch':
			return 6 * 60 * 60 * 1000;
		case 'explore.popular':
		case 'explore.latest':
			return 10 * 60 * 1000;
		case 'explore.search':
			return 5 * 60 * 1000;
		case 'explore.chapters.fetch':
			return 15 * 60 * 1000;
		case 'reader.pages.fetch':
			return 30 * 60 * 1000;
		default:
			return 5 * 60 * 1000;
	}
}

async function executeBridgeCommandRequest(args: BridgeCommandRequestArgs) {
	const bridgeUrl = (process.env.MANGARR_BRIDGE_INTERNAL_URL || 'http://127.0.0.1:3212').replace(
		/\/+$/,
		''
	);
	const serviceSecret = process.env.MANGARR_SERVICE_SECRET;
	if (!serviceSecret) {
		throw new Error('MANGARR_SERVICE_SECRET is not configured for bridge Workpool execution');
	}

	let response: Response;
	try {
		response = await fetch(`${bridgeUrl}/commands/execute`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-mangarr-service-secret': serviceSecret
			},
			body: JSON.stringify(args)
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Bridge unreachable: ${message}`);
	}

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(`Bridge command execution failed (${response.status}): ${text}`);
	}

	return response.json();
}
