import { expect, test } from '@playwright/test';

import { ensureReadableLibraryTitlePath, login } from './helpers';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
	await login(page);
});

test('title page exposes source status and offline preparation controls', async ({ page }) => {
	const titlePath = await ensureReadableLibraryTitlePath(page);
	await page.goto(titlePath);
	await expect(page).toHaveURL(/\/title\/[^/?#]+$/);
	await expect(page.getByRole('button', { name: /Prepare offline/i })).toBeVisible();
	await expect(page.getByRole('button', { name: /Refresh source/i })).toBeVisible();
	await expect(
		page
			.locator('p, span')
			.filter({
				hasText: /^Reading source$/
			})
			.first()
	).toBeVisible();
	await expect(
		page.getByText(/Offline ready|Offline partially ready|Title page cached|Offline prep needed/i)
	).toBeVisible();
});
