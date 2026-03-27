import { expect, type Locator, type Page } from '@playwright/test';

const USERNAME = process.env.MANGARR_E2E_USERNAME ?? 'admin';
const PASSWORD = process.env.MANGARR_E2E_PASSWORD ?? 'Admin12345';
const CONVEX_URL = process.env.MANGARR_E2E_CONVEX_URL ?? 'http://127.0.0.1:3210';

type HiddenLibraryTitle = {
	_id: string;
	title: string;
	sourceLang: string;
};

type VisibleLibraryTitle = {
	_id: string;
	title: string;
	chapterStats?: {
		total?: number;
	};
};

let cachedConvexToken: string | null = null;

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

async function getConvexToken(page: Page) {
	if (cachedConvexToken) {
		return cachedConvexToken;
	}

	const response = await page.request.post('/api/auth/convex-token');
	expect(response.ok()).toBeTruthy();
	const payload = (await response.json()) as { token?: string };
	expect(payload.token).toBeTruthy();
	cachedConvexToken = payload.token!;
	return cachedConvexToken;
}

async function callConvex<T>(
	page: Page,
	endpoint: '/api/query' | '/api/mutation',
	path: string,
	args: Record<string, unknown>
) {
	const token = await getConvexToken(page);
	const response = await page.request.post(`${CONVEX_URL}${endpoint}`, {
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json'
		},
		data: {
			path,
			format: 'convex_encoded_json',
			args: [args]
		}
	});
	expect(response.ok()).toBeTruthy();
	const payload = (await response.json()) as { status?: string; value?: T; errorMessage?: string };
	expect(payload.status).toBe('success');
	return payload.value as T;
}

async function listVisibleLibraryTitles(page: Page) {
	return callConvex<VisibleLibraryTitle[]>(page, '/api/query', 'library:listMine', {});
}

async function listHiddenLibraryTitles(page: Page) {
	return callConvex<HiddenLibraryTitle[]>(page, '/api/query', 'library:listHiddenMine', {});
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

	const feedCard = page.locator('a[href^="/title/open"]').first();
	if ((await feedCard.count()) > 0) {
		await expect(feedCard).toBeVisible();
		return feedCard;
	}

	await page.getByRole('button', { name: /^Search$/ }).click();
	const preferredSource = page.getByRole('button', { name: /^MangaDex/i }).first();
	if ((await preferredSource.count()) > 0) {
		await preferredSource.click();
	} else {
		await page
			.locator('button')
			.filter({ hasNot: page.getByRole('button', { name: /^Search$/ }) })
			.nth(1)
			.click();
	}
	await page.getByRole('searchbox').fill('man');
	await expect(page.getByText(/Loading/i)).not.toBeVisible({ timeout: 30_000 });

	const searchCard = page.locator('a[href^="/title/open"]').first();
	await expect(searchCard).toBeVisible({ timeout: 30_000 });
	return searchCard;
}

export async function ensureHiddenImportExists(page: Page): Promise<{
	title: string;
	sourceLabel: string;
}> {
	let hiddenTitles = await listHiddenLibraryTitles(page);
	if (hiddenTitles.length === 0) {
		const card = await firstExploreImportCard(page);
		await card.click();
		await page.waitForURL(/\/title\/.+--/);
		hiddenTitles = await listHiddenLibraryTitles(page);
	}

	expect(hiddenTitles.length).toBeGreaterThan(0);

	await page.goto('/library');
	const hiddenButton = page.getByRole('button', { name: /Hidden \((\d+)\)/ });
	await expect(hiddenButton).toBeVisible();
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

export async function ensureVisibleLibraryTitle(page: Page) {
	let visibleTitles = await listVisibleLibraryTitles(page);
	if (visibleTitles.length === 0) {
		let hiddenTitles = await listHiddenLibraryTitles(page);
		if (hiddenTitles.length === 0) {
			await ensureHiddenImportExists(page);
			hiddenTitles = await listHiddenLibraryTitles(page);
		}
		expect(hiddenTitles.length).toBeGreaterThan(0);
		await callConvex(page, '/api/mutation', 'library:setTitleListedInLibrary', {
			titleId: hiddenTitles[0]!._id,
			listed: true
		});
		visibleTitles = await listVisibleLibraryTitles(page);
	}
	expect(visibleTitles.length).toBeGreaterThan(0);

	await page.goto('/library');
	const visibleCards = page.locator('a[href^="/title/"]');
	await expect(visibleCards.first()).toBeVisible();
	const href = await visibleCards.first().getAttribute('href');
	expect(href).toBeTruthy();
	return href!;
}

export async function ensureReadableLibraryTitlePath(page: Page) {
	let visibleTitles = await listVisibleLibraryTitles(page);
	if (visibleTitles.length === 0) {
		await ensureVisibleLibraryTitle(page);
		visibleTitles = await listVisibleLibraryTitles(page);
	}

	const readableTitle =
		visibleTitles.find((title) => Number(title.chapterStats?.total ?? 0) > 0) ?? visibleTitles[0];
	expect(readableTitle).toBeTruthy();

	return `/title/${readableTitle!._id}`;
}

export async function ensureDownloadedChapter(page: Page, titlePath: string) {
	await page.goto(titlePath);
	await expect(page.getByRole('button', { name: /^Chapters/i })).toBeVisible();
	await page.getByRole('button', { name: /^Chapters/i }).click();

	const chapterRows = page.locator('[data-testid="chapter-row"]');
	await expect(chapterRows.first()).toBeVisible();

	const downloadedRows = page.locator('[data-testid="chapter-row"][data-download-status="downloaded"]');
	if ((await downloadedRows.count()) > 0) {
		return downloadedRows.first();
	}

	const downloadButton = page.locator('[data-testid="chapter-download"]').first();
	await expect(downloadButton).toBeVisible();
	const row = downloadButton.locator('xpath=ancestor::*[@data-testid="chapter-row"][1]');
	await downloadButton.click();

	await expect
		.poll(async () => (await row.getAttribute('data-download-status')) ?? '', {
			timeout: 120_000
		})
		.toBe('downloaded');

	return row;
}
