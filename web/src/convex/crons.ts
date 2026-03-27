import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval(
	'download watch cycle',
	{ minutes: 1 },
	internal.library_downloads.runScheduledDownloadCycles,
	{
		limitPerUser: 25,
		maxUsers: 50
	}
);

export default crons;
