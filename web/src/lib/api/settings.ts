import { httpClient } from './client';
import { expectData } from './errors';
import type { components } from './v2';

export type DownloadSettingsResource = components['schemas']['DownloadSettingsResource'];
export type DownloadSettingsUpdate = components['schemas']['DownloadSettingsUpdate'];
export type JobsSettingsResource = components['schemas']['JobsSettingsResource'];
export type JobsSettingsUpdate = components['schemas']['JobsSettingsUpdate'];
export type JobsCleanupRunResource = components['schemas']['JobsCleanupRunResource'];
export type FlareSolverrSettingsResource = components['schemas']['FlareSolverrSettingsResource'];
export type FlareSolverrSettingsUpdate = components['schemas']['FlareSolverrSettingsUpdate'];
export type ProxySettingsResource = components['schemas']['ProxySettingsResource'];
export type ProxySettingsUpdate = components['schemas']['ProxySettingsUpdate'];
export type ContentLanguagesResource = components['schemas']['ContentLanguagesResource'];
export type ContentLanguagesUpdate = components['schemas']['ContentLanguagesUpdate'];
export type SchedulerJobResource = components['schemas']['SchedulerJobResource'];
export type SchedulerStatusResource = components['schemas']['SchedulerStatusResource'];

export async function getDownloadSettings(): Promise<DownloadSettingsResource> {
	return expectData(
		await httpClient.GET('/api/v2/settings/downloads'),
		'Unable to load download settings'
	);
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

export async function updateJobsSettings(
	payload: JobsSettingsUpdate
): Promise<JobsSettingsResource> {
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
		await httpClient.GET('/api/v2/settings/flaresolverr'),
		'Unable to load FlareSolverr settings'
	);
}

export async function updateFlareSolverrSettings(
	payload: FlareSolverrSettingsUpdate
): Promise<FlareSolverrSettingsResource> {
	return expectData(
		await httpClient.PUT('/api/v2/settings/flaresolverr', { body: payload }),
		'Unable to update FlareSolverr settings'
	);
}

export async function getProxySettings(): Promise<ProxySettingsResource> {
	return expectData(
		await httpClient.GET('/api/v2/settings/proxy'),
		'Unable to load proxy settings'
	);
}

export async function updateProxySettings(
	payload: ProxySettingsUpdate
): Promise<ProxySettingsResource> {
	return expectData(
		await httpClient.PUT('/api/v2/settings/proxy', { body: payload }),
		'Unable to update proxy settings'
	);
}

export async function getContentLanguages(): Promise<ContentLanguagesResource> {
	return expectData(
		await httpClient.GET('/api/v2/settings/content-languages'),
		'Unable to load content language settings'
	);
}

export async function updateContentLanguages(
	payload: ContentLanguagesUpdate
): Promise<ContentLanguagesResource> {
	return expectData(
		await httpClient.PUT('/api/v2/settings/content-languages', { body: payload }),
		'Unable to update content language settings'
	);
}

export async function getSchedulerStatus(): Promise<SchedulerStatusResource> {
	return expectData(
		await httpClient.GET('/api/v2/settings/scheduler'),
		'Unable to load scheduler status'
	);
}

export async function triggerSchedulerJob(jobName: string): Promise<SchedulerJobResource> {
	return expectData(
		await httpClient.POST('/api/v2/settings/scheduler/{job_name}/trigger', {
			params: { path: { job_name: jobName } }
		}),
		'Unable to trigger job'
	);
}

export async function pauseSchedulerJob(jobName: string): Promise<SchedulerJobResource> {
	return expectData(
		await httpClient.POST('/api/v2/settings/scheduler/{job_name}/pause', {
			params: { path: { job_name: jobName } }
		}),
		'Unable to pause job'
	);
}

export async function resumeSchedulerJob(jobName: string): Promise<SchedulerJobResource> {
	return expectData(
		await httpClient.POST('/api/v2/settings/scheduler/{job_name}/resume', {
			params: { path: { job_name: jobName } }
		}),
		'Unable to resume job'
	);
}
