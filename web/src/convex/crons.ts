import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();
const internalMaintenance = internal as unknown as {
	maintenance: {
		runRetentionPass: typeof internal.library_downloads.runScheduledDownloadCycles;
	};
};

crons.interval(
	'download watch cycle',
	{ minutes: 1 },
	internal.library_downloads.runScheduledDownloadCycles,
	{
		limitPerUser: 25,
		maxUsers: 50
	}
);

crons.interval(
	'data retention pass',
	{ hours: 6 },
	internalMaintenance.maintenance.runRetentionPass,
	{}
);

export default crons;
