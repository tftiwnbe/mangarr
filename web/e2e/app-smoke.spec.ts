import { expect, test } from '@playwright/test';

import { ensureHiddenImportExists, login, openReaderFromTitle } from './helpers';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
	await login(page);
});

test('opens a library title page from the library grid', async ({ page }) => {
	await page.goto('/library');
	const chainsawCard = page.locator('a[href*="chainsaw-man"]').first();
	await expect(chainsawCard).toBeVisible();
	await chainsawCard.click();

	await expect(page).toHaveURL(/\/title\/.+--chainsaw-man/);
	await expect(page.getByRole('heading', { name: /chainsaw man/i })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Chapters/i })).toBeVisible();
});

test('opens an explore title and redirects into the real title page', async ({ page }) => {
	await expect(async () => {
		await page.goto('/explore');
		await page.getByRole('button', { name: /^MangaDex /i }).click();
		const card = page
			.locator('a[href^="/title/open"][href*="source_pkg=eu.kanade.tachiyomi.extension.all.mangadex"]')
			.first();
		await expect(card).toBeVisible();
		await card.click();
		await page.waitForURL(/\/title\/.+--/);
		await expect(page.getByRole('heading').first()).toBeVisible();
	}).toPass();
});

test('shows hidden imports in the library management panel', async ({ page }) => {
	await ensureHiddenImportExists(page);

	await page.goto('/library');
	const hiddenButton = page.getByRole('button', { name: /Hidden \((\d+)\)/ });
	await expect(hiddenButton).toBeVisible();
	const label = (await hiddenButton.textContent()) ?? '';
	const match = label.match(/\((\d+)\)/);
	expect(match).not.toBeNull();
	const expectedCount = Number(match?.[1] ?? '0');
	expect(expectedCount).toBeGreaterThan(0);

	await hiddenButton.click();
	const panel = page.getByRole('dialog', { name: /Manage Hidden Imports/i });
	await expect(panel).toBeVisible();
	await expect(panel.getByRole('button', { name: 'Show in Library' })).toHaveCount(expectedCount);
});

test('supports filter-only advanced search from explore', async ({ page }) => {
	await page.goto('/explore');
	await page.getByRole('button', { name: /^Search$/ }).click();
	const mangadexSource = page.getByRole('button', { name: /^MangaDex/i }).first();
	await mangadexSource.click();
	await page.getByRole('button', { name: /Advanced Filters/i }).click();

	const filtersPanel = page.getByRole('dialog', { name: /Advanced Filters/i });
	await expect(filtersPanel).toBeVisible();

	const checkboxFilters = filtersPanel.locator('input[type="checkbox"]');
	if ((await checkboxFilters.count()) > 0) {
		await checkboxFilters.first().check();
	} else {
		const selectFilters = filtersPanel.locator('select');
		await expect(selectFilters.first()).toBeVisible();
		const optionValues = await selectFilters.first().locator('option').evaluateAll((options) =>
			options.map((option) => ({ value: option.getAttribute('value') ?? '', disabled: option.disabled }))
		);
		const nextValue = optionValues.find((option, index) => index > 0 && option.value && !option.disabled);
		expect(nextValue).toBeTruthy();
		await selectFilters.first().selectOption(nextValue!.value);
	}

	await filtersPanel.getByRole('button', { name: /^Apply$/ }).click();
	await expect(page.getByRole('searchbox')).toHaveValue('');
	await expect(page.getByText(/Loading/i)).toBeVisible();
	await expect(page.getByText(/Loading/i)).not.toBeVisible({ timeout: 30_000 });
	await expect.poll(async () => page.locator('a[href*="/title/"]').count(), { timeout: 30_000 }).toBeGreaterThan(0);
});

test('opens the reader and loads page images', async ({ page }) => {
	await openReaderFromTitle(page, '/title/k17db0h6nk46qccx6bn5gb1vcd83jnym--chainsaw-man');
	await expect
		.poll(async () =>
			page.evaluate(() =>
				Array.from(document.querySelectorAll<HTMLImageElement>('img[alt^="Page "]')).some((img) => {
					const style = window.getComputedStyle(img);
					return img.naturalWidth > 0 && style.opacity !== '0' && style.visibility !== 'hidden';
				})
			)
		)
		.toBe(true);
});
