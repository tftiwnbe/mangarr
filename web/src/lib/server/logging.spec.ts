import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectWebProbeRequest, emitWebEvent, shouldLogRequestEvent } from './logging.js';

afterEach(() => {
	vi.restoreAllMocks();
});

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

	it('emits one canonical JSON line to stdout for info events', () => {
		const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
		const errorWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

		const payload = emitWebEvent('info', {
			event: 'http_request_completed',
			request_id: 'req-123',
			status: 200
		});

		expect(payload).toMatchObject({
			service: 'web',
			component: 'web',
			event: 'http_request_completed',
			request_id: 'req-123',
			status: 200
		});
		expect(write).toHaveBeenCalledTimes(1);
		expect(errorWrite).not.toHaveBeenCalled();
		expect(() => JSON.parse(String(write.mock.calls[0][0]).trim())).not.toThrow();
	});

	it('emits warn events to stderr without duplicating them to stdout', () => {
		const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
		const errorWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

		emitWebEvent('warn', {
			event: 'http_request_completed',
			request_id: 'req-456',
			status: 404
		});

		expect(write).not.toHaveBeenCalled();
		expect(errorWrite).toHaveBeenCalledTimes(1);
		expect(() => JSON.parse(String(errorWrite.mock.calls[0][0]).trim())).not.toThrow();
	});
});
