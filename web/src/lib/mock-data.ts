export interface Title {
	id: string;
	title: string;
	cover: string;
	author?: string;
	artist?: string;
	description?: string;
	genres?: string[];
	status?: 'ongoing' | 'completed' | 'hiatus';
	chapters?: number;
	lastUpdated?: string;
	rating?: number;
}

export interface Chapter {
	id: string;
	number: number;
	title?: string;
	volume?: number;
	pages?: number;
	uploadDate: string;
	scanlator?: string;
	isRead?: boolean;
	isDownloaded?: boolean;
}

export interface TitleDetail extends Omit<Title, 'chapters'> {
	alternativeTitles?: string[];
	chapters: Chapter[];
}

// Sample detailed title data
export function getTitleById(id: string): TitleDetail | undefined {
	const title = [...popularTitles, ...latestTitles, ...recentlyAddedTitles].find(t => t.id === id);
	if (!title) return undefined;

	// Generate mock chapters
	const chapterCount = title.chapters || 50;
	const chapters: Chapter[] = Array.from({ length: Math.min(chapterCount, 30) }, (_, i) => ({
		id: `ch-${id}-${chapterCount - i}`,
		number: chapterCount - i,
		title: i % 5 === 0 ? `Special Chapter` : undefined,
		volume: Math.ceil((chapterCount - i) / 10),
		pages: 18 + Math.floor(Math.random() * 10),
		uploadDate: new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
		scanlator: ['MangaDex', 'Official', 'Fan Translation'][i % 3],
		isRead: i > 10,
		isDownloaded: i > 15 && i < 25
	}));

	return {
		...title,
		description: title.description || `An incredible story that will keep you on the edge of your seat. Follow the journey of our protagonist as they navigate through challenges, make friends, and discover their true potential. This ${title.genres?.[0]?.toLowerCase() || 'amazing'} series has captivated millions of readers worldwide.`,
		alternativeTitles: ['Alternative Title 1', 'Alternative Title 2'],
		chapters
	};
}

const covers = [
	'https://uploads.mangadex.org/covers/a1c7c817-4e59-43b7-9365-09675a149a6f/2529d812-31e2-4a78-9fee-c2f77e498d5a.jpg.512.jpg',
	'https://uploads.mangadex.org/covers/32d76d19-8a05-4db0-9fc2-e0b0648fe9d0/e90bdc47-c8b9-4df7-b2c0-17641b645ee1.jpg.512.jpg',
	'https://uploads.mangadex.org/covers/d8a959f7-648e-4c8d-8f23-f1f3f8e129f3/cf809837-e797-4ef0-956a-1f07ad8fef0b.jpg.512.jpg',
	'https://uploads.mangadex.org/covers/6b958848-c885-4f05-ba54-b7d07742c72b/77a41c12-3a46-4972-860b-819b8e453e8b.jpg.512.jpg',
	'https://uploads.mangadex.org/covers/304ceac3-8cdb-4fe7-acf7-2b6ff7a60571/9e096827-c26c-47ed-acf2-eb7fb8540401.jpg.512.jpg',
	'https://uploads.mangadex.org/covers/801513ba-a712-498c-8f57-cae55b38cc92/0d7c5c28-b507-4bc2-98f8-a359f8897e88.jpg.512.jpg',
	'https://uploads.mangadex.org/covers/e78a489b-6632-4d61-b00b-5c2c06f04c74/9d67a18b-8f9c-45b4-bbbe-1afee92fe5e5.jpg.512.jpg',
	'https://uploads.mangadex.org/covers/5e30d1f8-c2e0-4f95-88f5-1c4f8f1b9e3a/cover.jpg.512.jpg'
];

function randomCover(): string {
	return covers[Math.floor(Math.random() * covers.length)];
}

