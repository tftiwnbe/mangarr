import { ClientError } from './auth';

export type RepoExtensionResource = {
	pkg: string;
	name: string;
	version: string;
	lang: string;
	nsfw: boolean;
	sources: Array<{
		id: string;
		name: string;
		lang: string;
		supportsLatest: boolean;
	}>;
};

async function parseJson<T>(response: Response): Promise<T> {
	if (response.status === 204) {
		return undefined as T;
	}
	const data = (await response.json().catch(() => null)) as { message?: string } | null;
	if (!response.ok) {
		throw new ClientError(
			data?.message || response.statusText || 'Request failed',
			response.status
		);
	}
	return data as T;
}

export async function getExtensionRepository() {
	const response = await fetch('/api/extensions/repository');
	return parseJson<{ url: string; configured: boolean }>(response);
}

export async function updateExtensionRepository(payload: { url: string }) {
	const response = await fetch('/api/extensions/repository', {
		method: 'PUT',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify(payload)
	});
	return parseJson<RepoExtensionResource[]>(response);
}
