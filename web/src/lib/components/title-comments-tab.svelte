<script lang="ts">
	import { ChatIcon, SpinnerIcon } from 'phosphor-svelte';

	import { _ } from '$lib/i18n';

	type TitleComment = {
		_id: string;
		chapterName: string;
		chapterNumber?: number | null;
		pageIndex: number;
		message: string;
		createdAt: number;
	};

	type Props = {
		loading: boolean;
		titleComments: TitleComment[];
	};

	let { loading, titleComments }: Props = $props();

	function formatTimestamp(value: number): string {
		return new Date(value).toLocaleString();
	}
</script>

{#if loading}
	<div
		class="flex items-center justify-center gap-2 py-10 font-mono text-[10px] tracking-[0.16em] text-[var(--text-ghost)] uppercase"
	>
		<SpinnerIcon size={14} class="animate-spin" />
		<span>{$_('common.loading')}</span>
	</div>
{:else if titleComments.length === 0}
	<div class="flex flex-col items-center gap-1.5 py-12 text-center">
		<ChatIcon size={20} class="text-[var(--void-6)]" />
		<p class="font-mono text-[10px] tracking-[0.18em] text-[var(--text-ghost)] uppercase">
			{$_('title.noComments')}
		</p>
	</div>
{:else}
	<div class="flex items-baseline gap-2 border-b border-[var(--void-3)] pb-2">
		<span
			class="h-1 w-1 translate-y-[-1px] bg-[var(--cosmic)] shadow-[0_0_4px_var(--cosmic-glow)]"
		></span>
		<span class="font-mono text-[10px] tracking-[0.22em] text-[var(--text-ghost)] uppercase">
			log
		</span>
		<span class="font-mono text-[10px] text-[var(--text-dim)] tabular-nums">
			{titleComments.length}
		</span>
	</div>
	<ul class="flex flex-col">
		{#each titleComments as comment (comment._id)}
			<li
				class="group flex flex-col gap-1.5 border-l-2 border-[var(--void-3)] py-2.5 pr-1 pl-3 transition-colors hover:border-[var(--void-6)] hover:bg-[var(--void-2)]"
			>
				<div class="flex items-center gap-2 font-mono text-[10px] text-[var(--text-ghost)]">
					<span
						class="border border-[var(--void-4)] px-1.5 py-px tabular-nums"
						title={comment.chapterName}
					>
						{#if comment.chapterNumber != null}
							ch.{comment.chapterNumber}·p.{comment.pageIndex + 1}
						{:else}
							p.{comment.pageIndex + 1}
						{/if}
					</span>
					<span class="truncate text-[var(--text-dim)]">{comment.chapterName}</span>
					<span class="ml-auto shrink-0 text-[var(--text-dim)]">
						{formatTimestamp(comment.createdAt)}
					</span>
				</div>
				<p class="text-[12px] leading-relaxed whitespace-pre-wrap text-[var(--text-soft)]">
					{comment.message}
				</p>
			</li>
		{/each}
	</ul>
{/if}
