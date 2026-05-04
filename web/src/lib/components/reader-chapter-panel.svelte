<script lang="ts">
	import { _ } from '$lib/i18n';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import {
		formatChapterNumberValue,
		hasDisplayableChapterNumber,
		parseStructuredChapterName
	} from '$lib/utils/chapter-display';

	type ChapterItem = {
		_id: string;
		chapterName: string;
		chapterNumber?: number | null;
	};

	type Props = {
		open: boolean;
		onclose: () => void;
		chapters: ChapterItem[];
		currentChapterId: string | null;
		onOpenChapter: (chapter: ChapterItem) => void;
	};

	let { open, onclose, chapters, currentChapterId, onOpenChapter }: Props = $props();

	function chapterListLabel(item: ChapterItem): string {
		if (hasDisplayableChapterNumber(item.chapterNumber)) {
			return $_('chapter.chapterShort', {
				values: { number: formatChapterNumberValue(item.chapterNumber) }
			});
		}
		const parsed = parseStructuredChapterName(item.chapterName);
		if (parsed?.chapterNumber) {
			return $_('chapter.chapterShort', {
				values: { number: parsed.chapterNumber }
			});
		}
		return item.chapterName || $_('reader.chapter');
	}

	function chapterListDetail(item: ChapterItem): string | null {
		const raw = item.chapterName.trim();
		if (!raw) return null;
		if (hasDisplayableChapterNumber(item.chapterNumber)) {
			const formatted = $_('chapter.chapterShort', {
				values: { number: formatChapterNumberValue(item.chapterNumber) }
			});
			if (raw === formatted) return null;
			return raw;
		}
		const parsed = parseStructuredChapterName(raw);
		return parsed?.detail ?? raw;
	}
</script>

<SlidePanel {open} title={$_('reader.chapters')} {onclose}>
	<div class="flex flex-col">
		{#if chapters.length === 0}
			<p class="py-8 text-center text-xs text-[var(--text-ghost)]">{$_('common.noResults')}</p>
		{:else}
			{#each chapters as item (item._id)}
				{@const isCurrent = currentChapterId === item._id}
				<button
					type="button"
					class="flex items-center justify-between gap-3 px-2 py-2.5 text-left text-xs transition-colors {isCurrent
						? 'bg-[var(--void-3)] text-[var(--text)]'
						: 'text-[var(--text-ghost)] hover:bg-[var(--void-2)] hover:text-[var(--text-muted)]'}"
					onclick={() => onOpenChapter(item)}
				>
					<div class="min-w-0 flex-1">
						<p class="truncate">{chapterListLabel(item)}</p>
						{#if chapterListDetail(item)}
							<p class="mt-0.5 truncate text-[11px] text-[var(--text-dim)]">
								{chapterListDetail(item)}
							</p>
						{/if}
					</div>
					{#if item.chapterNumber != null}
						<span class="shrink-0 text-[10px] text-[var(--text-ghost)] tabular-nums">
							{item.chapterNumber}
						</span>
					{/if}
				</button>
			{/each}
		{/if}
	</div>
</SlidePanel>
