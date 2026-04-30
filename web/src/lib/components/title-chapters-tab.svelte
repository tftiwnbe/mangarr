<script lang="ts">
	import {
		ArrowsClockwiseIcon,
		BookIcon,
		CheckIcon,
		DownloadIcon,
		SpinnerIcon,
		XIcon
	} from 'phosphor-svelte';

	import { Button } from '$lib/elements/button';
	import { _ } from '$lib/i18n';
	import {
		formatChapterNumberValue,
		hasDisplayableChapterNumber,
		parseStructuredChapterName
	} from '$lib/utils/chapter-display';

	type ChapterRow = {
		_id: string;
		chapterName: string;
		chapterNumber?: number | null;
		scanlator?: string | null;
		dateUpload?: number | null;
		isRead?: boolean;
		progressPageIndex?: number | null;
		downloadStatus: 'missing' | 'queued' | 'downloading' | 'downloaded' | 'failed';
		lastErrorMessage?: string | null;
	};

	type Props = {
		titleChapters: ChapterRow[];
		chapterHydrationStatus: 'idle' | 'syncing' | 'refreshing' | 'failed';
		chapterHydrationHeadline: string;
		chapterHydrationDescription: string;
		downloadingChapterIds: string[];
		onRetryHydration: () => void;
		onOpenChapter: (chapter: ChapterRow) => void;
		onDownloadChapter: (chapterId: string) => void;
		onResetChapterProgress: (chapterId: string) => void;
		onMarkPreviousRead: (chapterId: string) => void;
		onFetchNewChapters: () => void;
		fetchingNewChapters?: boolean;
		progressActionChapterId?: string | null;
	};

	let {
		titleChapters,
		chapterHydrationStatus,
		chapterHydrationHeadline,
		chapterHydrationDescription,
		downloadingChapterIds,
		onRetryHydration,
		onOpenChapter,
		onDownloadChapter,
		onResetChapterProgress,
		onMarkPreviousRead,
		onFetchNewChapters,
		fetchingNewChapters = false,
		progressActionChapterId = null
	}: Props = $props();

	const fetchBusy = $derived(
		fetchingNewChapters ||
			chapterHydrationStatus === 'syncing' ||
			chapterHydrationStatus === 'refreshing'
	);

	const DAY = 86_400_000;

	function relativeDate(value?: number | null): string {
		if (!value) return '';
		const diff = Date.now() - value;
		if (Number.isNaN(diff)) return '';
		if (diff < DAY) return $_('chapter.relative.today');
		const days = Math.floor(diff / DAY);
		if (days < 7) return $_('chapter.relative.days', { values: { n: days } });
		if (days < 30) return $_('chapter.relative.weeks', { values: { n: Math.floor(days / 7) } });
		if (days < 365) return $_('chapter.relative.months', { values: { n: Math.floor(days / 30) } });
		return $_('chapter.relative.years', { values: { n: Math.floor(days / 365) } });
	}

	function chapterLabel(chapter: ChapterRow): string {
		if (hasDisplayableChapterNumber(chapter.chapterNumber)) {
			return $_('chapter.chapterShort', {
				values: { number: formatChapterNumberValue(chapter.chapterNumber) }
			});
		}
		const parsed = parseStructuredChapterName(chapter.chapterName);
		if (parsed) {
			const parts: string[] = [];
			if (parsed.volumeNumber) {
				parts.push($_('chapter.volumeShort', { values: { number: parsed.volumeNumber } }));
			}
			if (parsed.chapterNumber) {
				parts.push($_('chapter.chapterShort', { values: { number: parsed.chapterNumber } }));
			}
			if (parts.length > 0) {
				return parts.join(' · ');
			}
		}
		return chapter.chapterName || $_('title.noChapters');
	}

	function chapterDetail(chapter: ChapterRow): string | null {
		const raw = chapter.chapterName.trim();
		if (!raw) return null;
		if (hasDisplayableChapterNumber(chapter.chapterNumber)) {
			const chapterShort = $_('chapter.chapterShort', {
				values: { number: formatChapterNumberValue(chapter.chapterNumber) }
			});
			if (raw === chapterShort) return null;
			return raw;
		}
		const parsed = parseStructuredChapterName(raw);
		if (parsed) {
			return parsed.detail;
		}
		return raw;
	}

	function downloadLabel(status: ChapterRow['downloadStatus']): string | null {
		if (status === 'queued') return $_('downloads.queued');
		if (status === 'failed') return $_('downloads.failed');
		return null;
	}

	const dominantScanlator = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const c of titleChapters) {
			const s = (c.scanlator ?? '').trim();
			if (!s) continue;
			counts.set(s, (counts.get(s) ?? 0) + 1);
		}
		if (counts.size === 0) return null;
		const half = titleChapters.length / 2;
		let best: { name: string; n: number } | null = null;
		for (const [name, n] of counts) {
			if (!best || n > best.n) best = { name, n };
		}
		return best && best.n > half ? best.name : null;
	});
