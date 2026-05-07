import { describe, expect, it } from 'vitest';

import { detectWebProbeRequest, shouldLogRequestEvent } from './logging.js';

describe('web logging policy', () => {
	it('detects loopback health probes to the login page', () => {
		expect(detectWebProbeRequest('/login', '127.0.0.1')).toBe(true);
		expect(detectWebProbeRequest('/login', '::1')).toBe(true);
		expect(detectWebProbeRequest('/login', '203.0.113.7')).toBe(false);
	});

	it('suppresses routine probe successes', () => {
		expect(
			shouldLogRequestEvent({
				status: 200,
				durationMs: 12,
				pathname: '/login',
				isProbe: true
			})
		).toBe(false);
	});

	it('suppresses known browser probe 404s', () => {
		expect(
			shouldLogRequestEvent({
				status: 404,
				durationMs: 3,
				pathname: '/apple-touch-icon-precomposed.png'
			})
		).toBe(false);
	});

	it('keeps slow successful requests and failures', () => {
		expect(
			shouldLogRequestEvent({
				status: 200,
				durationMs: 1_250,
				pathname: '/reader/example/ch-1'
			})
		).toBe(true);
		expect(
			shouldLogRequestEvent({
				status: 502,
				durationMs: 20,
				pathname: '/api/internal/bridge/runtime'
			})
		).toBe(true);
	});

	it('uses a higher slow threshold for remote cover proxy requests', () => {
		expect(
			shouldLogRequestEvent({
				status: 200,
				durationMs: 6_500,
				pathname: '/api/covers/proxy'
			})
		).toBe(false);
		expect(
			shouldLogRequestEvent({
				status: 200,
				durationMs: 10_500,
				pathname: '/api/covers/proxy'
			})
		).toBe(true);
	});

	it('uses a higher slow threshold for bridge reader page requests', () => {
		expect(
			shouldLogRequestEvent({
				status: 200,
				durationMs: 3_500,
				pathname: '/api/internal/bridge/reader/page'
			})
		).toBe(false);
		expect(
			shouldLogRequestEvent({
				status: 200,
				durationMs: 5_200,
				pathname: '/api/internal/bridge/reader/page'
			})
		).toBe(true);
	});
});
