import type { PageLoad } from './$types';

import { parseReaderChapterParam, parseTitleRouteParam } from '$lib/utils/routes';

export const load: PageLoad = ({ params }) => ({
	titleId: parseTitleRouteParam(params.titleId),
	chapterId: parseReaderChapterParam(params.chapterId)
});
