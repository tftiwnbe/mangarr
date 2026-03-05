import { httpClient } from './client';
import { expectData } from './errors';
import type { components } from './v2';

// Some endpoints are not yet in the generated OpenAPI types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untypedClient = httpClient as any;

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
export type ProxySettingsResource = {
	hostname: string;
	port: number;
	username: string | null;
	password: string | null;
	ignored_addresses: string;
	bypass_local_addresses: boolean;
};
export type ProxySettingsUpdate = Partial<ProxySettingsResource>;

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
		await untypedClient.GET('/api/v2/settings/flaresolverr'),
		'Unable to load FlareSolverr settings'
	);
}

export async function updateFlareSolverrSettings(
	payload: FlareSolverrSettingsUpdate
): Promise<FlareSolverrSettingsResource> {
	return expectData(
		await untypedClient.PUT('/api/v2/settings/flaresolverr', { body: payload }),
		'Unable to update FlareSolverr settings'
	);
}

export async function getProxySettings(): Promise<ProxySettingsResource> {
	return expectData(await untypedClient.GET('/api/v2/settings/proxy'), 'Unable to load proxy settings');
}

export async function updateProxySettings(
	payload: ProxySettingsUpdate
): Promise<ProxySettingsResource> {
	return expectData(
		await untypedClient.PUT('/api/v2/settings/proxy', { body: payload }),
		'Unable to update proxy settings'
	);
}

export type ContentLanguagesResource = { preferred: string[] };
export type ContentLanguagesUpdate = { preferred: string[] };

export type SchedulerJobResource = {
	name: string;
	label: string;
	interval_seconds: number;
	paused: boolean;
	running: boolean;
	last_run_at: string | null;
};
export type SchedulerStatusResource = { jobs: SchedulerJobResource[] };

export async function getContentLanguages(): Promise<ContentLanguagesResource> {
	return expectData(
		await untypedClient.GET('/api/v2/settings/content-languages'),
		'Unable to load content language settings'
	);
}

export async function updateContentLanguages(
	payload: ContentLanguagesUpdate
): Promise<ContentLanguagesResource> {
	return expectData(
		await untypedClient.PUT('/api/v2/settings/content-languages', { body: payload }),
		'Unable to update content language settings'
	);
}

export async function getSchedulerStatus(): Promise<SchedulerStatusResource> {
	return expectData(
		await untypedClient.GET('/api/v2/settings/scheduler'),
		'Unable to load scheduler status'
	);
}

export async function triggerSchedulerJob(jobName: string): Promise<SchedulerJobResource> {
	return expectData(
		await untypedClient.POST(`/api/v2/settings/scheduler/${jobName}/trigger`),
		'Unable to trigger job'
	);
}

export async function pauseSchedulerJob(jobName: string): Promise<SchedulerJobResource> {
	return expectData(
		await untypedClient.POST(`/api/v2/settings/scheduler/${jobName}/pause`),
		'Unable to pause job'
	);
}

export async function resumeSchedulerJob(jobName: string): Promise<SchedulerJobResource> {
	return expectData(
		await untypedClient.POST(`/api/v2/settings/scheduler/${jobName}/resume`),
		'Unable to resume job'
	);
}
