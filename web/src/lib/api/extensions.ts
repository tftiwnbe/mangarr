import { httpClient } from './client';
import { expectData, expectNoContent } from './errors';
import type { components } from './v2';

export type ExtensionResource = components['schemas']['ExtensionResource'];
export type RepoExtensionResource = components['schemas']['RepoExtensionResource'];
export type RepositoryUpdate = components['schemas']['RepositoryUpdate'];
export type SourcePreferenceUpdate = components['schemas']['SourcePreferenceUpdate'];
export type SourcePreferencesResource = components['schemas']['SourcePreferencesResource'];
export type SourcePreferencesResolved = Omit<SourcePreferencesResource, 'name' | 'lang'> & {
	name: string;
	lang: string;
};

function resolveSourcePreferences(resource: SourcePreferencesResource): SourcePreferencesResolved {
	return {
		...resource,
		name: resource.name ?? '',
		lang: resource.lang ?? ''
	};
}

export async function listAvailableExtensions(): Promise<RepoExtensionResource[]> {
	return expectData(
		await httpClient.GET('/api/v2/extensions/available'),
		'Unable to load available extensions'
	);
}

export async function listInstalledExtensions(): Promise<ExtensionResource[]> {
	return expectData(
		await httpClient.GET('/api/v2/extensions/installed'),
		'Unable to load installed extensions'
	);
}

export async function updateExtensionRepository(
	payload: RepositoryUpdate
): Promise<RepoExtensionResource[]> {
	return expectData(
		await httpClient.PUT('/api/v2/extensions/repository', { body: payload }),
		'Unable to update extension repository'
	);
}

export async function installExtension(extensionPkg: string): Promise<ExtensionResource> {
	return expectData(
		await httpClient.POST('/api/v2/extensions/install/{extension_pkg}', {
			params: { path: { extension_pkg: extensionPkg } }
		}),
		'Unable to install extension'
	);
}

export async function uninstallExtension(extensionPkg: string): Promise<void> {
	expectNoContent(
		await httpClient.DELETE('/api/v2/extensions/uninstall/{extension_pkg}', {
			params: { path: { extension_pkg: extensionPkg } }
		}),
		'Unable to uninstall extension'
	);
}

export async function updateExtensionsPriority(extensionsByPriority: string[]): Promise<void> {
	expectNoContent(
		await httpClient.PUT('/api/v2/extensions/priority', { body: extensionsByPriority }),
		'Unable to update extensions priority'
	);
}

export async function toggleExtensionProxy(extensionPkg: string, useProxy: boolean): Promise<void> {
	expectNoContent(
		await httpClient.PUT('/api/v2/extensions/{extension_pkg}/proxy', {
			params: {
				path: { extension_pkg: extensionPkg },
				query: { use_proxy: useProxy }
			}
		}),
		'Unable to toggle extension proxy'
	);
}

export async function getSourcePreferences(sourceId: string): Promise<SourcePreferencesResolved> {
	return resolveSourcePreferences(
		expectData(
			await httpClient.GET('/api/v2/extensions/source/{source_id}/preferences', {
				params: { path: { source_id: sourceId } }
			}),
			'Unable to load source preferences'
		)
	);
}

export async function updateSourcePreferences(
	sourceId: string,
	preferences: SourcePreferenceUpdate[]
): Promise<SourcePreferencesResolved> {
	return resolveSourcePreferences(
		expectData(
			await httpClient.PUT('/api/v2/extensions/source/{source_id}/preferences', {
				params: { path: { source_id: sourceId } },
				body: preferences
			}),
			'Unable to update source preferences'
		)
	);
}

export async function toggleSourceEnabled(sourceId: string, enabled: boolean): Promise<void> {
	expectNoContent(
		await httpClient.PUT('/api/v2/extensions/source/{source_id}/enabled', {
			params: {
				path: { source_id: sourceId },
				query: { enabled }
			}
		}),
		'Unable to toggle source'
	);
}
