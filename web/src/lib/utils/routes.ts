import { buildChapterRouteBase, buildTitleRouteBase, decodeRouteSegment } from './route-segments';

export function buildTitlePath(
	_titleId: string,
	titleName: string,
	routeSegment?: string | null
): string {
	return `/title/${encodeURIComponent(routeSegment ?? buildTitleRouteBase(titleName))}`;
}

export function parseTitleRouteParam(value: string | null | undefined): string | null {
	return decodeRouteSegment(value);
}

export function buildReaderPath(params: {
	titleId: string;
	titleName?: string | null;
	titleRouteSegment?: string | null;
	chapterId: string;
	chapterName?: string | null;
	chapterNumber?: number | null;
	chapterRouteSegment?: string | null;
}): string {
	const titleSegment = params.titleRouteSegment ?? buildTitleRouteBase(params.titleName ?? '');
	const chapterSegment =
		params.chapterRouteSegment ?? buildChapterRouteBase(params.chapterName, params.chapterNumber);
	return `/reader/${encodeURIComponent(titleSegment)}/${encodeURIComponent(chapterSegment)}`;
}

export function parseReaderChapterParam(value: string | null | undefined): string | null {
	return decodeRouteSegment(value);
}
