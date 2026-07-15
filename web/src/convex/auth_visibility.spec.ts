import { describe, expect, it } from 'vitest';

import * as auth from './auth';
import * as settings from './settings';

describe('Convex authentication boundaries', () => {
	it('keeps credential, session, key, and global-setting functions internal', () => {
		const serverOnlyFunctions = [
			auth.getSetupState,
			auth.getUserByUsername,
			auth.getSessionByTokenHash,
			auth.getIntegrationApiKeyByHash,
			auth.registerFirstUser,
			auth.createBrowserSession,
			auth.revokeBrowserSessionByTokenHash,
			auth.revokeBrowserSession,
			auth.touchBrowserSession,
			auth.touchIntegrationApiKey,
			auth.revokeUserSessions,
			auth.getUserProfile,
			auth.listIntegrationApiKeys,
			auth.createIntegrationApiKey,
			auth.revokeIntegrationApiKey,
			auth.updateUserPassword,
			auth.checkLoginRateLimit,
			auth.recordLoginFailure,
			auth.clearLoginFailures,
			settings.getContentLanguages,
			settings.setContentLanguages
		];

		for (const fn of serverOnlyFunctions) {
			expect(fn.isInternal).toBe(true);
		}
	});

	it('keeps the identity-checked viewer query public', () => {
		expect(auth.getViewer.isPublic).toBe(true);
	});
});
