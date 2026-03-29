import { error, json } from '@sveltejs/kit';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

import { waitForCommand } from '$lib/client/commands';
import { convexApi } from '$lib/server/convex-api';
import { requireIntegrationApiUser } from '$lib/server/integration-auth';
import {
	loadLibraryPreferenceCatalog,
	readImportItem,
	readImportPreferences,
	resolveCollectionPreferences,
	resolveUserStatusPreference
} from '$lib/server/integration-library';

export const POST: RequestHandler = async (event) => {
	const { client } = await requireIntegrationApiUser(event);

	let payload: Record<string, unknown>;
	try {
		payload = (await event.request.json()) as Record<string, unknown>;
	} catch {
		throw error(400, 'Request body must be valid JSON');
	}

	const item = readImportItem(payload);
	const preferences = readImportPreferences(payload);

	const existing = await client.query(convexApi.library.findMineBySource, {
		canonicalKey: item.canonical_key,
		sourceId: item.source_id,
		titleUrl: item.title_url
	});

	let titleId: Id<'libraryTitles'> | null =
		typeof existing?._id === 'string' ? (existing._id as Id<'libraryTitles'>) : null;
	let created = false;
	let importCommandId: string | null = null;

	if (!titleId) {
		const enqueued = await client.mutation(convexApi.commands.enqueueLibraryImport, {
			canonicalKey: item.canonical_key,
			sourceId: item.source_id,
			sourcePkg: item.source_pkg,
			sourceLang: item.source_lang,
			titleUrl: item.title_url
		});
		importCommandId = String(enqueued.commandId);
		const completed = await waitForCommand(client, enqueued.commandId, {
			timeoutMs: 90_000,
			pollIntervalMs: 350
		});
		const result = isRecord(completed.result) ? completed.result : null;
		titleId =
			typeof result?.titleId === 'string'
				? (result.titleId as Id<'libraryTitles'>)
				: typeof result?.title_id === 'string'
					? (result.title_id as Id<'libraryTitles'>)
					: null;
		created = Boolean(result?.created);
	}

	if (!titleId) {
		const resolved = await client.query(convexApi.library.findMineBySource, {
			canonicalKey: item.canonical_key,
			sourceId: item.source_id,
			titleUrl: item.title_url
		});
		titleId = typeof resolved?._id === 'string' ? (resolved._id as Id<'libraryTitles'>) : null;
	}

	if (!titleId) {
		throw error(502, 'Library import completed without a resolvable title id');
	}

	const { statuses, collections } = await loadLibraryPreferenceCatalog(client);
	const userStatusId = resolveUserStatusPreference(statuses, preferences);
	const collectionIds = resolveCollectionPreferences(collections, preferences);

	await client.mutation(convexApi.library.updateTitlePreferences, {
		titleId,
		...(userStatusId !== null ? { userStatusId: userStatusId as Id<'libraryUserStatuses'> } : {}),
		collectionIds: collectionIds as Id<'libraryCollections'>[]
	});

	const listedInLibrary = preferences.listedInLibrary ?? true;
	await client.mutation(convexApi.library.setTitleListedInLibrary, {
		titleId,
		listed: listedInLibrary
	});

	const title = await client.query(convexApi.library.getMineOverviewById, {
		titleId
	});

	return json({
		ok: true,
		created,
		import_command_id: importCommandId,
		title_id: titleId,
		listed_in_library: listedInLibrary,
		user_status_id: userStatusId,
		collection_ids: collectionIds,
		title: title
			? {
					id: String(title._id),
					title: title.title,
					source_id: title.sourceId,
					title_url: title.titleUrl
				}
			: null
	});
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
