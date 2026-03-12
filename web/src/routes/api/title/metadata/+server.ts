import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

function parseMangaDexId(titleUrl: string): string | null {
	const match = titleUrl.match(/\/manga\/([0-9a-f-]{36})/i);
	return match?.[1] ?? null;
}

export const GET: RequestHandler = async ({ url, fetch, locals }) => {
	if (!locals.auth.user) {
		throw error(401, 'Not signed in');
	}

	const sourcePkg = url.searchParams.get('sourcePkg')?.trim().toLowerCase() ?? '';
	const titleUrl = url.searchParams.get('titleUrl')?.trim() ?? '';
	if (!sourcePkg || !titleUrl) {
		throw error(400, 'sourcePkg and titleUrl are required');
	}

	if (!sourcePkg.includes('mangadex')) {
		return json({ author: null, artist: null });
	}

	const mangaDexId = parseMangaDexId(titleUrl);
	if (!mangaDexId) {
		return json({ author: null, artist: null });
	}

	const response = await fetch(
		`https://api.mangadex.org/manga/${mangaDexId}?includes[]=author&includes[]=artist`
	);
	if (!response.ok) {
		throw error(502, 'Failed to load title metadata');
	}

	const payload = (await response.json()) as {
		data?: {
			relationships?: Array<{
				type?: string;
				attributes?: {
					name?: string;
				};
			}>;
		};
	};

	const relationships = payload.data?.relationships ?? [];
	const authorNames = relationships
		.filter((item) => item.type === 'author')
		.map((item) => item.attributes?.name?.trim() ?? '')
		.filter(Boolean);
	const artistNames = relationships
		.filter((item) => item.type === 'artist')
		.map((item) => item.attributes?.name?.trim() ?? '')
		.filter(Boolean);

	return json({
		author: authorNames.length > 0 ? authorNames.join(', ') : null,
		artist: artistNames[0] ?? null
	});
};
