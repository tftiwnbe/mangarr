export type TitleStatus = 'ongoing' | 'completed' | 'hiatus';

export interface TitleCardItem {
	id: string;
	title: string;
	cover: string;
	author?: string;
	artist?: string;
	description?: string;
	genres?: string[];
	status?: TitleStatus;
	chapters?: number;
	lastUpdated?: string;
	href?: string;
	external?: boolean;
}

export interface TitleVariantItem {
	id: number;
	sourceId: string;
	sourceName?: string;
	sourceLang?: string;
	titleUrl: string;
	title: string;
}

export interface TitleChapterItem {
	id: number;
	chapterUrl: string;
	number: number;
	title: string;
	pages?: number;
	uploadDate: string;
	scanlator?: string;
	isRead: boolean;
	isDownloaded: boolean;
	downloadError?: string;
}

export interface TitleDetailItem extends Omit<TitleCardItem, 'chapters'> {
	libraryId: number;
	variants: TitleVariantItem[];
	chapters: TitleChapterItem[];
}
