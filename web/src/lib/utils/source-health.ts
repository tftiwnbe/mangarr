export type SourceHealthScope = 'feed' | 'search' | 'title';
export type SourceHealthState = 'cooldown' | 'degraded';

export type SourceHealthEntry = {
	sourceId: string;
	scope: SourceHealthScope;
	state: SourceHealthState;
	message: string;
	retryAfter: number | null;
	permanent: boolean;
	updatedAt: number;
};

export type SourceHealthLike = Pick<SourceHealthEntry, 'retryAfter' | 'permanent'>;

export function sourceHealthScopeForCommandType(commandType: string): SourceHealthScope | null {
	switch (commandType) {
		case 'explore.popular':
		case 'explore.latest':
			return 'feed';
		case 'explore.search':
			return 'search';
		case 'explore.title.fetch':
		case 'explore.chapters.fetch':
			return 'title';
		default:
			return null;
	}
}

export function isPermanentSourceFailure(message: string): boolean {
	const normalized = message.trim().toLowerCase();
	return (
		normalized.includes('http error 403') ||
		normalized.includes('http error 404') ||
		normalized.includes('not supported') ||
		normalized.includes('unsupported')
	);
}

export function sourceHealthLabelKey(
	entry: Pick<SourceHealthEntry, 'state' | 'permanent'>
): string {
	if (entry.state === 'cooldown') {
		return 'explore.sourceCooldown';
	}
	return entry.permanent ? 'explore.sourceUnavailable' : 'explore.sourceDegraded';
}

export function effectiveSourceHealthState(
	entry: SourceHealthLike,
	now: number = Date.now()
): SourceHealthState {
	if (!entry.permanent && entry.retryAfter !== null && entry.retryAfter > now) {
		return 'cooldown';
	}
	return 'degraded';
}

export function sourceHealthRetryInMinutes(
	retryAfter: number | null,
	now: number = Date.now()
): number | null {
	if (retryAfter === null || retryAfter <= now) {
		return null;
	}
	return Math.max(1, Math.ceil((retryAfter - now) / 60_000));
}
