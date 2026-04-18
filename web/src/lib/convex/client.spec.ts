import { describe, expect, it } from 'vitest';

import { resolveBrowserConvexUrl } from './client';

describe('convex client URL resolution', () => {
	it('rewrites loopback convex URLs to the current browser origin', () => {
		expect(
			resolveBrowserConvexUrl('http://127.0.0.1:3210/convex', {
				hostname: 'mangarr.hmphin.space',
				protocol: 'https:',
				origin: 'https://mangarr.hmphin.space'
			})
		).toBe('https://mangarr.hmphin.space/convex');
	});

	it('upgrades insecure same-app convex URLs under https', () => {
		expect(
			resolveBrowserConvexUrl('http://mangarr.hmphin.space:3737/convex', {
				hostname: 'mangarr.hmphin.space',
				protocol: 'https:',
				origin: 'https://mangarr.hmphin.space'
			})
		).toBe('https://mangarr.hmphin.space/convex');
	});

	it('keeps already secure external convex URLs unchanged', () => {
		expect(
			resolveBrowserConvexUrl('https://convex.example.com', {
				hostname: 'mangarr.hmphin.space',
				protocol: 'https:',
				origin: 'https://mangarr.hmphin.space'
			})
		).toBe('https://convex.example.com');
	});
});
