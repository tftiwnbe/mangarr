import { httpClient } from './client';
import { expectData } from './errors';
import type { components } from './v2';

export type DownloadTaskStatus = components['schemas']['DownloadTaskStatus'];
export type DownloadOverviewResource = components['schemas']['DownloadOverviewResource'];
export type DownloadDashboardResource = components['schemas']['DownloadDashboardResource'];
export type DownloadProfileResource = components['schemas']['DownloadProfileResource'];
export type DownloadProfileUpdate = components['schemas']['DownloadProfileUpdate'];
export type DownloadTaskResource = components['schemas']['DownloadTaskResource'];
export type EnqueueChapterResponse = components['schemas']['EnqueueChapterResponse'];
export type EnqueueTitleResponse = components['schemas']['EnqueueTitleResponse'];
export type MonitorRunResponse = components['schemas']['MonitorRunResponse'];
export type WorkerRunResponse = components['schemas']['WorkerRunResponse'];

export async function getDownloadOverview(): Promise<DownloadOverviewResource> {
	return expectData(
		await httpClient.GET('/api/v2/downloads/overview'),
		'Unable to load download overview'
	);
}

export async function getDownloadDashboard(query?: {
	monitored_limit?: number;
	active_limit?: number;
	recent_limit?: number;
}): Promise<DownloadDashboardResource> {
	return expectData(
		await httpClient.GET('/api/v2/downloads/dashboard', { params: { query } }),
		'Unable to load download dashboard'
	);
}

export async function listDownloadProfiles(query?: {
	enabled?: boolean | null;
	title_id?: number | null;
	offset?: number;
	limit?: number;
}): Promise<DownloadProfileResource[]> {
	return expectData(
		await httpClient.GET('/api/v2/downloads/profiles', { params: { query } }),
		'Unable to load download profiles'
	);
}

export async function getDownloadProfile(titleId: number): Promise<DownloadProfileResource> {
	return expectData(
		await httpClient.GET('/api/v2/downloads/profiles/{title_id}', {
			params: { path: { title_id: titleId } }
		}),
		'Unable to load download profile'
	);
}

export async function updateDownloadProfile(
	titleId: number,
	payload: DownloadProfileUpdate
): Promise<DownloadProfileResource> {
	return expectData(
		await httpClient.PUT('/api/v2/downloads/profiles/{title_id}', {
			params: { path: { title_id: titleId } },
			body: payload
		}),
		'Unable to update download profile'
	);
}

export async function listDownloadTasks(query?: {
	status?: DownloadTaskStatus | null;
	title_id?: number | null;
	offset?: number;
	limit?: number;
}): Promise<DownloadTaskResource[]> {
	return expectData(
		await httpClient.GET('/api/v2/downloads/tasks', { params: { query } }),
		'Unable to load download tasks'
	);
}

export async function enqueueChapter(
	chapterId: number,
	priority = 100
): Promise<EnqueueChapterResponse> {
	return expectData(
		await httpClient.POST('/api/v2/downloads/chapters/{chapter_id}/enqueue', {
			params: {
				path: { chapter_id: chapterId },
				query: { priority }
			}
		}),
		'Unable to enqueue chapter'
	);
}

export async function enqueueMissingTitleChapters(
	titleId: number,
	query?: {
		variant_id?: number | null;
		unread_only?: boolean;
	}
): Promise<EnqueueTitleResponse> {
	return expectData(
		await httpClient.POST('/api/v2/downloads/titles/{title_id}/enqueue-missing', {
			params: {
				path: { title_id: titleId },
				query
			}
		}),
		'Unable to enqueue missing title chapters'
	);
}

export async function retryDownloadTask(taskId: number): Promise<DownloadTaskResource> {
	return expectData(
		await httpClient.POST('/api/v2/downloads/tasks/{task_id}/retry', {
			params: { path: { task_id: taskId } }
		}),
		'Unable to retry download task'
	);
}

export async function cancelDownloadTask(taskId: number): Promise<DownloadTaskResource> {
	return expectData(
		await httpClient.POST('/api/v2/downloads/tasks/{task_id}/cancel', {
			params: { path: { task_id: taskId } }
		}),
		'Unable to cancel download task'
	);
}

export async function runDownloadMonitor(limit = 25): Promise<MonitorRunResponse> {
	return expectData(
		await httpClient.POST('/api/v2/downloads/run-monitor', { params: { query: { limit } } }),
		'Unable to run download monitor'
	);
}

export async function runDownloadWorker(batchSize?: number): Promise<WorkerRunResponse> {
	return expectData(
		await httpClient.POST('/api/v2/downloads/run-worker', {
			params: { query: { batch_size: batchSize ?? null } }
		}),
		'Unable to run download worker'
	);
}
