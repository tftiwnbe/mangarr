export type FilterMeta = {
	key: string;
	title: string;
	summary?: string;
	type: string;
	enabled?: boolean;
	visible?: boolean;
	default_value?: unknown;
	current_value?: unknown;
	entries?: string[];
	entry_values?: string[];
};

export type FilterItem = {
	name: string;
	type: string;
	data: FilterMeta;
};

export type PreferenceBundle = {
	source: { id: string; name: string; lang: string; supportsLatest: boolean };
	preferences: FilterItem[];
	searchFilters: FilterItem[];
};

export type SourcePreference = {
	key: string;
	title: string;
	summary?: string;
	type: string;
	enabled: boolean;
	visible: boolean;
	default_value?: unknown;
	current_value?: unknown;
	entries?: string[];
	entry_values?: string[];
};

export type SourcePreferencesResolved = {
	source_id: string;
	name: string;
	lang: string;
	preferences: SourcePreference[];
	searchFilters: SourcePreference[];
};

export function deletePreferenceValue() {
	return { __mangarr_delete_preference__: true };
}

export function buildPreferenceEntries(
	entries: Iterable<readonly [string, unknown]>
): Array<{ key: string; value: unknown }> {
	return Array.from(entries, ([key, value]) => ({
		key,
		value: value ?? deletePreferenceValue()
	}));
}

export function mapSourcePreferencesBundle(bundle: PreferenceBundle): SourcePreferencesResolved {
	return {
		source_id: bundle.source.id,
		name: bundle.source.name,
		lang: bundle.source.lang,
		preferences: bundle.preferences.map((item) => ({
			key: item.data.key,
			title: item.data.title || item.name || item.data.key,
			summary: item.data.summary,
			type: item.data.type || item.type || 'text',
			enabled: item.data.enabled !== false,
			visible: item.data.visible !== false,
			default_value: item.data.default_value,
			current_value: item.data.current_value,
			entries: item.data.entries,
			entry_values: item.data.entry_values
		})),
		searchFilters: bundle.searchFilters.map((item) => ({
			key: item.data.key,
			title: item.data.title || item.name || item.data.key,
			summary: item.data.summary,
			type: item.data.type || item.type || 'text',
			enabled: item.data.enabled !== false,
			visible: item.data.visible !== false,
			default_value: item.data.default_value,
			current_value: item.data.current_value,
			entries: item.data.entries,
			entry_values: item.data.entry_values
		}))
	};
}

export function parseImportedStorageInput(input: string): Record<string, unknown> {
	const trimmed = input.trim();
	if (!trimmed) throw new Error('Paste JSON or key-value storage dump first.');
	try {
		const parsed = JSON.parse(trimmed);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error('Top-level JSON must be an object.');
		}
		return parsed as Record<string, unknown>;
	} catch {
		const loose = parseLooseKeyValueInput(trimmed);
		if (loose) return loose;
		throw new Error(
			'Unable to parse input. Expected JSON object or lines in format: key <json/value>.'
		);
	}
}

export function normalizeImportedStoragePayload(
	raw: Record<string, unknown>
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(raw)) {
		const normalizedKey = key.trim();
		if (!normalizedKey) continue;
		const parsed = normalizePreferenceValue(normalizedKey, parsePossiblyStringifiedJson(value));
		if (
			typeof parsed === 'string' ||
			typeof parsed === 'number' ||
			typeof parsed === 'boolean' ||
			parsed === null
		) {
			out[normalizedKey] = parsed;
		} else {
			out[normalizedKey] = JSON.stringify(parsed);
		}
	}
	try {
		const maybeTokenStore = buildLibGroupTokenStorePayload(raw);
		for (const [key, value] of Object.entries(maybeTokenStore)) {
			const normalizedValue = normalizePreferenceValue(key, value);
			if (
				typeof normalizedValue === 'string' ||
				typeof normalizedValue === 'number' ||
				typeof normalizedValue === 'boolean' ||
				normalizedValue === null
			) {
				out[key] = normalizedValue;
			} else {
				out[key] = JSON.stringify(normalizedValue);
			}
		}
	} catch {
		/* not a LibGroup payload */
	}
	return out;
}

