import { httpClient } from './client';
import { buildApiUrl } from './config';
import { ApiError, expectData, expectNoContent } from './errors';
import { getStoredApiKey } from './session';
import type { components } from './v2';

export type LibraryTitleSummary = components['schemas']['LibraryTitleSummary'];
export type LibraryTitleResource = components['schemas']['LibraryTitleResource'];
export type LibraryImportRequest = components['schemas']['LibraryImportRequest'];
export type LibraryImportResponse = components['schemas']['LibraryImportResponse'];
export type LibrarySourceMatchResource = components['schemas']['LibrarySourceMatchResource'];
export type LibraryLinkVariantRequest = components['schemas']['LibraryLinkVariantRequest'];
export type LibraryLinkVariantResponse = components['schemas']['LibraryLinkVariantResponse'];
export type LibraryMergeTitlesRequest = components['schemas']['LibraryMergeTitlesRequest'];
export type LibraryMergeTitlesResponse = components['schemas']['LibraryMergeTitlesResponse'];
export type LibraryChapterResource = components['schemas']['LibraryChapterResource'];
export type LibraryChapterPageResource = components['schemas']['LibraryChapterPageResource'];
export type LibraryReaderChapterResource = components['schemas']['LibraryReaderChapterResource'];
export type LibraryUserStatusResource = components['schemas']['LibraryUserStatusResource'];
export type LibraryUserStatusCreate = components['schemas']['LibraryUserStatusCreate'];
export type LibraryUserStatusUpdate = components['schemas']['LibraryUserStatusUpdate'];
export type LibraryCollectionResource = components['schemas']['LibraryCollectionResource'];
export type LibraryCollectionCreate = components['schemas']['LibraryCollectionCreate'];
export type LibraryCollectionUpdate = components['schemas']['LibraryCollectionUpdate'];
export type LibraryTitlePreferencesUpdate = components['schemas']['LibraryTitlePreferencesUpdate'];
export type LibraryChapterProgressResource = {
	chapter_id: number;
	page_index: number | null;
	comment: string | null;
	updated_at: string | null;
};

export type LibraryChapterProgressUpdate = {
	page_index?: number | null;
	comment?: string | null;
};

export type LibraryChapterCommentResource = {
	id: number;
	chapter_id: number;
	library_title_id: number;
	variant_id: number;
	chapter_name: string;
	chapter_number: number;
	page_index: number;
	message: string;
	created_at: string;
	updated_at: string;
};

export type LibraryChapterCommentCreate = {
	page_index: number;
	message: string;
};

export type LibraryChapterCommentUpdate = {
	page_index?: number;
	message?: string;
};

