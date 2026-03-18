import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

import { parseTitleRouteParam } from '$lib/utils/routes';

export const load: PageLoad = ({ params }) => {
	const titleId = parseTitleRouteParam(params.id);
	if (!titleId) {
		throw error(404, 'Title not found');
	}

	return { titleId };
};
