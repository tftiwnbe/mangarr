import { httpClient } from './client';
import { expectData } from './errors';
import type { components } from './v2';

export type DownloadSettingsResource = components['schemas']['DownloadSettingsResource'];
export type DownloadSettingsUpdate = components['schemas']['DownloadSettingsUpdate'];
export type JobsSettingsResource = components['schemas']['JobsSettingsResource'];
export type JobsSettingsUpdate = components['schemas']['JobsSettingsUpdate'];
export type JobsCleanupRunResource = components['schemas']['JobsCleanupRunResource'];
export type FlareSolverrSettingsResource = {
	enabled: boolean;
	url: string;
	timeout_seconds: number;
	response_fallback: boolean;
	session_name: string | null;
	session_ttl_minutes: number | null;
};
export type FlareSolverrSettingsUpdate = Partial<FlareSolverrSettingsResource>;

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

export async function getFlareSolverrSettings(): Promise<FlareSolverrSettingsResource> {
	return expectData(
		await (httpClient as any).GET('/api/v2/settings/flaresolverr'),
		'Unable to load FlareSolverr settings'
	);
}

export async function updateFlareSolverrSettings(
	payload: FlareSolverrSettingsUpdate
): Promise<FlareSolverrSettingsResource> {
	return expectData(
		await (httpClient as any).PUT('/api/v2/settings/flaresolverr', { body: payload }),
		'Unable to update FlareSolverr settings'
	);
}
