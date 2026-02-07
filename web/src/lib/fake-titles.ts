import type { SourceTitle } from './api/types';

export const fakeTitles: SourceTitle[] = [
	{
		source_id: 1,
		url: '/titles/1',
		title: 'Epic Adventure',
		artist: 'John Doe',
		author: 'Jane Smith',
		description: 'A thrilling adventure story across multiple worlds.',
		genre: 'Fantasy',
		status: 1,
		thumbnail_url:
			'https://books.google.com/books/content?id=o2x_EAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
		update_strategy: 'manual',
		initialized: true
	},
	{
		source_id: 2,
		url: '/titles/2',
		title: 'Mystery Manor',
		artist: 'Alice Cooper',
		description: 'Explore the secrets hidden in the old manor.',
		genre: 'Mystery',
		status: 0,
		thumbnail_url:
			'https://books.google.com/books/content?id=o2x_EAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
		update_strategy: 'auto',
		initialized: false
	},
	{
		source_id: 3,
		url: '/titles/3',
		title: 'Sci-Fi Chronicles',
		author: 'Max Johnson',
		description: 'A journey through space and time with unexpected twists.',
		genre: 'Science Fiction',
		status: 1,
		thumbnail_url:
			'https://books.google.com/books/content?id=o2x_EAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
		update_strategy: 'manual',
		initialized: true
	},
	{
		source_id: 4,
		url: '/titles/4',
		title: 'Romantic Tales',
		artist: 'Emily Rose',
		description: 'Stories of love, heartbreak, and hope.',
		genre: 'Romance',
		status: 0,
		thumbnail_url:
			'https://books.google.com/books/content?id=o2x_EAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
		update_strategy: 'auto',
		initialized: false
	},
	{
		source_id: 5,
		url: '/titles/5',
		title: 'Thriller Nights',
		description: 'Edge-of-your-seat suspense with every page.',
		genre: 'Thriller',
		status: 1,
		thumbnail_url:
			'https://books.google.com/books/content?id=o2x_EAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
		update_strategy: 'manual',
		initialized: true
	}
];