export async function listLibraryTitles(query?: {
	offset?: number;
	limit?: number;
	assigned_only?: boolean;
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

export async function listLibrarySourceMatches(
	titleId: number,
	query?: {
		lang?: string;
		limit_sources?: number;
		min_score?: number;
	}
): Promise<LibrarySourceMatchResource[]> {
	return expectData(
		await httpClient.GET('/api/v2/library/titles/{title_id}/source-matches', {
			params: {
				path: { title_id: titleId },
				query
			}
		}),
		'Unable to find source matches'
	);
}

export async function linkLibraryTitleVariant(
	titleId: number,
	payload: LibraryLinkVariantRequest
): Promise<LibraryLinkVariantResponse> {
	return expectData(
		await httpClient.POST('/api/v2/library/titles/{title_id}/variants/link', {
			params: { path: { title_id: titleId } },
			body: payload
		}),
		'Unable to link source variant'
	);
}

export async function mergeLibraryTitles(
	titleId: number,
	payload: LibraryMergeTitlesRequest
): Promise<LibraryMergeTitlesResponse> {
	return expectData(
		await httpClient.POST('/api/v2/library/titles/{title_id}/merge', {
			params: { path: { title_id: titleId } },
			body: payload
		}),
		'Unable to merge library titles'
	);
}

export async function listLibraryStatuses(): Promise<LibraryUserStatusResource[]> {
	return expectData(
		await httpClient.GET('/api/v2/library/statuses'),
		'Unable to load library statuses'
	);
}

export async function createLibraryStatus(
	payload: LibraryUserStatusCreate
): Promise<LibraryUserStatusResource> {
	return expectData(
		await httpClient.POST('/api/v2/library/statuses', { body: payload }),
		'Unable to create library status'
	);
}

export async function updateLibraryStatus(
	statusId: number,
	payload: LibraryUserStatusUpdate
): Promise<LibraryUserStatusResource> {
	return expectData(
		await httpClient.PUT('/api/v2/library/statuses/{status_id}', {
			params: { path: { status_id: statusId } },
			body: payload
		}),
		'Unable to update library status'
	);
}

export async function deleteLibraryStatus(statusId: number): Promise<void> {
	expectNoContent(
		await httpClient.DELETE('/api/v2/library/statuses/{status_id}', {
			params: { path: { status_id: statusId } }
		}),
		'Unable to delete library status'
	);
}

export async function listLibraryCollections(): Promise<LibraryCollectionResource[]> {
	return expectData(
		await httpClient.GET('/api/v2/library/collections'),
		'Unable to load library collections'
	);
}

export async function createLibraryCollection(
	payload: LibraryCollectionCreate
): Promise<LibraryCollectionResource> {
	return expectData(
		await httpClient.POST('/api/v2/library/collections', { body: payload }),
		'Unable to create collection'
	);
}

export async function updateLibraryCollection(
	collectionId: number,
	payload: LibraryCollectionUpdate
): Promise<LibraryCollectionResource> {
	return expectData(
		await httpClient.PUT('/api/v2/library/collections/{collection_id}', {
			params: { path: { collection_id: collectionId } },
			body: payload
		}),
		'Unable to update collection'
	);
}

export async function deleteLibraryCollection(collectionId: number): Promise<void> {
	expectNoContent(
		await httpClient.DELETE('/api/v2/library/collections/{collection_id}', {
			params: { path: { collection_id: collectionId } }
		}),
		'Unable to delete collection'
	);
}

export async function addTitleToLibraryCollection(
	collectionId: number,
	titleId: number
): Promise<void> {
	expectNoContent(
		await httpClient.POST('/api/v2/library/collections/{collection_id}/titles/{title_id}', {
			params: {
				path: {
					collection_id: collectionId,
					title_id: titleId
				}
			}
		}),
		'Unable to add title to collection'
	);
}

export async function removeTitleFromLibraryCollection(
	collectionId: number,
	titleId: number
): Promise<void> {
	expectNoContent(
		await httpClient.DELETE('/api/v2/library/collections/{collection_id}/titles/{title_id}', {
			params: {
				path: {
					collection_id: collectionId,
					title_id: titleId
				}
			}
		}),
		'Unable to remove title from collection'
	);
}

export async function updateLibraryTitlePreferences(
	titleId: number,
	payload: LibraryTitlePreferencesUpdate
): Promise<LibraryTitleResource> {
	return expectData(
		await httpClient.PATCH('/api/v2/library/titles/{title_id}/preferences', {
			params: { path: { title_id: titleId } },
			body: payload
		}),
		'Unable to update title preferences'
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

function getAuthHeaders(): Headers {
	const headers = new Headers();
	const apiKey = getStoredApiKey();
	if (apiKey) {
		headers.set('Authorization', `Bearer ${apiKey}`);
	}
	headers.set('Accept', 'application/json');
	return headers;
}

function toApiErrorFromResponse(response: Response, payload: unknown, fallback: string): ApiError {
	let message = fallback;
	if (typeof payload === 'string' && payload.trim().length > 0) {
		message = payload;
	} else if (
		payload &&
		typeof payload === 'object' &&
		'detail' in payload &&
		typeof (payload as { detail?: unknown }).detail === 'string'
	) {
		message = ((payload as { detail?: string }).detail ?? fallback).trim() || fallback;
	}
	return new ApiError(response.status, payload, message);
}

async function readJsonSafe(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

export async function listLibraryTitleChapterProgress(
	titleId: number,
	query?: { variant_id?: number | null }
): Promise<LibraryChapterProgressResource[]> {
	let url = buildApiUrl(`/api/v2/library/titles/${titleId}/chapter-progress`);
	if (query?.variant_id != null) {
		const separator = url.includes('?') ? '&' : '?';
		url = `${url}${separator}variant_id=${encodeURIComponent(String(query.variant_id))}`;
	}

	const response = await fetch(url, {
		method: 'GET',
		headers: getAuthHeaders()
	});
	const payload = await readJsonSafe(response);
	if (!response.ok) {
		throw toApiErrorFromResponse(response, payload, 'Unable to load chapter progress');
	}
	return Array.isArray(payload) ? (payload as LibraryChapterProgressResource[]) : [];
}

export async function getLibraryChapterProgress(
	chapterId: number
): Promise<LibraryChapterProgressResource> {
	const response = await fetch(buildApiUrl(`/api/v2/library/chapters/${chapterId}/progress`), {
		method: 'GET',
		headers: getAuthHeaders()
	});
	const payload = await readJsonSafe(response);
	if (!response.ok) {
		throw toApiErrorFromResponse(response, payload, 'Unable to load chapter progress');
	}
	return payload as LibraryChapterProgressResource;
}

export async function updateLibraryChapterProgress(
	chapterId: number,
	payload: LibraryChapterProgressUpdate
): Promise<LibraryChapterProgressResource> {
	const headers = getAuthHeaders();
	headers.set('Content-Type', 'application/json');
	const response = await fetch(buildApiUrl(`/api/v2/library/chapters/${chapterId}/progress`), {
		method: 'PATCH',
		headers,
		body: JSON.stringify(payload)
	});
	const body = await readJsonSafe(response);
	if (!response.ok) {
		throw toApiErrorFromResponse(response, body, 'Unable to update chapter progress');
	}
	return body as LibraryChapterProgressResource;
}

export async function listLibraryTitleComments(
	titleId: number,
	query?: { variant_id?: number | null; newest_first?: boolean }
): Promise<LibraryChapterCommentResource[]> {
	let url = buildApiUrl(`/api/v2/library/titles/${titleId}/comments`);
	const params = new URLSearchParams();
	if (query?.variant_id != null) {
		params.set('variant_id', String(query.variant_id));
	}
	if (query?.newest_first !== undefined) {
		params.set('newest_first', String(query.newest_first));
	}
	const queryString = params.toString();
	if (queryString) {
		url = `${url}${url.includes('?') ? '&' : '?'}${queryString}`;
	}
	const response = await fetch(url, { method: 'GET', headers: getAuthHeaders() });
	const payload = await readJsonSafe(response);
	if (!response.ok) {
		throw toApiErrorFromResponse(response, payload, 'Unable to load title comments');
	}
	return Array.isArray(payload) ? (payload as LibraryChapterCommentResource[]) : [];
}

export async function listLibraryChapterComments(
	chapterId: number,
	query?: { newest_first?: boolean }
): Promise<LibraryChapterCommentResource[]> {
	let url = buildApiUrl(`/api/v2/library/chapters/${chapterId}/comments`);
	if (query?.newest_first !== undefined) {
		url = `${url}?newest_first=${encodeURIComponent(String(query.newest_first))}`;
	}
	const response = await fetch(url, { method: 'GET', headers: getAuthHeaders() });
	const payload = await readJsonSafe(response);
	if (!response.ok) {
		throw toApiErrorFromResponse(response, payload, 'Unable to load chapter comments');
	}
	return Array.isArray(payload) ? (payload as LibraryChapterCommentResource[]) : [];
}

export async function createLibraryChapterComment(
	chapterId: number,
	payload: LibraryChapterCommentCreate
): Promise<LibraryChapterCommentResource> {
	const headers = getAuthHeaders();
	headers.set('Content-Type', 'application/json');
	const response = await fetch(buildApiUrl(`/api/v2/library/chapters/${chapterId}/comments`), {
		method: 'POST',
		headers,
		body: JSON.stringify(payload)
	});
	const body = await readJsonSafe(response);
	if (!response.ok) {
		throw toApiErrorFromResponse(response, body, 'Unable to create chapter comment');
	}
	return body as LibraryChapterCommentResource;
}

export async function updateLibraryChapterComment(
	commentId: number,
	payload: LibraryChapterCommentUpdate
): Promise<LibraryChapterCommentResource> {
	const headers = getAuthHeaders();
	headers.set('Content-Type', 'application/json');
	const response = await fetch(buildApiUrl(`/api/v2/library/chapter-comments/${commentId}`), {
		method: 'PUT',
		headers,
		body: JSON.stringify(payload)
	});
	const body = await readJsonSafe(response);
	if (!response.ok) {
		throw toApiErrorFromResponse(response, body, 'Unable to update chapter comment');
	}
	return body as LibraryChapterCommentResource;
}

export async function deleteLibraryChapterComment(commentId: number): Promise<void> {
	const response = await fetch(buildApiUrl(`/api/v2/library/chapter-comments/${commentId}`), {
		method: 'DELETE',
		headers: getAuthHeaders()
	});
	const payload = await readJsonSafe(response);
	if (!response.ok) {
		throw toApiErrorFromResponse(response, payload, 'Unable to delete chapter comment');
	}
}

export function getLibraryFileUrl(filePath: string): string {
	const encodedPath = filePath
		.split('/')
		.map((part) => encodeURIComponent(part))
		.join('/');
	const baseUrl = buildApiUrl(`/api/v2/library/files/${encodedPath}`);
	const apiKey = getStoredApiKey();
	if (!apiKey) {
		return baseUrl;
	}
	const separator = baseUrl.includes('?') ? '&' : '?';
	return `${baseUrl}${separator}api_key=${encodeURIComponent(apiKey)}`;
}