</script>

<div class="chapters-tab">
	<button
		type="button"
		data-testid="fetch-new-chapters"
		class="fetch-link"
		class:is-busy={fetchBusy}
		onclick={() => {
			if (!fetchBusy) onFetchNewChapters();
		}}
		disabled={fetchBusy}
	>
		{#if fetchBusy}
			<SpinnerIcon size={12} class="animate-spin" />
		{:else}
			<ArrowsClockwiseIcon size={12} />
		{/if}
		<span>
			{fetchBusy ? $_('title.fetchingNewChapters') : $_('title.fetchNewChapters')}
		</span>
	</button>

	{#if titleChapters.length === 0}
		<div class="empty">
			<BookIcon size={24} class="text-[var(--void-5)]" />
			<p class="empty-headline">{chapterHydrationHeadline}</p>
			<p class="empty-desc">{chapterHydrationDescription}</p>
			{#if chapterHydrationStatus === 'failed'}
				<Button variant="outline" size="sm" onclick={onRetryHydration}>
					{$_('common.retry')}
				</Button>
			{/if}
		</div>
	{:else}
		<ol class="chapter-list">
			{#each titleChapters as chapter, idx (chapter._id)}
				{@const detail = chapterDetail(chapter)}
				{@const dlLabel = downloadLabel(chapter.downloadStatus)}
				{@const inProgress =
					!chapter.isRead &&
					typeof chapter.progressPageIndex === 'number' &&
					chapter.progressPageIndex > 0}
				{@const downloading =
					chapter.downloadStatus === 'queued' ||
					chapter.downloadStatus === 'downloading' ||
					downloadingChapterIds.includes(chapter._id)}
				{@const scan = (chapter.scanlator ?? '').trim()}
				{@const showScan =
					!!scan &&
					(!dominantScanlator || scan !== dominantScanlator) &&
					scan !== (titleChapters[idx - 1]?.scanlator ?? '').trim()}
				<li
					class="row"
					class:is-read={chapter.isRead}
					class:is-progress={inProgress}
					data-testid="chapter-row"
					data-chapter-id={chapter._id}
					data-download-status={chapter.downloadStatus}
					data-read={chapter.isRead ? 'true' : 'false'}
				>
					<button
						type="button"
						data-testid="chapter-open"
						class="row-tap"
						onclick={() => onOpenChapter(chapter)}
					>
						<span class="mark" aria-hidden="true"></span>
						<span class="head">
							<span class="num">{chapterLabel(chapter)}</span>
							{#if detail}
								<span class="detail">{detail}</span>
							{/if}
							{#if showScan}
								<span class="scan">{scan}</span>
							{/if}
						</span>
						{#if chapter.dateUpload}
							<span class="date">{relativeDate(chapter.dateUpload)}</span>
						{/if}
						{#if dlLabel}
							<span class="state">{dlLabel}</span>
						{/if}
						{#if chapter.lastErrorMessage}
							<span class="err">{chapter.lastErrorMessage}</span>
						{/if}
					</button>
					<div class="actions">
						{#if chapter.isRead}
							<button
								type="button"
								class="icon-btn"
								title={$_('title.markAsUnread')}
								aria-label={$_('title.markAsUnread')}
								onclick={() => onResetChapterProgress(chapter._id)}
								disabled={progressActionChapterId === chapter._id}
							>
								<XIcon size={14} weight="regular" />
							</button>
						{:else}
							<button
								type="button"
								class="icon-btn"
								title={$_('title.markPreviousRead')}
								aria-label={$_('title.markPreviousRead')}
								disabled={progressActionChapterId === chapter._id}
								onclick={() => onMarkPreviousRead(chapter._id)}
							>
								<CheckIcon size={14} weight="regular" />
							</button>
						{/if}
						{#if chapter.downloadStatus === 'downloaded'}
							<span class="icon-btn is-static" title={$_('chapter.downloaded')}>
								<CheckIcon size={14} weight="bold" />
							</span>
						{:else}
							<button
								type="button"
								class="icon-btn"
								data-testid="chapter-download"
								title={dlLabel ?? $_('chapter.download')}
								aria-label={dlLabel ?? $_('chapter.download')}
								onclick={() => onDownloadChapter(chapter._id)}
								disabled={downloading}
							>
								{#if downloading}
									<SpinnerIcon size={13} class="animate-spin" />
								{:else}
									<DownloadIcon size={13} />
								{/if}
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ol>
	{/if}
</div>

<style>
	.chapters-tab {
		display: flex;
		flex-direction: column;
	}

	.fetch-link {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 0;
		margin-bottom: 4px;
		background: transparent;
		border: 0;
		color: var(--text-ghost);
		font-size: 11px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		line-height: 1;
		cursor: pointer;
		transition: color 140ms ease;
	}
	.fetch-link:hover:not(:disabled) {
		color: var(--text);
	}
	.fetch-link:focus-visible {
		outline: none;
		color: var(--text);
	}
	.fetch-link:disabled {
		cursor: progress;
		color: var(--text-muted);
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 64px 0;
	}
	.empty-headline {
		font-size: 13px;
		color: var(--text-ghost);
	}
	.empty-desc {
		font-size: 11px;
		color: var(--text-muted);
	}

	.chapter-list {
		list-style: none;
		margin: 0;
		padding: 0 0 24px;
	}
	.chapter-list .row:last-child {
		border-bottom: 1px solid color-mix(in srgb, var(--void-4) 60%, transparent);
	}

	.row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.row + .row {
		border-top: 1px solid color-mix(in srgb, var(--void-4) 60%, transparent);
	}

	.row-tap {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 8px 8px 8px 0;
		background: transparent;
		border: 0;
		text-align: left;
		cursor: pointer;
		color: inherit;
	}
	.row-tap:focus-visible {
		outline: none;
	}
	.row-tap:focus-visible .num {
		color: var(--text);
		text-decoration: underline;
		text-decoration-color: var(--accent-line);
		text-underline-offset: 3px;
	}

	.mark {
		flex-shrink: 0;
		width: 4px;
		height: 4px;
		align-self: center;
		background: var(--text);
		border-radius: 0;
		transition:
			background 140ms ease,
			box-shadow 140ms ease;
	}
	.is-progress .mark {
		background: var(--text-soft);
	}
	.is-read .mark {
		background: transparent;
		box-shadow: inset 0 0 0 1px var(--text-ghost);
	}

	.head {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 8px;
		overflow: hidden;
	}

	.num {
		flex-shrink: 0;
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum';
		color: var(--text);
		letter-spacing: 0.01em;
		transition: color 140ms ease;
	}
	.is-read .num {
		color: var(--text-ghost);
		text-decoration: line-through;
		text-decoration-color: var(--void-6);
	}

	.detail {
		min-width: 0;
		font-size: 13px;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.is-read .detail {
		color: var(--text-ghost);
	}

	.scan {
		flex-shrink: 0;
		font-size: 11px;
		color: var(--text-ghost);
		max-width: 14ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.date,
	.state {
		flex-shrink: 0;
		font-size: 11px;
		color: var(--text-ghost);
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.02em;
	}
	.is-read .date,
	.is-read .state,
	.is-read .scan {
		color: var(--void-7);
	}

	.err {
		flex-basis: 100%;
		font-size: 11px;
		color: var(--error);
	}

	.actions {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0;
	}

	.icon-btn {
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 0;
		border-radius: 2px;
		color: var(--text-ghost);
		cursor: pointer;
		transition:
			color 140ms ease,
			background 140ms ease;
	}
	.icon-btn:hover:not(:disabled) {
		color: var(--text);
		background: var(--void-3);
	}
	.icon-btn:focus-visible {
		outline: none;
		color: var(--text);
		background: var(--void-3);
	}
	.icon-btn:disabled {
		cursor: progress;
		color: var(--void-6);
	}
	.icon-btn.is-static {
		cursor: default;
		color: var(--text-soft);
	}
	.icon-btn.is-static:hover {
		background: transparent;
	}

	@media (min-width: 640px) {
		.row-tap {
			gap: 14px;
			padding: 10px 8px 10px 0;
		}
		.head {
			gap: 12px;
		}
		.num,
		.detail {
			font-size: 14px;
		}
		.scan {
			max-width: 28ch;
		}
	}
</style>
