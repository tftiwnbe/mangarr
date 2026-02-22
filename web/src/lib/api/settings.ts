import { httpClient } from './client';
import { expectData } from './errors';
import type { components } from './v2';

export type DownloadSettingsResource = components['schemas']['DownloadSettingsResource'];
export type DownloadSettingsUpdate = components['schemas']['DownloadSettingsUpdate'];
export type JobsSettingsResource = components['schemas']['JobsSettingsResource'];
export type JobsSettingsUpdate = components['schemas']['JobsSettingsUpdate'];
export type JobsCleanupRunResource = components['schemas']['JobsCleanupRunResource'];

export async function getDownloadSettings(): Promise<DownloadSettingsResource> {
	return expectData(await httpClient.GET('/api/v2/settings/downloads'), 'Unable to load download settings');
}

export async function updateDownloadSettings(
	payload: DownloadSettingsUpdate
): Promise<DownloadSettingsResource> {
	return expectData(
		await httpClient.PUT('/api/v2/settings/downloads', { body: payload }),
		'Unable to update download settings'
	);
}

export async function getJobsSettings(): Promise<JobsSettingsResource> {
	return expectData(await httpClient.GET('/api/v2/settings/jobs'), 'Unable to load jobs settings');
}

export async function updateJobsSettings(payload: JobsSettingsUpdate): Promise<JobsSettingsResource> {
	return expectData(
		await httpClient.PUT('/api/v2/settings/jobs', { body: payload }),
		'Unable to update jobs settings'
	);
}

export async function runCleanupNow(): Promise<JobsCleanupRunResource> {
	return expectData(
		await httpClient.POST('/api/v2/settings/jobs/cleanup-now'),
		'Unable to run cleanup job'
	);
}
