import { ConvexHttpClient } from 'convex/browser';
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';

import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

import { mintConvexAccessToken } from './convex-auth';

const LOCAL_CONVEX_URL = 'http://127.0.0.1:3210';

type ConvexAdminClient = Omit<ConvexHttpClient, 'query' | 'mutation'> & {
	query<Query extends FunctionReference<'query', 'public' | 'internal'>>(
		query: Query,
		args: FunctionArgs<Query>
	): Promise<FunctionReturnType<Query>>;
	mutation<Mutation extends FunctionReference<'mutation', 'public' | 'internal'>>(
		mutation: Mutation,
		args: FunctionArgs<Mutation>
	): Promise<FunctionReturnType<Mutation>>;
};

export function getConvexUrl() {
	return normalizeConvexUrl(
		privateEnv.CONVEX_URL ||
			privateEnv.CONVEX_SELF_HOSTED_URL ||
			publicEnv.PUBLIC_CONVEX_URL ||
			(import.meta.env.DEV ? LOCAL_CONVEX_URL : '')
	);
}

export function getConvexClient() {
	const url = getConvexUrl();
	if (!url) {
		throw new Error('Convex URL is not configured');
	}

	const client = new ConvexHttpClient(url, {
		skipConvexDeploymentUrlCheck: true,
		logger: false
	});

	const adminKey = privateEnv.CONVEX_ADMIN_KEY || privateEnv.CONVEX_SELF_HOSTED_ADMIN_KEY;
	if (adminKey) {
		(
			client as ConvexHttpClient & {
				setAdminAuth(token: string): void;
			}
		).setAdminAuth(adminKey);
	}

	return client;
}

export function getConvexAdminClient(): ConvexAdminClient {
	const adminKey = privateEnv.CONVEX_ADMIN_KEY || privateEnv.CONVEX_SELF_HOSTED_ADMIN_KEY;
	if (!adminKey) {
		throw new Error('Convex admin key is not configured');
	}

	const client = new ConvexHttpClient(getConvexUrl(), {
		skipConvexDeploymentUrlCheck: true,
		logger: false
	});
	(
		client as ConvexHttpClient & {
			setAdminAuth(token: string): void;
		}
	).setAdminAuth(adminKey);
	return client as ConvexAdminClient;
}

function normalizeConvexUrl(url: string) {
	return url.replace(/\/+$/, '');
}

export async function getUserConvexClient(user: {
	id: string;
	username: string;
	isAdmin: boolean;
}) {
	const client = new ConvexHttpClient(getConvexUrl(), {
		skipConvexDeploymentUrlCheck: true,
		logger: false
	});
	const issued = await mintConvexAccessToken(user);
	(
		client as ConvexHttpClient & {
			setAuth(token: string): void;
		}
	).setAuth(issued.token);
	return client;
}
