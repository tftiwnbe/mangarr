import { makeFunctionReference } from 'convex/server';

export const convexApi = {
  auth: {
    getSetupState: makeFunctionReference<'query'>('auth:getSetupState'),
    getUserByUsername: makeFunctionReference<'query'>('auth:getUserByUsername'),
    getSessionByTokenHash: makeFunctionReference<'query'>('auth:getSessionByTokenHash'),
    getUserProfile: makeFunctionReference<'query'>('auth:getUserProfile'),
    registerFirstUser: makeFunctionReference<'mutation'>('auth:registerFirstUser'),
    createBrowserSession: makeFunctionReference<'mutation'>('auth:createBrowserSession'),
    revokeBrowserSessionByTokenHash: makeFunctionReference<'mutation'>('auth:revokeBrowserSessionByTokenHash'),
    revokeUserSessions: makeFunctionReference<'mutation'>('auth:revokeUserSessions'),
    touchBrowserSession: makeFunctionReference<'mutation'>('auth:touchBrowserSession')
  },
  app: {
    bootstrap: makeFunctionReference<'query'>('app:bootstrap')
  }
};
