import type { DownloadDashboardResource, DownloadTaskResource, DownloadTaskStatus } from '$lib/api/downloads';
import { getCachedCoverUrl } from '$lib/api/covers';

export type DownloadStatus = DownloadTaskStatus;

export interface DownloadTaskItem {
	id: string;
	titleId: number;
	title: string;
	chapter: string;
	status: DownloadStatus;
	isPaused: boolean;
	progressPercent: number;
	downloadedPages: number;
	totalPages: number;
	chaptersTotal: number;
	chaptersQueued: number;
	chaptersDownloading: number;
	chaptersCompleted: number;
	chaptersFailed: number;
	chaptersCancelled: number;
	error: string | null;
	updatedAt: string;
	cover: string;
	sources: string[];
}

interface DownloadWatchedItem {
	titleId: number;
	title: string;
	cover: string;
	enabled: boolean;
	paused: boolean;
	autoDownload: boolean;
	variantIds: number[];
	variantSources: string[];
	queuedTasks: number;
	failedTasks: number;
	downloadedChapters: number;
	totalChapters: number;
	downloadedBytes: number;
	avgChapterSizeBytes: number;
	lastError: string | null;
}

interface DownloadOverviewItem {
	key: 'downloadedChapters' | 'avgChapterSize' | 'estimatedCapacity';
	value: number;
	secondaryValue?: number;
}

export interface DownloadDashboardViewModel {
	generatedAt: string;
	overview: DownloadOverviewItem[];
	queueTotals: {
		queued: number;
		downloading: number;
		failed: number;
	};
	activeTasks: DownloadTaskItem[];
	recentTasks: DownloadTaskItem[];
	watchedTitles: DownloadWatchedItem[];
}

function normalizeCover(url: string): string {
	return getCachedCoverUrl(url);
}

function parseDateTime(value: string): number {
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? 0 : parsed;
}

