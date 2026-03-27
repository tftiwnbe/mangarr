import { expect, type Locator, type Page } from '@playwright/test';

const USERNAME = process.env.MANGARR_E2E_USERNAME ?? 'admin';
const PASSWORD = process.env.MANGARR_E2E_PASSWORD ?? 'Admin12345';

export async function login(page: Page) {
	await page.goto('/login?redirect=%2Flibrary');
	await page.waitForURL((url) => url.pathname.startsWith('/library') || url.pathname.startsWith('/login'));
	if (!page.url().includes('/login')) {
		return;
	}

	await expect(page.getByRole('textbox', { name: /username/i })).toBeVisible();
	await page.getByLabel(/username/i).fill(USERNAME);
	await page.getByRole('textbox', { name: /password/i }).fill(PASSWORD);
	await page.getByRole('button', { name: /sign in/i }).click();
	await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

export async function firstExploreImportCard(page: Page): Promise<Locator> {
	await page.goto('/explore');
	const mangadexCard = page.locator(
		'a[href^="/title/open"][href*="source_pkg=eu.kanade.tachiyomi.extension.all.mangadex"]'
	).first();
	if ((await mangadexCard.count()) > 0) {
		await expect(mangadexCard).toBeVisible();
		return mangadexCard;
	}
	const card = page.locator('a[href^="/title/open"]').first();
	await expect(card).toBeVisible();
	return card;
}

export async function ensureHiddenImportExists(page: Page) {
	await page.goto('/library');
	const hiddenButton = page.getByRole('button', { name: /Hidden \(\d+\)/ });
	if ((await hiddenButton.count()) > 0) {
		return;
	}

	const card = await firstExploreImportCard(page);
	await card.click();
	await page.waitForURL(/\/title\/.+--/);
	await page.goto('/library');
	await expect(hiddenButton).toBeVisible();
}

export async function openReaderFromTitle(page: Page, titlePath: string) {
	await page.goto(titlePath);
	await expect(page.getByRole('button', { name: /^Start Reading$/ })).toBeVisible();
	await page.getByRole('button', { name: /^Start Reading$/ }).click();
	await page.waitForURL(/\/reader\/.+/);
}
