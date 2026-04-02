import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { waitForCommand } from '$lib/client/commands';
import { convexApi } from '$lib/server/convex-api';
import { commandFailure, requireAdminConvexClient } from '$lib/server/extensions-admin';
import {
	normalizeContentLanguageCode,
	toMainContentLanguages
} from '$lib/utils/content-languages';

type InstalledSourceResult = {
	id: string;
	name: string;
	lang: string;
	supportsLatest: boolean;
	enabled?: boolean;
};

type InstalledExtensionResult = {
	pkg: string;
	name: string;
	lang: string;
	version: string;
	nsfw: boolean;
	useProxy: boolean;
	icon?: string;
	sources: InstalledSourceResult[];
};

export const POST: RequestHandler = async (event) => {
	const { client } = await requireAdminConvexClient(event);

	let payload: { pkg?: string };
	try {
		payload = (await event.request.json()) as { pkg?: string };
	} catch {
		throw error(400, 'Request body must be valid JSON');
	}

	const pkg = String(payload.pkg ?? '').trim();
	if (!pkg) {
		throw error(400, 'Package name is required');
	}

	const enqueued = await client.mutation(convexApi.commands.enqueueExtensionInstall, { pkg });

	try {
		const completed = await waitForCommand(client, enqueued.commandId, {
			timeoutMs: 30_000,
			pollIntervalMs: 300
		});
		const result = (completed.result ?? null) as InstalledExtensionResult | null;
		const preferred = toMainContentLanguages(
			(
				(await client.query(convexApi.settings.getContentLanguages, {})) as {
					preferred?: string[];
				}
			).preferred ?? []
		);

		if (result?.sources?.length) {
			const enabledLangs = new Set(preferred);
			for (const source of result.sources) {
				const normalizedLang = normalizeContentLanguageCode(source.lang);
				const shouldEnable =
					normalizedLang !== null &&
					(enabledLangs.has(normalizedLang) || normalizedLang === 'multi');
				if (!shouldEnable) {
					const toggleResponse = await event.fetch('/api/internal/bridge/extensions/source-enabled', {
						method: 'PUT',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({
							pkg,
							sourceId: source.id,
							enabled: false
						})
					});
					if (toggleResponse.status === 404) {
						continue;
					}
					if (!toggleResponse.ok) {
						throw error(toggleResponse.status, `Failed to disable source ${source.name}`);
					}
					source.enabled = false;
				} else {
					source.enabled = true;
				}
			}
		}

		return json({
			ok: true,
			result
		});
	} catch (cause) {
		throw error(502, commandFailure(cause, 'Failed to install extension'));
	}
};
