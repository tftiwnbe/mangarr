import { describe, expect, it } from 'vitest';

import { classifyPushFailure, deliveryTopic } from './notifications_push';

describe('notification push delivery policy', () => {
	it('revokes subscriptions that no longer exist', () => {
		expect(classifyPushFailure({ statusCode: 410 })).toMatchObject({
			outcome: 'permanent_failed',
			failureCode: 'subscription_gone',
			revokeDevice: true
		});
	});

	it('makes rejected subscriptions repairable and retries transient failures', () => {
		expect(classifyPushFailure({ statusCode: 403 })).toMatchObject({
			outcome: 'permanent_failed',
			failureCode: 'subscription_rejected',
			staleDevice: true
		});
		expect(
			classifyPushFailure({ statusCode: 429, headers: { 'retry-after': '120' } })
		).toMatchObject({
			outcome: 'retry',
			failureCode: 'provider_rate_limited',
			retryAfterMs: 120_000
		});
		expect(classifyPushFailure({ code: 'ETIMEDOUT' })).toMatchObject({
			outcome: 'retry',
			failureCode: 'network_etimedout'
		});
	});

	it('uses one replacement topic per title and distinct topics for tests', () => {
		const firstTitleEvent = deliveryTopic({
			_id: 'event-1' as never,
			libraryTitleId: 'title-1' as never
		});
		const secondTitleEvent = deliveryTopic({
			_id: 'event-2' as never,
			libraryTitleId: 'title-1' as never
		});
		const testEvent = deliveryTopic({ _id: 'event-2' as never, libraryTitleId: undefined });

		expect(firstTitleEvent).toBe(secondTitleEvent);
		expect(firstTitleEvent).not.toBe(testEvent);
		expect(firstTitleEvent.length).toBeLessThanOrEqual(32);
	});
});
