import type { PageLoad } from './$types';

import { parseReaderChapterParam, parseTitleRouteParam } from '$lib/utils/routes';

export const load: PageLoad = ({ params }) => ({
	titleSegment: parseTitleRouteParam(params.titleId),
	chapterSegment: parseReaderChapterParam(params.chapterId)
});
