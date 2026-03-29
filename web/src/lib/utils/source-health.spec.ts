import { describe, expect, it } from 'vitest';

import {
	effectiveSourceHealthState,
	isPermanentSourceFailure,
	sourceHealthLabelKey,
	sourceHealthRetryInMinutes,
	sourceHealthScopeForCommandType
} from './source-health';

describe('source health', () => {
	it('maps bridge command types to UI scopes', () => {
		expect(sourceHealthScopeForCommandType('explore.popular')).toBe('feed');
		expect(sourceHealthScopeForCommandType('explore.search')).toBe('search');
		expect(sourceHealthScopeForCommandType('explore.title.fetch')).toBe('title');
		expect(sourceHealthScopeForCommandType('downloads.chapter')).toBeNull();
	});

	it('classifies permanent upstream failures', () => {
		expect(isPermanentSourceFailure('HTTP error 403')).toBe(true);
		expect(isPermanentSourceFailure('Unsupported source operation')).toBe(true);
		expect(isPermanentSourceFailure('HTTP error 429')).toBe(false);
	});

	it('maps entries to stable label keys', () => {
		expect(sourceHealthLabelKey({ state: 'cooldown', permanent: false })).toBe(
			'explore.sourceCooldown'
		);
		expect(sourceHealthLabelKey({ state: 'degraded', permanent: true })).toBe(
			'explore.sourceUnavailable'
		);
		expect(sourceHealthLabelKey({ state: 'degraded', permanent: false })).toBe(
			'explore.sourceDegraded'
		);
	});

	it('derives cooldown vs degraded state from retry windows', () => {
		const now = Date.UTC(2026, 2, 28, 12, 0, 0);
		expect(
			effectiveSourceHealthState(
				{
					retryAfter: now + 5 * 60_000,
					permanent: false
				},
				now
			)
		).toBe('cooldown');
		expect(
			effectiveSourceHealthState(
				{
					retryAfter: now - 1_000,
					permanent: false
				},
				now
			)
		).toBe('degraded');
		expect(
			effectiveSourceHealthState(
				{
					retryAfter: now + 5 * 60_000,
					permanent: true
				},
				now
			)
		).toBe('degraded');
	});

	it('formats retry windows in whole minutes', () => {
		const now = Date.UTC(2026, 2, 28, 12, 0, 0);
		expect(sourceHealthRetryInMinutes(now + 30_000, now)).toBe(1);
		expect(sourceHealthRetryInMinutes(now + 5 * 60_000, now)).toBe(5);
		expect(sourceHealthRetryInMinutes(now, now)).toBeNull();
		expect(sourceHealthRetryInMinutes(null, now)).toBeNull();
	});
});