export const popularTitles: Title[] = [
	{
		id: '1',
		title: 'Solo Leveling',
		cover: covers[0],
		author: 'Chugong',
		genres: ['Action', 'Fantasy', 'Adventure'],
		status: 'completed',
		chapters: 179,
		rating: 4.8
	},
	{
		id: '2',
		title: 'One Punch Man',
		cover: covers[1],
		author: 'ONE',
		artist: 'Yusuke Murata',
		genres: ['Action', 'Comedy', 'Superhero'],
		status: 'ongoing',
		chapters: 245,
		rating: 4.7
	},
	{
		id: '3',
		title: 'Chainsaw Man',
		cover: covers[2],
		author: 'Tatsuki Fujimoto',
		genres: ['Action', 'Horror', 'Supernatural'],
		status: 'ongoing',
		chapters: 180,
		rating: 4.6
	},
	{
		id: '4',
		title: 'Jujutsu Kaisen',
		cover: covers[3],
		author: 'Gege Akutami',
		genres: ['Action', 'Supernatural', 'School'],
		status: 'ongoing',
		chapters: 270,
		rating: 4.5
	},
	{
		id: '5',
		title: 'Spy x Family',
		cover: covers[4],
		author: 'Tatsuya Endo',
		genres: ['Action', 'Comedy', 'Slice of Life'],
		status: 'ongoing',
		chapters: 102,
		rating: 4.7
	},
	{
		id: '6',
		title: 'Blue Lock',
		cover: covers[5],
		author: 'Muneyuki Kaneshiro',
		artist: 'Yusuke Nomura',
		genres: ['Sports', 'Drama'],
		status: 'ongoing',
		chapters: 280,
		rating: 4.4
	},
	{
		id: '7',
		title: 'Kaiju No. 8',
		cover: covers[6],
		author: 'Naoya Matsumoto',
		genres: ['Action', 'Sci-Fi', 'Monster'],
		status: 'ongoing',
		chapters: 115,
		rating: 4.5
	},
	{
		id: '8',
		title: 'Demon Slayer',
		cover: covers[7] || randomCover(),
		author: 'Koyoharu Gotouge',
		genres: ['Action', 'Historical', 'Supernatural'],
		status: 'completed',
		chapters: 205,
		rating: 4.6
	}
];

export const latestTitles: Title[] = [
	{
		id: '9',
		title: 'Dandadan',
		cover: covers[2],
		author: 'Yukinobu Tatsu',
		genres: ['Action', 'Comedy', 'Supernatural'],
		status: 'ongoing',
		chapters: 175,
		lastUpdated: '2 hours ago'
	},
	{
		id: '10',
		title: 'Sakamoto Days',
		cover: covers[3],
		author: 'Yuto Suzuki',
		genres: ['Action', 'Comedy'],
		status: 'ongoing',
		chapters: 195,
		lastUpdated: '5 hours ago'
	},
	{
		id: '11',
		title: 'Kagurabachi',
		cover: covers[4],
		author: 'Takeru Hokazono',
		genres: ['Action', 'Fantasy'],
		status: 'ongoing',
		chapters: 65,
		lastUpdated: '1 day ago'
	},
	{
		id: '12',
		title: 'Witch Watch',
		cover: covers[5],
		author: 'Kenta Shinohara',
		genres: ['Comedy', 'Romance', 'Supernatural'],
		status: 'ongoing',
		chapters: 185,
		lastUpdated: '1 day ago'
	},
	{
		id: '13',
		title: 'Mashle',
		cover: covers[0],
		author: 'Hajime Komoto',
		genres: ['Action', 'Comedy', 'Fantasy'],
		status: 'completed',
		chapters: 162,
		lastUpdated: '2 days ago'
	},
	{
		id: '14',
		title: 'Undead Unluck',
		cover: covers[1],
		author: 'Yoshifumi Tozuka',
		genres: ['Action', 'Sci-Fi', 'Supernatural'],
		status: 'ongoing',
		chapters: 230,
		lastUpdated: '3 days ago'
	}
];

export const recentlyAddedTitles: Title[] = [
	{
		id: '15',
		title: 'Frieren: Beyond Journey\'s End',
		cover: covers[6],
		author: 'Kanehito Yamada',
		artist: 'Tsukasa Abe',
		genres: ['Adventure', 'Drama', 'Fantasy'],
		status: 'ongoing',
		chapters: 138
	},
	{
		id: '16',
		title: 'Oshi no Ko',
		cover: covers[7] || randomCover(),
		author: 'Aka Akasaka',
		artist: 'Mengo Yokoyari',
		genres: ['Drama', 'Supernatural', 'Mystery'],
		status: 'ongoing',
		chapters: 165
	},
	{
		id: '17',
		title: 'Hell\'s Paradise',
		cover: covers[0],
		author: 'Yuji Kaku',
		genres: ['Action', 'Adventure', 'Supernatural'],
		status: 'completed',
		chapters: 127
	},
	{
		id: '18',
		title: 'Vinland Saga',
		cover: covers[1],
		author: 'Makoto Yukimura',
		genres: ['Action', 'Adventure', 'Historical'],
		status: 'ongoing',
		chapters: 212
	},
	{
		id: '19',
		title: 'Tokyo Revengers',
		cover: covers[2],
		author: 'Ken Wakui',
		genres: ['Action', 'Drama', 'Supernatural'],
		status: 'completed',
		chapters: 278
	},
	{
		id: '20',
		title: 'Blue Box',
		cover: covers[3],
		author: 'Kouji Miura',
		genres: ['Romance', 'Sports', 'School'],
		status: 'ongoing',
		chapters: 180
	}
];

// Download queue items
export interface DownloadItem {
	id: string;
	titleId: string;
	title: string;
	chapter: string;
	cover: string;
	status: 'downloading' | 'queued' | 'paused' | 'completed' | 'failed';
	progress?: number; // 0-100
	speed?: string; // e.g., "1.2 MB/s"
	size?: string; // e.g., "25 MB"
	error?: string;
}

