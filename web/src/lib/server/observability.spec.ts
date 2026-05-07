import { describe, expect, it } from 'vitest';

import { getOrCreateRequestId, normalizeIncomingRequestId } from './observability';

describe('server observability helpers', () => {
	it('preserves valid incoming request ids', () => {
		expect(normalizeIncomingRequestId('req-123.Trace_01')).toBe('req-123.Trace_01');
		expect(getOrCreateRequestId('req-123.Trace_01')).toBe('req-123.Trace_01');
	});

	it('rejects invalid incoming request ids', () => {
		expect(normalizeIncomingRequestId('')).toBeNull();
		expect(normalizeIncomingRequestId('  ')).toBeNull();
		expect(normalizeIncomingRequestId('../etc/passwd')).toBeNull();
		expect(normalizeIncomingRequestId('x'.repeat(129))).toBeNull();
	});

	it('generates ids for missing or invalid values', () => {
		expect(getOrCreateRequestId(null)).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
		);
		expect(getOrCreateRequestId('../etc/passwd')).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
		);
	});
});
