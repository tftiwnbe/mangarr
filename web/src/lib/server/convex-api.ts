import { makeFunctionReference } from 'convex/server';

export const convexApi = {
	auth: {
		getSetupState: makeFunctionReference<'query'>('auth:getSetupState'),
		getUserByUsername: makeFunctionReference<'query'>('auth:getUserByUsername'),
		getSessionByTokenHash: makeFunctionReference<'query'>('auth:getSessionByTokenHash'),
		getUserProfile: makeFunctionReference<'query'>('auth:getUserProfile'),
		listIntegrationApiKeys: makeFunctionReference<'query'>('auth:listIntegrationApiKeys'),
		registerFirstUser: makeFunctionReference<'mutation'>('auth:registerFirstUser'),
		createBrowserSession: makeFunctionReference<'mutation'>('auth:createBrowserSession'),
		createIntegrationApiKey: makeFunctionReference<'mutation'>('auth:createIntegrationApiKey'),
		revokeBrowserSessionByTokenHash: makeFunctionReference<'mutation'>(
			'auth:revokeBrowserSessionByTokenHash'
		),
		revokeIntegrationApiKey: makeFunctionReference<'mutation'>('auth:revokeIntegrationApiKey'),
		revokeUserSessions: makeFunctionReference<'mutation'>('auth:revokeUserSessions'),
		touchBrowserSession: makeFunctionReference<'mutation'>('auth:touchBrowserSession'),
		updateUserPassword: makeFunctionReference<'mutation'>('auth:updateUserPassword')
	},
	worker: {
		reportHeartbeat: makeFunctionReference<'mutation'>('worker:reportHeartbeat')
	},
	app: {
		bootstrap: makeFunctionReference<'query'>('app:bootstrap')
	}
};
