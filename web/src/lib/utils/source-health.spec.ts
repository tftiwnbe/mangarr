import { describe, expect, it } from 'vitest';

import {
	isPermanentSourceFailure,
	sourceHealthLabelKey,
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
});
