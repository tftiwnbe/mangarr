import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

import { parseTitleRouteParam } from '$lib/utils/routes';

export const load: PageLoad = ({ params }) => {
	const titleSegment = parseTitleRouteParam(params.id);
	if (!titleSegment) {
		throw error(404, 'Title not found');
	}

	return { titleSegment };
};
