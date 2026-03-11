import { makeFunctionReference } from 'convex/server';

const mutation = (name: string) => makeFunctionReference<'mutation'>(name);
const query = (name: string) => makeFunctionReference<'query'>(name);

export const workerApi = {
	worker: {
		reportHeartbeat: mutation('worker:reportHeartbeat')
	},
	commands: {
		lease: mutation('commands:lease'),
		markRunning: mutation('commands:markRunning'),
		renewLease: mutation('commands:renewLease'),
		complete: mutation('commands:complete'),
		fail: mutation('commands:fail')
	},
	extensions: {
		setRepository: mutation('extensions:setRepository'),
		upsertInstalled: mutation('extensions:upsertInstalled')
	},
	explore: {
		search: query('explore:search'),
		getTitle: query('explore:getTitle')
	},
	library: {
		importForUser: mutation('library:importForUser')
	}
} as const;
