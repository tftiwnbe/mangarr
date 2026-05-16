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

export function buildResetPreferenceEntries(
	data: Pick<SourcePreferencesResolved, 'preferences'>
): Array<{ key: string; value: unknown }> {
	return buildPreferenceEntries(
		data.preferences.map((pref) => [pref.key, deletePreferenceValue()] as const)
	);
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

export function normalizePreferenceValue(key: string, value: unknown): unknown {
	if (key === 'bearer_token' && typeof value === 'string') {
		return value.replace(/^Bearer\s+/i, '').trim();
	}
	return value;
}