function toFiniteNumber(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

type MutableTaskGroup = {
	id: string;
	titleId: number;
	title: string;
	chapter: string;
	isPaused: boolean;
	downloadedPages: number;
	totalPages: number;
	chaptersTotal: number;
	chaptersQueued: number;
	chaptersDownloading: number;
	chaptersCompleted: number;
	chaptersFailed: number;
	chaptersCancelled: number;
	error: string | null;
	updatedAt: string;
	updatedAtMs: number;
	cover: string;
	sourceSet: Set<string>;
};

function createTaskGroup(
	task: DownloadTaskResource,
	coverByTitleId: Map<number, string>
): MutableTaskGroup {
	return {
		id: String(task.library_title_id),
		titleId: task.library_title_id,
		title: task.title_name,
		chapter: task.chapter_name,
		isPaused: Boolean(task.is_paused),
		downloadedPages: task.downloaded_pages,
		totalPages: task.total_pages,
		chaptersTotal: 1,
		chaptersQueued: task.status === 'queued' ? 1 : 0,
		chaptersDownloading: task.status === 'downloading' ? 1 : 0,
		chaptersCompleted: task.status === 'completed' ? 1 : 0,
		chaptersFailed: task.status === 'failed' ? 1 : 0,
		chaptersCancelled: task.status === 'cancelled' ? 1 : 0,
		error: task.error,
		updatedAt: task.updated_at,
		updatedAtMs: parseDateTime(task.updated_at),
		cover: normalizeCover(coverByTitleId.get(task.library_title_id) ?? ''),
		sourceSet: new Set(task.source_id ? [task.source_id] : [])
	};
}

function applyTaskToGroup(group: MutableTaskGroup, task: DownloadTaskResource): void {
	group.isPaused = group.isPaused || Boolean(task.is_paused);
	group.downloadedPages += task.downloaded_pages;
	group.totalPages += task.total_pages;
	group.chaptersTotal += 1;
	if (task.status === 'queued') group.chaptersQueued += 1;
	if (task.status === 'downloading') group.chaptersDownloading += 1;
	if (task.status === 'completed') group.chaptersCompleted += 1;
	if (task.status === 'failed') group.chaptersFailed += 1;
	if (task.status === 'cancelled') group.chaptersCancelled += 1;
	if (task.source_id) group.sourceSet.add(task.source_id);
	if (!group.error && task.error) {
		group.error = task.error;
	}

	const taskUpdatedAtMs = parseDateTime(task.updated_at);
	if (taskUpdatedAtMs >= group.updatedAtMs) {
		group.updatedAt = task.updated_at;
		group.updatedAtMs = taskUpdatedAtMs;
		group.title = task.title_name || group.title;
		if (task.status === 'downloading' || !group.chapter) {
			group.chapter = task.chapter_name;
		}
		if (task.error) {
			group.error = task.error;
		}
	}
}

function groupStatus(group: MutableTaskGroup): DownloadStatus {
	if (group.chaptersDownloading > 0) return 'downloading';
	if (group.chaptersQueued > 0) return 'queued';
	if (group.chaptersFailed > 0) return 'failed';
	if (group.chaptersCancelled > 0 && group.chaptersCompleted === 0) return 'cancelled';
	return 'completed';
}

function groupProgress(group: MutableTaskGroup): number {
	if (group.totalPages > 0) {
		return Math.max(
			0,
			Math.min(100, Math.round((group.downloadedPages / group.totalPages) * 100))
		);
	}
	if (group.chaptersTotal > 0) {
		const completed = group.chaptersCompleted + group.chaptersCancelled;
		return Math.max(0, Math.min(100, Math.round((completed / group.chaptersTotal) * 100)));
	}
	return 0;
}

function mapTaskGroups(
	tasks: DownloadTaskResource[],
	coverByTitleId: Map<number, string>
): DownloadTaskItem[] {
	const grouped = new Map<string, MutableTaskGroup>();

	for (const task of tasks) {
		const key = String(task.library_title_id);
		const existing = grouped.get(key);
		if (!existing) {
			grouped.set(key, createTaskGroup(task, coverByTitleId));
			continue;
		}
		applyTaskToGroup(existing, task);
	}

	return [...grouped.values()]
		.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
		.map((group) => ({
			id: group.id,
			titleId: group.titleId,
			title: group.title,
			chapter: group.chapter,
			status: groupStatus(group),
			isPaused: group.isPaused,
			progressPercent: groupProgress(group),
			downloadedPages: group.downloadedPages,
			totalPages: group.totalPages,
			chaptersTotal: group.chaptersTotal,
			chaptersQueued: group.chaptersQueued,
			chaptersDownloading: group.chaptersDownloading,
			chaptersCompleted: group.chaptersCompleted,
			chaptersFailed: group.chaptersFailed,
			chaptersCancelled: group.chaptersCancelled,
			error: group.error,
			updatedAt: group.updatedAt,
			cover: group.cover,
			sources: [...group.sourceSet.values()].sort((a, b) =>
				a.localeCompare(b, undefined, { sensitivity: 'base' })
			)
		}));
}

function mapRecentTaskGroups(
	tasks: DownloadTaskResource[],
	coverByTitleId: Map<number, string>
): DownloadTaskItem[] {
	const grouped = new Map<string, MutableTaskGroup>();

	for (const task of tasks) {
		const attemptGroup = Number(
			(task as { attempt_group_id?: number | null }).attempt_group_id ?? task.id
		);
		const key = Number.isFinite(attemptGroup) && attemptGroup > 0 ? String(attemptGroup) : String(task.id);
		const existing = grouped.get(key);
		if (!existing) {
			const created = createTaskGroup(task, coverByTitleId);
			created.id = key;
			grouped.set(key, created);
			continue;
		}
		applyTaskToGroup(existing, task);
	}

	return [...grouped.values()]
		.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
		.map((group) => ({
			id: group.id,
			titleId: group.titleId,
			title: group.title,
			chapter: group.chapter,
			status: groupStatus(group),
			isPaused: group.isPaused,
			progressPercent: groupProgress(group),
			downloadedPages: group.downloadedPages,
			totalPages: group.totalPages,
			chaptersTotal: group.chaptersTotal,
			chaptersQueued: group.chaptersQueued,
			chaptersDownloading: group.chaptersDownloading,
			chaptersCompleted: group.chaptersCompleted,
			chaptersFailed: group.chaptersFailed,
			chaptersCancelled: group.chaptersCancelled,
			error: group.error,
			updatedAt: group.updatedAt,
			cover: group.cover,
			sources: [...group.sourceSet.values()].sort((a, b) =>
				a.localeCompare(b, undefined, { sensitivity: 'base' })
			)
		}));
}

function mapWatchedTitle(
	item: DownloadDashboardResource['watched_titles'][number]
): DownloadWatchedItem {
	return {
		titleId: item.library_title_id,
		title: item.title,
		cover: normalizeCover(item.thumbnail_url),
		enabled: item.enabled,
		paused: item.paused,
		autoDownload: item.auto_download,
		variantIds: item.variant_ids ?? [],
		variantSources: item.variant_sources ?? [],
		queuedTasks: toFiniteNumber(item.queued_tasks),
		failedTasks: toFiniteNumber(item.failed_tasks),
		downloadedChapters: toFiniteNumber(item.downloaded_chapters),
		totalChapters: toFiniteNumber(item.total_chapters),
		downloadedBytes: toFiniteNumber(item.downloaded_bytes),
		avgChapterSizeBytes: toFiniteNumber(item.avg_chapter_size_bytes),
		lastError: item.last_error
	};
}

function mapOverview(resource: DownloadDashboardResource): DownloadOverviewItem[] {
	return [
		{ key: 'downloadedChapters', value: toFiniteNumber(resource.overview.downloaded_chapters) },
		{ key: 'avgChapterSize', value: toFiniteNumber(resource.overview.avg_chapter_size_bytes) },
		{
			key: 'estimatedCapacity',
			value: toFiniteNumber(resource.overview.estimated_chapters_fit),
			secondaryValue: toFiniteNumber(resource.overview.free_disk_bytes)
		}
	];
}

export function emptyDownloadDashboard(): DownloadDashboardViewModel {
	return {
		generatedAt: new Date(0).toISOString(),
		overview: [],
		queueTotals: {
			queued: 0,
			downloading: 0,
			failed: 0
		},
		activeTasks: [],
		recentTasks: [],
		watchedTitles: []
	};
}

export function mapDownloadDashboard(
	resource: DownloadDashboardResource
): DownloadDashboardViewModel {
	const watchedTitles = resource.watched_titles.map(mapWatchedTitle);
	const coverByTitleId = new Map(watchedTitles.map((item) => [item.titleId, item.cover]));

	return {
		generatedAt: resource.generated_at,
		overview: mapOverview(resource),
		queueTotals: {
			queued: toFiniteNumber(resource.overview.queued),
			downloading: toFiniteNumber(resource.overview.downloading),
			failed: toFiniteNumber(resource.overview.failed)
		},
		activeTasks: mapTaskGroups(resource.active_tasks, coverByTitleId),
		recentTasks: mapRecentTaskGroups(resource.recent_tasks, coverByTitleId),
		watchedTitles
	};
}
