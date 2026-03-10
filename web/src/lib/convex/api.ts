import { makeFunctionReference } from 'convex/server';

export const convexApi = {
	auth: {
		getViewer: makeFunctionReference<'query'>('auth:getViewer')
	}
};
