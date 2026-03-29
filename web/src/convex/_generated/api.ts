/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as app from '../app.js';
import type * as auth from '../auth.js';
import type * as bridge from '../bridge.js';
import type * as bridge_auth from '../bridge_auth.js';
import type * as commands from '../commands.js';
import type * as crons from '../crons.js';
import type * as extensions from '../extensions.js';
import type * as library from '../library.js';
import type * as library_downloads from '../library_downloads.js';
import type * as library_metadata from '../library_metadata.js';
import type * as library_organization from '../library_organization.js';
import type * as library_reader from '../library_reader.js';
import type * as library_shared from '../library_shared.js';
import type * as settings from '../settings.js';

import type { ApiFromModules, FilterApi, FunctionReference } from 'convex/server';
import { anyApi, componentsGeneric } from 'convex/server';

const fullApi: ApiFromModules<{
	app: typeof app;
	auth: typeof auth;
	bridge: typeof bridge;
	bridge_auth: typeof bridge_auth;
	commands: typeof commands;
	crons: typeof crons;
	extensions: typeof extensions;
	library: typeof library;
	library_downloads: typeof library_downloads;
	library_metadata: typeof library_metadata;
	library_organization: typeof library_organization;
	library_reader: typeof library_reader;
	library_shared: typeof library_shared;
	settings: typeof settings;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<typeof fullApi, FunctionReference<any, 'public'>> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
	typeof fullApi,
	FunctionReference<any, 'internal'>
> = anyApi as any;

export const components = componentsGeneric() as unknown as {};
