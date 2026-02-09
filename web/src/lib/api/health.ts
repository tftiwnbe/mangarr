import { httpClient } from './client';
import { expectData } from './errors';

export type HealthResponse = Record<string, string | number>;

export async function getHealth(): Promise<HealthResponse> {
	return expectData(await httpClient.GET('/api/v2/health'), 'Unable to load health status');
}
