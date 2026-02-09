import * as downloadsApi from '$lib/api/downloads';
import type { DownloadDashboardViewModel } from '$lib/models/downloads';
import { emptyDownloadDashboard, mapDownloadDashboard } from '$lib/utils/download-mappers';

import { createAsyncResourceStore } from './async-resource';

async function loadDashboard(): Promise<DownloadDashboardViewModel> {
	const dashboard = await downloadsApi.getDownloadDashboard({
		monitored_limit: 30,
		active_limit: 30,
		recent_limit: 40
	});
	return mapDownloadDashboard(dashboard);
}

export const downloadsDashboardStore = createAsyncResourceStore<DownloadDashboardViewModel, []>(
	loadDashboard,
	{ initialData: emptyDownloadDashboard(), cacheMs: 5_000 }
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

export async function runDownloadMonitor(limit = 25): Promise<void> {
	await downloadsApi.runDownloadMonitor(limit);
	await downloadsDashboardStore.refresh();
}
