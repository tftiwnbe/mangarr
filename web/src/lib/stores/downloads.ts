import * as downloadsApi from '$lib/api/downloads';
import type { DownloadDashboardViewModel } from '$lib/utils/download-mappers';
import { emptyDownloadDashboard, mapDownloadDashboard } from '$lib/utils/download-mappers';
import { CACHE_MS } from '$lib/utils/cache-durations';

import { createAsyncResourceStore } from './async-resource';

async function loadDashboard(): Promise<DownloadDashboardViewModel> {
	const dashboard = await downloadsApi.getDownloadDashboard({
		watched_limit: 30,
		active_limit: 100,
		recent_limit: 40
	});
	return mapDownloadDashboard(dashboard);
}

export const downloadsDashboardStore = createAsyncResourceStore<DownloadDashboardViewModel, []>(
	loadDashboard,
	{ initialData: emptyDownloadDashboard(), cacheMs: CACHE_MS.SHORT }
);

export async function retryDownloadTask(taskId: number): Promise<void> {
	await downloadsApi.retryDownloadTask(taskId);
	await downloadsDashboardStore.refresh();
}

export async function cancelDownloadTask(taskId: number): Promise<void> {
	await downloadsApi.cancelDownloadTask(taskId);
	await downloadsDashboardStore.refresh();
}

export async function runDownloadWorker(batchSize?: number): Promise<void> {
	await downloadsApi.runDownloadWorker(batchSize);
	await downloadsDashboardStore.refresh();
}

export async function runDownloadWatch(limit = 25): Promise<void> {
	await downloadsApi.runDownloadWatch(limit);
	await downloadsDashboardStore.refresh();
}

export async function runDownloadCycle(options?: {
	watchLimit?: number;
	workerBatchSize?: number;
}): Promise<void> {
	await downloadsApi.runDownloadWatch(options?.watchLimit ?? 25);
	await downloadsApi.runDownloadWorker(options?.workerBatchSize);
	await downloadsDashboardStore.refresh();
}
