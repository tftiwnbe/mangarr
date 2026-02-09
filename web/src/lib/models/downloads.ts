import type { DownloadTaskStatus } from '$lib/api/downloads';

export interface DownloadTaskItem {
	id: number;
	titleId: number;
	chapterId: number;
	title: string;
	chapter: string;
	status: DownloadTaskStatus;
	progressPercent: number;
	downloadedPages: number;
	totalPages: number;
	error: string | null;
	updatedAt: string;
	cover: string;
}

export interface DownloadMonitoredItem {
	titleId: number;
	title: string;
	cover: string;
	enabled: boolean;
	autoDownload: boolean;
	queuedTasks: number;
	failedTasks: number;
	downloadedChapters: number;
	totalChapters: number;
	lastError: string | null;
}

export interface DownloadOverviewItem {
	label: string;
	value: number;
}

export interface DownloadDashboardViewModel {
	generatedAt: string;
	overview: DownloadOverviewItem[];
	activeTasks: DownloadTaskItem[];
	recentTasks: DownloadTaskItem[];
	monitoredTitles: DownloadMonitoredItem[];
}
