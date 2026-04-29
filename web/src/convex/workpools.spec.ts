import { describe, expect, it } from 'vitest';

import { executorForCommandType, poolForCommandType, statsPool } from './workpools';

describe('workpool command routing', () => {
	it('keeps chapter downloads on the bridge poller', () => {
		expect(executorForCommandType('downloads.chapter')).toBe('bridge_poll');
	});

	it('routes short bridge commands to Workpool', () => {
		expect(executorForCommandType('explore.search')).toBe('workpool');
		expect(executorForCommandType('library.title.stats.refresh')).toBe('workpool');
	});

	it('uses the dedicated stats pool for title stats refreshes', () => {
		expect(poolForCommandType('library.title.stats.refresh')).toBe(statsPool);
	});
});
