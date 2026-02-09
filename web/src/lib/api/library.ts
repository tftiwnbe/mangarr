import { httpClient } from './client';
import { buildApiUrl } from './config';
import { expectData } from './errors';
import type { components } from './v2';

export type LibraryTitleSummary = components['schemas']['LibraryTitleSummary'];
export type LibraryTitleResource = components['schemas']['LibraryTitleResource'];
export type LibraryImportRequest = components['schemas']['LibraryImportRequest'];
export type LibraryImportResponse = components['schemas']['LibraryImportResponse'];
export type LibraryChapterResource = components['schemas']['LibraryChapterResource'];
export type LibraryChapterPageResource = components['schemas']['LibraryChapterPageResource'];
export type LibraryReaderChapterResource = components['schemas']['LibraryReaderChapterResource'];

export async function listLibraryTitles(query?: {
	offset?: number;
	limit?: number;
}): Promise<LibraryTitleSummary[]> {
	return expectData(
		await httpClient.GET('/api/v2/library/titles', { params: { query } }),
		'Unable to load library titles'
	);
}

export async function getLibraryTitle(titleId: number): Promise<LibraryTitleResource> {
	return expectData(
		await httpClient.GET('/api/v2/library/titles/{title_id}', {
			params: { path: { title_id: titleId } }
		}),
		'Unable to load library title'
	);
}

export async function importLibraryTitle(
	payload: LibraryImportRequest
): Promise<LibraryImportResponse> {
	return expectData(
		await httpClient.POST('/api/v2/library/import', { body: payload }),
		'Unable to import library title'
	);
}

export async function listLibraryTitleChapters(
	titleId: number,
	query?: {
		variant_id?: number | null;
		refresh?: boolean;
	}
): Promise<LibraryChapterResource[]> {
	return expectData(
		await httpClient.GET('/api/v2/library/titles/{title_id}/chapters', {
			params: {
				path: { title_id: titleId },
				query
			}
		}),
		'Unable to load title chapters'
	);
}

export async function getLibraryChapterPages(
	chapterId: number,
	refresh = false
): Promise<LibraryChapterPageResource[]> {
	return expectData(
		await httpClient.GET('/api/v2/library/chapters/{chapter_id}/pages', {
			params: {
				path: { chapter_id: chapterId },
				query: { refresh }
			}
		}),
		'Unable to load chapter pages'
	);
}

export async function getLibraryChapterReader(
	chapterId: number,
	refresh = false
): Promise<LibraryReaderChapterResource> {
	return expectData(
		await httpClient.GET('/api/v2/library/chapters/{chapter_id}/reader', {
			params: {
				path: { chapter_id: chapterId },
				query: { refresh }
			}
		}),
		'Unable to load reader chapter'
	);
}

export function getLibraryFileUrl(filePath: string): string {
	const encodedPath = filePath
		.split('/')
		.map((part) => encodeURIComponent(part))
		.join('/');
	return buildApiUrl(`/api/v2/library/files/${encodedPath}`);
}
