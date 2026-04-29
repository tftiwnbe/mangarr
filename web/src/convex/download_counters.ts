import { ShardedCounter } from '@convex-dev/sharded-counter';
import type { ComponentApi as ShardedCounterComponent } from '@convex-dev/sharded-counter/_generated/component.js';
import type { GenericId } from 'convex/values';

import { components } from './_generated/api';
import type { MutationCtx, QueryCtx } from './_generated/server';

const DOWNLOAD_STATUS_COUNTERS = ['queued', 'downloading', 'downloaded', 'failed'] as const;
type DownloadStatusCounter = (typeof DOWNLOAD_STATUS_COUNTERS)[number];

const ACTIVE_TASK_STATUSES = new Set(['queued', 'downloading']);
const shardedCounterComponent = (components as { shardedCounter: ShardedCounterComponent })
	.shardedCounter;
const downloadCounters = new ShardedCounter<string>(shardedCounterComponent, {
	defaultShards: 16
});

function titleStatusCounterName(
	titleId: GenericId<'libraryTitles'>,
	status: DownloadStatusCounter
) {
	return `title:${String(titleId)}:downloadStatus:${status}`;
}

function titleDownloadedBytesCounterName(titleId: GenericId<'libraryTitles'>) {
	return `title:${String(titleId)}:downloadedBytes`;
}

function userActiveDownloadsCounterName(ownerUserId: GenericId<'users'>) {
	return `user:${String(ownerUserId)}:activeDownloads`;
}

function isDownloadStatusCounter(status: string | undefined): status is DownloadStatusCounter {
	return DOWNLOAD_STATUS_COUNTERS.includes(status as DownloadStatusCounter);
}

function isActiveTaskStatus(status: string | undefined) {
	return status !== undefined && ACTIVE_TASK_STATUSES.has(status);
}

export async function applyChapterDownloadCounterDelta(
	ctx: MutationCtx,
	args: {
		libraryTitleId: GenericId<'libraryTitles'>;
		oldStatus: string | undefined;
		newStatus: string;
		oldFileSizeBytes?: number;
		newFileSizeBytes?: number;
	}
) {
	if (args.oldStatus !== args.newStatus) {
		if (isDownloadStatusCounter(args.oldStatus)) {
			await downloadCounters.subtract(
				ctx,
				titleStatusCounterName(args.libraryTitleId, args.oldStatus)
			);
		}
		if (isDownloadStatusCounter(args.newStatus)) {
			await downloadCounters.inc(ctx, titleStatusCounterName(args.libraryTitleId, args.newStatus));
		}
	}

	const oldDownloadedBytes =
		args.oldStatus === 'downloaded' ? Math.max(0, args.oldFileSizeBytes ?? 0) : 0;
	const newDownloadedBytes =
		args.newStatus === 'downloaded' ? Math.max(0, args.newFileSizeBytes ?? 0) : 0;
	const bytesDelta = newDownloadedBytes - oldDownloadedBytes;
	if (bytesDelta !== 0) {
		await downloadCounters.add(
			ctx,
			titleDownloadedBytesCounterName(args.libraryTitleId),
			bytesDelta
		);
	}
}

export async function applyTaskActiveDownloadCounterDelta(
	ctx: MutationCtx,
	args: {
		ownerUserId: GenericId<'users'>;
		oldStatus: string | undefined;
		newStatus: string;
	}
) {
	const oldActive = isActiveTaskStatus(args.oldStatus);
	const newActive = isActiveTaskStatus(args.newStatus);
	if (oldActive === newActive) return;

	await downloadCounters.add(
		ctx,
		userActiveDownloadsCounterName(args.ownerUserId),
		newActive ? 1 : -1
	);
}

export async function reconcileTitleDownloadCounters(
	ctx: MutationCtx,
	args: {
		libraryTitleId: GenericId<'libraryTitles'>;
		queued: number;
		downloading: number;
		downloaded: number;
		failed: number;
		downloadedBytes: number;
	}
) {
	const statusCounts: Record<DownloadStatusCounter, number> = {
		queued: args.queued,
		downloading: args.downloading,
		downloaded: args.downloaded,
		failed: args.failed
	};

	for (const status of DOWNLOAD_STATUS_COUNTERS) {
		const name = titleStatusCounterName(args.libraryTitleId, status);
		await downloadCounters.reset(ctx, name);
		const count = Math.max(0, statusCounts[status]);
		if (count > 0) {
			await downloadCounters.add(ctx, name, count);
		}
	}

	const bytesName = titleDownloadedBytesCounterName(args.libraryTitleId);
	await downloadCounters.reset(ctx, bytesName);
	if (args.downloadedBytes > 0) {
		await downloadCounters.add(ctx, bytesName, args.downloadedBytes);
	}
}

export async function reconcileUserActiveDownloadCounter(
	ctx: MutationCtx,
	ownerUserId: GenericId<'users'>,
	activeCount: number
) {
	const name = userActiveDownloadsCounterName(ownerUserId);
	await downloadCounters.reset(ctx, name);
	if (activeCount > 0) {
		await downloadCounters.add(ctx, name, activeCount);
	}
}

export async function readTitleDownloadCounters(
	ctx: QueryCtx,
	libraryTitleId: GenericId<'libraryTitles'>
) {
	return {
		queued: await downloadCounters.count(ctx, titleStatusCounterName(libraryTitleId, 'queued')),
		downloading: await downloadCounters.count(
			ctx,
			titleStatusCounterName(libraryTitleId, 'downloading')
		),
		downloaded: await downloadCounters.count(
			ctx,
			titleStatusCounterName(libraryTitleId, 'downloaded')
		),
		failed: await downloadCounters.count(ctx, titleStatusCounterName(libraryTitleId, 'failed')),
		downloadedBytes: await downloadCounters.count(
			ctx,
			titleDownloadedBytesCounterName(libraryTitleId)
		)
	};
}

export async function estimateUserActiveDownloadCount(
	ctx: QueryCtx,
	ownerUserId: GenericId<'users'>
) {
	return downloadCounters.estimateCount(ctx, userActiveDownloadsCounterName(ownerUserId), 2);
}