export const downloadQueue: DownloadItem[] = [
	{
		id: 'd1',
		titleId: '1',
		title: 'Solo Leveling',
		chapter: 'Chapter 179',
		cover: covers[0],
		status: 'downloading',
		progress: 65,
		speed: '2.4 MB/s',
		size: '32 MB'
	},
	{
		id: 'd2',
		titleId: '1',
		title: 'Solo Leveling',
		chapter: 'Chapter 178',
		cover: covers[0],
		status: 'queued',
		size: '28 MB'
	},
	{
		id: 'd3',
		titleId: '2',
		title: 'One Punch Man',
		chapter: 'Chapter 245',
		cover: covers[1],
		status: 'queued',
		size: '45 MB'
	},
	{
		id: 'd4',
		titleId: '3',
		title: 'Chainsaw Man',
		chapter: 'Chapter 180',
		cover: covers[2],
		status: 'paused',
		progress: 30,
		size: '22 MB'
	},
	{
		id: 'd5',
		titleId: '4',
		title: 'Jujutsu Kaisen',
		chapter: 'Chapter 270',
		cover: covers[3],
		status: 'failed',
		error: 'Connection timeout'
	}
];

export const completedDownloads: DownloadItem[] = [
	{
		id: 'd6',
		titleId: '1',
		title: 'Solo Leveling',
		chapter: 'Chapter 177',
		cover: covers[0],
		status: 'completed',
		size: '30 MB'
	},
	{
		id: 'd7',
		titleId: '2',
		title: 'One Punch Man',
		chapter: 'Chapter 244',
		cover: covers[1],
		status: 'completed',
		size: '42 MB'
	},
	{
		id: 'd8',
		titleId: '3',
		title: 'Chainsaw Man',
		chapter: 'Chapter 179',
		cover: covers[2],
		status: 'completed',
		size: '24 MB'
	}
];

// Library titles with reading progress
export interface LibraryTitle extends Title {
	readingStatus: 'reading' | 'completed' | 'plan-to-read' | 'on-hold' | 'dropped';
	progress?: {
		currentChapter: number;
		totalChapters: number;
	};
	addedAt: string;
	category?: string;
}

export const libraryTitles: LibraryTitle[] = [
	{
		id: '1',
		title: 'Solo Leveling',
		cover: covers[0],
		author: 'Chugong',
		status: 'completed',
		chapters: 179,
		readingStatus: 'completed',
		progress: { currentChapter: 179, totalChapters: 179 },
		addedAt: '2024-01-15',
		category: 'favorites'
	},
	{
		id: '2',
		title: 'One Punch Man',
		cover: covers[1],
		author: 'ONE',
		status: 'ongoing',
		chapters: 245,
		readingStatus: 'reading',
		progress: { currentChapter: 180, totalChapters: 245 },
		addedAt: '2024-02-20',
		category: 'favorites'
	},
	{
		id: '3',
		title: 'Chainsaw Man',
		cover: covers[2],
		author: 'Tatsuki Fujimoto',
		status: 'ongoing',
		chapters: 180,
		readingStatus: 'reading',
		progress: { currentChapter: 150, totalChapters: 180 },
		addedAt: '2024-03-10'
	},
	{
		id: '4',
		title: 'Jujutsu Kaisen',
		cover: covers[3],
		author: 'Gege Akutami',
		status: 'ongoing',
		chapters: 270,
		readingStatus: 'reading',
		progress: { currentChapter: 200, totalChapters: 270 },
		addedAt: '2024-01-05'
	},
	{
		id: '5',
		title: 'Spy x Family',
		cover: covers[4],
		author: 'Tatsuya Endo',
		status: 'ongoing',
		chapters: 102,
		readingStatus: 'plan-to-read',
		addedAt: '2024-04-01'
	},
	{
		id: '15',
		title: 'Frieren: Beyond Journey\'s End',
		cover: covers[6],
		author: 'Kanehito Yamada',
		status: 'ongoing',
		chapters: 138,
		readingStatus: 'plan-to-read',
		addedAt: '2024-04-15',
		category: 'favorites'
	},
	{
		id: '17',
		title: 'Hell\'s Paradise',
		cover: covers[0],
		author: 'Yuji Kaku',
		status: 'completed',
		chapters: 127,
		readingStatus: 'completed',
		progress: { currentChapter: 127, totalChapters: 127 },
		addedAt: '2023-12-01'
	},
	{
		id: '18',
		title: 'Vinland Saga',
		cover: covers[1],
		author: 'Makoto Yukimura',
		status: 'ongoing',
		chapters: 212,
		readingStatus: 'on-hold',
		progress: { currentChapter: 100, totalChapters: 212 },
		addedAt: '2023-11-15'
	}
];
