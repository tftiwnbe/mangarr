import { describe, expect, it } from 'vitest';

import { executorForCommandType, poolForCommandType, statsPool } from './workpools';

describe('workpool command routing', () => {
	it('routes chapter downloads through the bridge poller', () => {
		expect(executorForCommandType('downloads.chapter')).toBe('bridge_poll');
	});

	it('routes other commands through the bridge poller too', () => {
		expect(executorForCommandType('explore.search')).toBe('bridge_poll');
		expect(executorForCommandType('library.title.stats.refresh')).toBe('bridge_poll');
	});

	it('uses the dedicated stats pool for title stats refreshes', () => {
		expect(poolForCommandType('library.title.stats.refresh')).toBe(statsPool);
	});
});
