export type UserProfile = {
	id: string;
	username: string;
	is_admin: boolean;
	created_at: string;
	last_login_at?: string | null;
};

export class ClientError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'ClientError';
		this.status = status;
	}
}

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

export async function getSetupStatus() {
	const response = await fetch('/api/auth/setup-status');
	return parseJson<{ needs_setup: boolean }>(response);
}

export async function registerFirstUser(payload: { username: string; password: string }) {
	const response = await fetch('/api/auth/register-first-user', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload)
	});
	return parseJson<{ user: UserProfile }>(response);
}

export async function login(payload: { username: string; password: string; remember_me: boolean }) {
	const response = await fetch('/api/auth/login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload)
	});
	return parseJson<{ user: UserProfile; issued_at: string }>(response);
}

export async function getMe() {
	const response = await fetch('/api/auth/me');
	return parseJson<UserProfile>(response);
}

export async function getPostLoginRedirect(redirect?: string) {
	const params = new URLSearchParams();
	if (redirect) {
		params.set('redirect', redirect);
	}
	const query = params.toString();
	const response = await fetch(`/api/auth/post-login-redirect${query ? `?${query}` : ''}`);
	return parseJson<{ redirect: string }>(response);
}

export async function signOut() {
	const response = await fetch('/api/auth/logout', { method: 'POST' });
	await parseJson<{ ok: boolean }>(response);
}
