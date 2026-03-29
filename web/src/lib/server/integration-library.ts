import { ConvexHttpClient } from 'convex/browser';
import { error } from '@sveltejs/kit';

import { convexApi } from '$lib/server/convex-api';

type LibraryUserStatus = {
	id: string;
	key: string;
	label: string;
	position: number;
	isDefault: boolean;
};

type LibraryCollection = {
	id: string;
	name: string;
	position: number;
	isDefault: boolean;
};

export type IntegrationSearchItem = {
	canonical_key: string;
	source_id: string;
	source_pkg: string;
	source_lang: string;
	source_name?: string | null;
	title_url: string;
	title: string;
	description?: string | null;
	cover_url?: string | null;
	genre?: string | null;
};

export type IntegrationImportPreferences = {
	userStatusId?: string | null;
	userStatusKey?: string | null;
	userStatusLabel?: string | null;
	collectionIds?: string[] | null;
	collectionNames?: string[] | null;
	useDefaultStatus?: boolean;
	useDefaultCollection?: boolean;
	listedInLibrary?: boolean;
};

export async function loadLibraryPreferenceCatalog(client: ConvexHttpClient) {
	await client.mutation(convexApi.library.ensureDefaultUserStatuses, {});
	await client.mutation(convexApi.library.ensureDefaultCollections, {});

	const [statuses, collections] = await Promise.all([
		client.query(convexApi.library.listUserStatuses, {}) as Promise<LibraryUserStatus[]>,
		client.query(convexApi.library.listCollections, {}) as Promise<LibraryCollection[]>
	]);

	return { statuses, collections };
}

export function resolveUserStatusPreference(
	statuses: LibraryUserStatus[],
	preferences: IntegrationImportPreferences
) {
	const requestedId = preferences.userStatusId?.trim();
	if (requestedId) {
		const match = statuses.find((item) => item.id === requestedId);
		if (!match) {
			throw error(400, `Unknown user status id: ${requestedId}`);
		}
		return match.id;
	}

	const requestedKey = normalizeKey(preferences.userStatusKey);
	if (requestedKey) {
		const match = statuses.find((item) => normalizeKey(item.key) === requestedKey);
		if (!match) {
			throw error(400, `Unknown user status key: ${preferences.userStatusKey}`);
		}
		return match.id;
	}

	const requestedLabel = normalizeLabel(preferences.userStatusLabel);
	if (requestedLabel) {
		const match = statuses.find((item) => normalizeLabel(item.label) === requestedLabel);
		if (!match) {
			throw error(400, `Unknown user status label: ${preferences.userStatusLabel}`);
		}
		return match.id;
	}

	if (preferences.useDefaultStatus === false) {
		return null;
	}

	return (
		statuses.find((item) => normalizeKey(item.key) === 'reading')?.id ??
		statuses
			.slice()
			.sort((left, right) => left.position - right.position)
			.find((item) => item.isDefault)?.id ??
		null
	);
}

export function resolveCollectionPreferences(
	collections: LibraryCollection[],
	preferences: IntegrationImportPreferences
) {
	const explicitIds = Array.from(
		new Set((preferences.collectionIds ?? []).map((value) => value.trim()).filter(Boolean))
	);
	const explicitNames = Array.from(
		new Set((preferences.collectionNames ?? []).map((value) => value.trim()).filter(Boolean))
	);

	const resolved = new Set<string>();
	for (const collectionId of explicitIds) {
		const match = collections.find((item) => item.id === collectionId);
		if (!match) {
			throw error(400, `Unknown collection id: ${collectionId}`);
		}
		resolved.add(match.id);
	}

	for (const collectionName of explicitNames) {
		const match = collections.find((item) => normalizeLabel(item.name) === normalizeLabel(collectionName));
		if (!match) {
			throw error(400, `Unknown collection name: ${collectionName}`);
		}
		resolved.add(match.id);
	}

	if (resolved.size > 0) {
		return Array.from(resolved);
	}

	if (preferences.useDefaultCollection === false) {
		return [];
	}

	const sortedDefaults = collections
		.filter((item) => item.isDefault)
		.slice()
		.sort((left, right) => left.position - right.position);
	const queueLike =
		sortedDefaults.find((item) => normalizeLabel(item.name) === 'queue') ??
		sortedDefaults[1] ??
		null;

	return queueLike ? [queueLike.id] : [];
}

export function mapSearchItem(raw: Record<string, unknown>): IntegrationSearchItem {
	return {
		canonical_key: requiredString(raw, 'canonical_key', 'canonicalKey'),
		source_id: requiredString(raw, 'source_id', 'sourceId'),
		source_pkg: requiredString(raw, 'source_pkg', 'sourcePkg'),
		source_lang: requiredString(raw, 'source_lang', 'sourceLang'),
		source_name: optionalString(raw, 'source_name', 'sourceName'),
		title_url: requiredString(raw, 'title_url', 'titleUrl'),
		title: requiredString(raw, 'title'),
		description: optionalString(raw, 'description'),
		cover_url: optionalString(raw, 'cover_url', 'coverUrl'),
		genre: optionalString(raw, 'genre')
	};
}

export function readImportItem(payload: Record<string, unknown>): IntegrationSearchItem {
	const source = isRecord(payload.item) ? payload.item : payload;
	if (!isRecord(source)) {
		throw error(400, 'Import payload must include an item object or top-level title fields');
	}
	return mapSearchItem(source);
}

export function readImportPreferences(payload: Record<string, unknown>): IntegrationImportPreferences {
	return {
		userStatusId: readOptionalString(payload, 'user_status_id', 'userStatusId'),
		userStatusKey: readOptionalString(payload, 'user_status_key', 'userStatusKey'),
		userStatusLabel: readOptionalString(payload, 'user_status_label', 'userStatusLabel'),
		collectionIds: readOptionalStringArray(payload, 'collection_ids', 'collectionIds'),
		collectionNames: readOptionalStringArray(payload, 'collection_names', 'collectionNames'),
		useDefaultStatus: readOptionalBoolean(payload, 'use_default_status', 'useDefaultStatus'),
		useDefaultCollection: readOptionalBoolean(
			payload,
			'use_default_collection',
			'useDefaultCollection'
		),
		listedInLibrary: readOptionalBoolean(payload, 'listed_in_library', 'listedInLibrary')
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeKey(value: string | null | undefined) {
	return value?.trim().toLowerCase() ?? '';
}

function normalizeLabel(value: string | null | undefined) {
	return value?.trim().toLowerCase() ?? '';
}

function firstValue(source: Record<string, unknown>, ...keys: string[]) {
	for (const key of keys) {
		if (key in source) {
			return source[key];
		}
	}
	return undefined;
}

function requiredString(source: Record<string, unknown>, ...keys: string[]) {
	const value = firstValue(source, ...keys);
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw error(400, `Missing required field: ${keys[0]}`);
	}
	return value.trim();
}

function optionalString(source: Record<string, unknown>, ...keys: string[]) {
	const value = firstValue(source, ...keys);
	if (typeof value !== 'string') {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function readOptionalString(source: Record<string, unknown>, ...keys: string[]) {
	return optionalString(source, ...keys);
}

function readOptionalStringArray(source: Record<string, unknown>, ...keys: string[]) {
	const value = firstValue(source, ...keys);
	if (!Array.isArray(value)) {
		return undefined;
	}
	return value
		.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
		.filter((entry) => entry.length > 0);
}

function readOptionalBoolean(source: Record<string, unknown>, ...keys: string[]) {
	const value = firstValue(source, ...keys);
	return typeof value === 'boolean' ? value : undefined;
}
