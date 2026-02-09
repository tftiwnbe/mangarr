import type { DownloadDashboardResource, DownloadTaskResource } from '$lib/api/downloads';
import type {
	DownloadDashboardViewModel,
	DownloadMonitoredItem,
	DownloadOverviewItem,
	DownloadTaskItem
} from '$lib/models/downloads';

const FALLBACK_COVER = '/favicon.ico';

function normalizeCover(url: string): string {
	const trimmed = url.trim();
	return trimmed.length > 0 ? trimmed : FALLBACK_COVER;
}

function taskProgressPercent(task: DownloadTaskResource): number {
	if (task.total_pages <= 0) {
		return task.status === 'completed' ? 100 : 0;
	}
	return Math.max(0, Math.min(100, Math.round((task.downloaded_pages / task.total_pages) * 100)));
}

function mapTask(
	task: DownloadTaskResource,
	coverByTitleId: Map<number, string>
): DownloadTaskItem {
	return {
		id: task.id,
		titleId: task.library_title_id,
		chapterId: task.chapter_id,
		title: task.title_name,
		chapter: task.chapter_name,
		status: task.status,
		progressPercent: taskProgressPercent(task),
		downloadedPages: task.downloaded_pages,
		totalPages: task.total_pages,
		error: task.error,
		updatedAt: task.updated_at,
		cover: normalizeCover(coverByTitleId.get(task.library_title_id) ?? '')
	};
}

function mapMonitored(item: DownloadDashboardResource['monitored_titles'][number]): DownloadMonitoredItem {
	return {
		titleId: item.library_title_id,
		title: item.title,
		cover: normalizeCover(item.thumbnail_url),
		enabled: item.enabled,
		autoDownload: item.auto_download,
		queuedTasks: item.queued_tasks,
		failedTasks: item.failed_tasks,
		downloadedChapters: item.downloaded_chapters,
		totalChapters: item.total_chapters,
		lastError: item.last_error
	};
}

function mapOverview(resource: DownloadDashboardResource): DownloadOverviewItem[] {
	return [
		{ label: 'Active', value: resource.overview.downloading },
		{ label: 'Queued', value: resource.overview.queued },
		{ label: 'Completed', value: resource.overview.completed },
		{ label: 'Failed', value: resource.overview.failed }
	];
}

export function emptyDownloadDashboard(): DownloadDashboardViewModel {
	return {
		generatedAt: new Date(0).toISOString(),
		overview: [],
		activeTasks: [],
		recentTasks: [],
		monitoredTitles: []
	};
}

export function mapDownloadDashboard(resource: DownloadDashboardResource): DownloadDashboardViewModel {
	const monitoredTitles = resource.monitored_titles.map(mapMonitored);
	const coverByTitleId = new Map(monitoredTitles.map((item) => [item.titleId, item.cover]));

	return {
		generatedAt: resource.generated_at,
		overview: mapOverview(resource),
		activeTasks: resource.active_tasks.map((task) => mapTask(task, coverByTitleId)),
		recentTasks: resource.recent_tasks.map((task) => mapTask(task, coverByTitleId)),
		monitoredTitles
	};
}
