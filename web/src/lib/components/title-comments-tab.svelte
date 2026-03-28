<script lang="ts">
	import { SpinnerIcon } from 'phosphor-svelte';

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
	<div class="flex items-center justify-center gap-2 py-6 text-sm text-[var(--text-ghost)]">
		<SpinnerIcon size={16} class="animate-spin" />
		<span>{$_('common.loading')}</span>
	</div>
{:else if titleComments.length === 0}
	<p class="py-6 text-center text-sm text-[var(--text-ghost)]">{$_('title.noComments')}</p>
{:else}
	<div class="flex flex-col gap-4">
		{#each titleComments as comment (comment._id)}
			<div class="flex flex-col gap-1.5 py-2">
				<div class="flex items-center justify-between gap-4 text-[10px] text-[var(--text-ghost)]">
					<span class="truncate">
						{comment.chapterName}
						{#if comment.chapterNumber != null}
							· {$_('reader.page')} {comment.pageIndex + 1}
						{/if}
					</span>
					<span class="shrink-0">{formatTimestamp(comment.createdAt)}</span>
				</div>
				<p class="text-sm whitespace-pre-wrap text-[var(--text-soft)]">{comment.message}</p>
			</div>
		{/each}
	</div>
{/if}
