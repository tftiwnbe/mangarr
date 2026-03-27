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

export async function ensureHiddenImportExists(page: Page): Promise<{
	title: string;
	sourceLabel: string;
}> {
	await page.goto('/library');
	const hiddenButton = page.getByRole('button', { name: /Hidden \(\d+\)/ });
	if ((await hiddenButton.count()) === 0) {
		const card = await firstExploreImportCard(page);
		await card.click();
		await page.waitForURL(/\/title\/.+--/);
		await page.goto('/library');
		await expect(hiddenButton).toBeVisible();
	}

	await hiddenButton.click();
	const panel = page.getByRole('dialog', { name: /Manage Hidden Imports/i });
	await expect(panel).toBeVisible();
	const firstShowButton = panel.getByRole('button', { name: 'Show in Library' }).first();
	const firstRow = firstShowButton.locator(
		'xpath=ancestor::div[contains(@class, "border") and contains(@class, "p-3")]'
	);
	await expect(firstRow).toBeVisible();
	const title = ((await firstRow.locator('p').nth(0).textContent()) ?? '').trim();
	const sourceLabel = ((await firstRow.locator('p').nth(1).textContent()) ?? '').trim();
	expect(title.length).toBeGreaterThan(0);
	return { title, sourceLabel };
}

export async function openReaderFromTitle(page: Page, titlePath: string) {
	await page.goto(titlePath);
	await expect(page.getByRole('button', { name: /^Start Reading$/ })).toBeVisible();
	await page.getByRole('button', { name: /^Start Reading$/ }).click();
	await page.waitForURL(/\/reader\/.+/);
}
