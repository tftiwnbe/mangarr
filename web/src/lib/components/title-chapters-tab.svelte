<script lang="ts">
	import { BookIcon, CheckIcon, DownloadIcon, SpinnerIcon, XIcon } from 'phosphor-svelte';

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
		progressActionChapterId = null
	}: Props = $props();

	function formatDate(value?: number | null): string {
		if (!value) return '';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		return date.toLocaleDateString();
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

	function chapterDownloadState(chapter: ChapterRow): string | null {
		if (chapter.downloadStatus === 'downloaded') return $_('chapter.downloaded');
		if (chapter.downloadStatus === 'downloading') return $_('chapter.downloading');
		if (chapter.downloadStatus === 'queued') return $_('downloads.queued');
		if (chapter.downloadStatus === 'failed') return $_('downloads.failed');
		return null;
	}

	function chapterReadState(chapter: ChapterRow): string | null {
		if (!chapter.isRead) return null;
		return $_('title.markAsRead');
	}
</script>

{#if titleChapters.length === 0}
	<div class="flex flex-col items-center gap-3 py-16">
		<BookIcon size={28} class="text-[var(--void-5)]" />
		<p class="text-sm text-[var(--text-ghost)]">{chapterHydrationHeadline}</p>
		<p class="text-xs text-[var(--text-dim)]">{chapterHydrationDescription}</p>
		{#if chapterHydrationStatus === 'failed'}
			<Button variant="outline" size="sm" onclick={onRetryHydration}>
				{$_('common.retry')}
			</Button>
		{/if}
	</div>
{:else}
	<div class="flex flex-col">
		{#each titleChapters as chapter (chapter._id)}
			{@const detail = chapterDetail(chapter)}
			{@const downloadState = chapterDownloadState(chapter)}
			{@const readState = chapterReadState(chapter)}
			<div
				class="flex items-center gap-4 py-3 {chapter.isRead ? 'opacity-80' : ''}"
				data-testid="chapter-row"
				data-chapter-id={chapter._id}
				data-download-status={chapter.downloadStatus}
				data-read={chapter.isRead ? 'true' : 'false'}
			>
				<div class="min-w-0 flex-1">
					<button
						type="button"
						data-testid="chapter-open"
						class="flex w-full items-baseline gap-2 text-left"
						onclick={() => onOpenChapter(chapter)}
					>
						<span class="shrink-0 text-sm text-[var(--text)]">{chapterLabel(chapter)}</span>
						{#if detail}
							<span class="truncate text-sm text-[var(--text-muted)]">{detail}</span>
						{/if}
					</button>
					<div class="mt-1 flex items-center gap-2 text-[11px] text-[var(--text-ghost)]">
						{#if chapter.dateUpload}
							<span>{formatDate(chapter.dateUpload)}</span>
						{/if}
						{#if chapter.scanlator}
							<span class="text-[var(--void-5)]">·</span>
							<span class="truncate">{chapter.scanlator}</span>
						{/if}
						{#if downloadState}
							<span class="text-[var(--void-5)]">·</span>
							<span>{downloadState}</span>
						{/if}
						{#if readState}
							<span class="text-[var(--void-5)]">·</span>
							<span>{readState}</span>
						{/if}
					</div>
					{#if chapter.lastErrorMessage}
						<p class="mt-1 text-[11px] text-[var(--error)]">{chapter.lastErrorMessage}</p>
					{/if}
				</div>
				<div class="flex shrink-0 items-center gap-2">
					{#if chapter.isRead}
						<Button
							variant="ghost"
							size="sm"
							title={$_('title.markAsUnread')}
							aria-label={$_('title.markAsUnread')}
							onclick={() => onResetChapterProgress(chapter._id)}
							disabled={progressActionChapterId === chapter._id}
						>
							<XIcon size={13} />
						</Button>
					{:else}
						<Button
							variant="ghost"
							size="sm"
							title={$_('title.markPreviousRead')}
							aria-label={$_('title.markPreviousRead')}
							disabled={progressActionChapterId === chapter._id}
							onclick={() => onMarkPreviousRead(chapter._id)}
						>
							<CheckIcon size={13} />
						</Button>
					{/if}
					{#if chapter.downloadStatus === 'downloaded'}
						<CheckIcon size={13} class="text-[var(--void-7)]" />
					{:else}
						<Button
							variant="ghost"
							size="sm"
							data-testid="chapter-download"
							onclick={() => onDownloadChapter(chapter._id)}
							disabled={chapter.downloadStatus === 'queued' ||
								chapter.downloadStatus === 'downloading' ||
								downloadingChapterIds.includes(chapter._id)}
						>
							{#if chapter.downloadStatus === 'queued' || chapter.downloadStatus === 'downloading' || downloadingChapterIds.includes(chapter._id)}
								<SpinnerIcon size={12} class="animate-spin" />
							{:else}
								<DownloadIcon size={12} />
							{/if}
						</Button>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}
