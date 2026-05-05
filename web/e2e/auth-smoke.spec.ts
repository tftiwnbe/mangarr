import { expect, test } from '@playwright/test';

const USERNAME = process.env.MANGARR_E2E_USERNAME ?? 'admin';
const PASSWORD = process.env.MANGARR_E2E_PASSWORD ?? 'Admin12345';

test('clean stack can create or reuse the first admin and establish a session', async ({
	page
}) => {
	await page.goto('/login?redirect=%2Flibrary');
	await expect(page.getByRole('textbox', { name: /username/i })).toBeVisible();

	await page.getByLabel(/username/i).fill(USERNAME);
	await page.getByRole('textbox', { name: /password/i }).fill(PASSWORD);

	const createFirstAdminButton = page.getByRole('button', { name: /create first admin/i });
	if (await createFirstAdminButton.isVisible().catch(() => false)) {
		await createFirstAdminButton.click();
	} else {
		await page.getByRole('button', { name: /sign in/i }).click();
	}

	await page.waitForURL((url) => url.pathname === '/setup' || url.pathname === '/library');

	const authState = await page.evaluate(async () => {
		const response = await fetch('/api/auth/me');
		return {
			ok: response.ok,
			body: (await response.json()) as { username?: string; message?: string }
		};
	});
	expect(authState.ok).toBeTruthy();
	expect(authState.body.username).toBe(USERNAME);
});
