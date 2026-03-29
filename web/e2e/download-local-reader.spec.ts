import { expect, test, type APIRequestContext } from '@playwright/test';

const USERNAME = process.env.MANGARR_E2E_USERNAME ?? 'admin';
const PASSWORD = process.env.MANGARR_E2E_PASSWORD ?? 'Admin12345';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3737';
const CONVEX_URL = process.env.MANGARR_E2E_CONVEX_URL ?? 'http://127.0.0.1:3210';

test.setTimeout(300_000);

async function login(request: APIRequestContext) {
	const response = await request.post(`${BASE_URL}/api/auth/login`, {
		data: {
			username: USERNAME,
			password: PASSWORD
		}
	});
	expect(response.ok()).toBeTruthy();
}

async function getConvexToken(request: APIRequestContext) {
	const response = await request.post(`${BASE_URL}/api/auth/convex-token`);
	expect(response.ok()).toBeTruthy();
	const payload = (await response.json()) as { token?: string };
	expect(payload.token).toBeTruthy();
	return payload.token!;
}

async function callConvex<T>(
	request: APIRequestContext,
	token: string,
	endpoint: '/api/query' | '/api/mutation',
	path: string,
	args: Record<string, unknown>
) {
	const response = await request.post(`${CONVEX_URL}${endpoint}`, {
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
	const payload = (await response.json()) as { status?: string; value?: T };
	expect(payload.status).toBe('success');
	return payload.value as T;
}

async function listCandidateTitles(request: APIRequestContext, token: string) {
	const [visibleTitles, hiddenTitles] = await Promise.all([
		callConvex<
			Array<{
				_id: string;
				title: string;
				chapterStats?: { total?: number };
			}>
		>(request, token, '/api/query', 'library:listMine', {}),
		callConvex<
			Array<{
				_id: string;
				title: string;
				chapterStats?: { total?: number };
			}>
		>(request, token, '/api/query', 'library:listHiddenMine', {})
	]);

	return [...visibleTitles, ...hiddenTitles];
}

test('downloaded chapters are readable from the local bridge page endpoint', async ({ request }) => {
	await login(request);
	const token = await getConvexToken(request);

	const titles = await listCandidateTitles(request, token);
	expect(titles.length).toBeGreaterThan(0);

	const readableTitle = titles.find((title) => Number(title.chapterStats?.total ?? 0) > 0) ?? titles[0];
	expect(readableTitle).toBeTruthy();

	const chapters = await callConvex<
		Array<{
			_id: string;
			downloadStatus: string;
			localRelativePath?: string | null;
			storageKind?: string | null;
			totalPages?: number | null;
		}>
	>(request, token, '/api/query', 'library:listTitleChapters', {
		titleId: readableTitle!._id
	});
	expect(chapters.length).toBeGreaterThan(0);

	let chapter =
		chapters.find(
			(item) =>
				item.downloadStatus === 'downloaded' &&
				item.localRelativePath &&
				item.storageKind &&
				Number(item.totalPages ?? 0) > 0
		) ?? chapters[0]!;

	if (chapter.downloadStatus !== 'downloaded' || !chapter.localRelativePath || !chapter.storageKind) {
		const queued = await callConvex<{ taskId?: string }>(
			request,
			token,
			'/api/mutation',
			'library:requestChapterDownload',
			{
				chapterId: chapter._id
			}
		);
		expect(queued).toBeTruthy();

		await callConvex(request, token, '/api/mutation', 'library:runDownloadCycle', {
			limit: 4
		});

		await expect
			.poll(
				async () =>
					callConvex<{
						_id: string;
						downloadStatus: string;
						localRelativePath?: string | null;
						storageKind?: string | null;
						totalPages?: number | null;
					}>(request, token, '/api/query', 'library:getMineChapterById', {
						chapterId: chapter._id
					}),
				{ timeout: 240_000 }
			)
			.toMatchObject({
				downloadStatus: 'downloaded'
			});

		chapter = await callConvex<{
			_id: string;
			downloadStatus: string;
			localRelativePath?: string | null;
			storageKind?: string | null;
			totalPages?: number | null;
		}>(request, token, '/api/query', 'library:getMineChapterById', {
			chapterId: chapter._id
		});
	}

	expect(chapter.localRelativePath).toBeTruthy();
	expect(chapter.storageKind).toBeTruthy();

	const pageResponse = await request.get(
		`${BASE_URL}/api/internal/bridge/library/page?path=${encodeURIComponent(chapter.localRelativePath!)}&index=0`
	);
	expect(pageResponse.ok()).toBeTruthy();
	expect(pageResponse.headers()['content-type']).toMatch(/^image\//);
});
