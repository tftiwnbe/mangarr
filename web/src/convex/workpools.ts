import { Workpool, type WorkpoolComponent } from '@convex-dev/workpool';

import { components } from './_generated/api';
import type { CommandType } from './command_payloads';

type ComponentsWithPools = typeof components & {
	interactiveWorkpool: WorkpoolComponent;
	discoveryWorkpool: WorkpoolComponent;
	statsWorkpool: WorkpoolComponent;
};

const workpoolComponents = components as ComponentsWithPools;

export const interactivePool = new Workpool(workpoolComponents.interactiveWorkpool, {
	maxParallelism: 6,
	retryActionsByDefault: true,
	defaultRetryBehavior: {
		maxAttempts: 3,
		initialBackoffMs: 1_000,
		base: 2
	}
});

export const discoveryPool = new Workpool(workpoolComponents.discoveryWorkpool, {
	maxParallelism: 1,
	retryActionsByDefault: true,
	defaultRetryBehavior: {
		maxAttempts: 3,
		initialBackoffMs: 15 * 60 * 1000,
		base: 2
	}
});

export const statsPool = new Workpool(workpoolComponents.statsWorkpool, {
	maxParallelism: 1
});

export type CommandExecutor = 'bridge_poll' | 'workpool';

export function executorForCommandType(commandType: CommandType): CommandExecutor {
	void commandType;
	return 'bridge_poll';
}

export function poolForCommandType(commandType: CommandType) {
	if (commandType === 'library.title.stats.refresh') return statsPool;
	if (commandType === 'discovery.feed.crawl' || commandType === 'discovery.title.hydrate') {
		return discoveryPool;
	}
	return interactivePool;
}