export function normalizePreferenceValue(key: string, value: unknown): unknown {
	if (key === 'bearer_token' && typeof value === 'string') {
		return value.replace(/^Bearer\s+/i, '').trim();
	}
	return value;
}

export function getHiddenStorageKeys(data: SourcePreferencesResolved | null): string[] {
	if (!data) return [];
	return data.preferences
		.filter((pref) => !pref.visible && hasStoredValue(pref.current_value))
		.map((pref) => pref.key);
}

export function serializeImportedStorage(data: SourcePreferencesResolved | null): string {
	if (!data) return '';
	const map: Record<string, unknown> = {};
	for (const pref of data.preferences) {
		if (pref.visible || !hasStoredValue(pref.current_value)) continue;
		map[pref.key] = pref.current_value;
	}
	if (Object.keys(map).length === 0) return '';
	try {
		return JSON.stringify(map, null, 2);
	} catch {
		return '';
	}
}

function parsePossiblyStringifiedJson(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	const trimmed = value.trim();
	if (!trimmed) return value;
	if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value;
	try {
		return JSON.parse(trimmed);
	} catch {
		return value;
	}
}

function parseLooseKeyValueInput(input: string): Record<string, unknown> | null {
	const lines = input
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) return null;
	const map: Record<string, unknown> = {};
	for (const line of lines) {
		const separatorIndex = line.search(/\s+/);
		if (separatorIndex <= 0) return null;
		const key = line.slice(0, separatorIndex).trim();
		const rawValue = line.slice(separatorIndex).trim();
		if (!key || !rawValue) return null;
		map[key] = parsePossiblyStringifiedJson(rawValue);
	}
	return map;
}

function buildLibGroupTokenStorePayload(raw: Record<string, unknown>): Record<string, unknown> {
	let tokenPayload: Record<string, unknown> | null = null;
	let authPayload: Record<string, unknown> | null = null;
	if (raw.token && raw.auth && typeof raw.token === 'object' && typeof raw.auth === 'object') {
		tokenPayload = raw.token as Record<string, unknown>;
		authPayload = raw.auth as Record<string, unknown>;
	}
	const authEntry = parsePossiblyStringifiedJson(raw.auth);
	if (!tokenPayload && authEntry && typeof authEntry === 'object' && !Array.isArray(authEntry)) {
		const authObj = authEntry as Record<string, unknown>;
		if (authObj.token && authObj.auth) {
			tokenPayload = authObj.token as Record<string, unknown>;
			authPayload = authObj.auth as Record<string, unknown>;
		}
	}
	if (!tokenPayload || !authPayload) {
		throw new Error(
			'Unable to find LibGroup auth payload. Expected object with token/auth fields.'
		);
	}
	const userId = Number(authPayload.id);
	const tokenType = String(tokenPayload.token_type ?? tokenPayload.tokenType ?? '').trim();
	const accessToken = String(tokenPayload.access_token ?? tokenPayload.accessToken ?? '').trim();
	const expiresIn = Number(tokenPayload.expires_in ?? tokenPayload.expiresIn ?? 0);
	const timestamp = Number(tokenPayload.timestamp ?? Date.now());
	if (
		!Number.isFinite(userId) ||
		userId <= 0 ||
		!tokenType ||
		!accessToken ||
		!Number.isFinite(expiresIn) ||
		expiresIn <= 0
	) {
		throw new Error('Invalid token payload. token_type, access_token, expires_in are required.');
	}
	return {
		bearer_token: accessToken,
		user_id: String(Math.trunc(userId)),
		expires_in: String(Math.trunc(expiresIn * 1_000)),
		TokenStore: {
			auth: { id: userId },
			token: {
				token_type: tokenType,
				access_token: accessToken,
				expires_in: Math.trunc(expiresIn),
				timestamp: Math.trunc(Number.isFinite(timestamp) ? timestamp : Date.now())
			}
		}
	};
}

function hasStoredValue(value: unknown): boolean {
	if (value === null || value === undefined) return false;
	if (typeof value === 'string') return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	return true;
}
