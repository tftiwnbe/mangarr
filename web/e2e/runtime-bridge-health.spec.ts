import { expect, test } from '@playwright/test';

import { assertAuthenticatedSession, authenticateCleanStack } from './helpers';

test('authenticated runtime exposes healthy bridge state in settings', async ({ page }) => {
	await authenticateCleanStack(page, '/settings');
	await assertAuthenticatedSession(page);
	await page.goto('/settings');
	await expect(page).toHaveURL(/\/settings$/);
	await page.getByRole('tab', { name: /system/i }).click();
	await expect(page.getByRole('heading', { name: 'settings', exact: true })).toBeVisible();
	await expect(page.getByText(/download settings/i)).toBeVisible();

	const health = await page.evaluate(async () => {
		const response = await fetch('/api/internal/bridge/health');
		return {
			ok: response.ok,
			body: (await response.json()) as {
				bridge?: { ready?: boolean; running?: boolean; status?: string };
				commands?: { lastError?: string | null };
			}
		};
	});

	expect(health.ok).toBeTruthy();
	expect(health.body.bridge?.running).toBeTruthy();
	expect(health.body.bridge?.ready).toBeTruthy();
	expect(health.body.bridge?.status).toBe('ready');
	expect(health.body.commands?.lastError ?? null).toBeNull();
});
