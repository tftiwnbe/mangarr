<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import {
		ChatIcon,
		PencilSimpleIcon,
		PlusIcon,
		SortAscendingIcon,
		SpinnerIcon,
		TrashIcon,
		XIcon
	} from 'phosphor-svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import { convexApi } from '$lib/convex/api';
	import { Alert } from '$lib/elements/alert';
	import { Button } from '$lib/elements/button';
	import { ConfirmDialog } from '$lib/elements/confirm-dialog';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { _ } from '$lib/i18n';

	type CommentItem = {
		_id: Id<'chapterComments'>;
		chapterId: Id<'libraryChapters'>;
		pageIndex: number;
		message: string;
		createdAt: number;
		updatedAt: number;
	};

	type Props = {
		open: boolean;
		onclose: () => void;
		comments: CommentItem[];
		loading: boolean;
		chapterId: Id<'libraryChapters'> | null;
		currentPageIndex: number;
		onJumpToPage: (pageIndex: number) => void;
	};

	let { open, onclose, comments, loading, chapterId, currentPageIndex, onJumpToPage }: Props =
		$props();

	const client = useConvexClient();

	let commentsSortMode = $state<'time' | 'page'>('time');
	let commentDraft = $state('');
	let editingCommentId = $state<Id<'chapterComments'> | null>(null);
	let commentSubmitting = $state(false);
	let deleteCommentConfirmId = $state<Id<'chapterComments'> | null>(null);
	let deletingCommentId = $state<Id<'chapterComments'> | null>(null);
	let commentsError = $state<string | null>(null);

	const sortedComments = $derived.by(() => {
		const items = [...comments];
		if (commentsSortMode === 'page') {
			return items.sort((left, right) =>
				left.pageIndex === right.pageIndex
					? right.createdAt - left.createdAt
					: left.pageIndex - right.pageIndex
			);
		}
		return items.sort((left, right) => right.createdAt - left.createdAt);
	});

	$effect(() => {
		void chapterId;
		editingCommentId = null;
		commentDraft = '';
		deleteCommentConfirmId = null;
		deletingCommentId = null;
		commentsError = null;
	});

	function formatTimestamp(timestamp: number): string {
		return new Date(timestamp).toLocaleString();
	}

	function startNewComment() {
		editingCommentId = null;
		commentDraft = '';
	}

	function startEditComment(comment: CommentItem) {
		editingCommentId = comment._id;
		commentDraft = comment.message;
	}

	async function saveComment() {
		if (!chapterId || commentSubmitting) return;
		const message = commentDraft.trim();
		if (!message) {
			commentsError = $_('reader.commentSaveFailed');
			return;
		}

		commentSubmitting = true;
		commentsError = null;
		try {
			if (editingCommentId) {
				await client.mutation(convexApi.library.updateChapterComment, {
					commentId: editingCommentId,
					message
				});
			} else {
				await client.mutation(convexApi.library.createChapterComment, {
					chapterId,
					pageIndex: currentPageIndex,
					message
				});
			}
			startNewComment();
		} catch (error) {
			commentsError = error instanceof Error ? error.message : $_('reader.commentSaveFailed');
		} finally {
			commentSubmitting = false;
		}
	}

	async function removeComment(commentId: Id<'chapterComments'>) {
		if (deletingCommentId) return;
		deletingCommentId = commentId;
		commentsError = null;
		try {
			await client.mutation(convexApi.library.deleteChapterComment, { commentId });
			if (editingCommentId === commentId) {
				startNewComment();
			}
		} catch (error) {
			commentsError = error instanceof Error ? error.message : $_('reader.commentDeleteFailed');
		} finally {
			deletingCommentId = null;
		}
	}
</script>

<SlidePanel {open} title={$_('reader.comments')} {onclose}>
	{#snippet footer()}
		{#if commentsError}
			<Alert variant="error" class="mb-2">{commentsError}</Alert>
		{/if}
		<div
			class="relative border border-[var(--void-3)] bg-[var(--void-2)] focus-within:border-[var(--cosmic-halo)]"
		>
			<div class="flex items-center justify-between border-b border-[var(--void-3)] px-2.5 py-1.5">
				<span class="font-mono text-[10px] tracking-[0.18em] text-[var(--text-ghost)] uppercase">
					{#if editingCommentId}
						<span class="text-[var(--cosmic)]">// edit</span>
					{:else}
						// new entry
					{/if}
				</span>
				<span class="font-mono text-[10px] text-[var(--text-ghost)] tabular-nums">
					p.{currentPageIndex + 1}
				</span>
			</div>
			<textarea
				class="block max-h-[40vh] min-h-[64px] w-full resize-none bg-transparent px-2.5 py-2 font-mono text-[12px] leading-relaxed text-[var(--text)] placeholder:text-[var(--text-ghost)] focus:outline-none"
				placeholder={$_('reader.commentPlaceholder')}
				bind:value={commentDraft}
			></textarea>
			<div
				class="flex items-center justify-between gap-2 border-t border-[var(--void-3)] px-2 py-1.5"
			>
				<span
					class="px-1 font-mono text-[9px] tracking-wider text-[var(--text-dim)] uppercase tabular-nums"
				>
					{commentDraft.length}c
				</span>
				<div class="flex items-center gap-1.5">
					{#if editingCommentId}
						<Button variant="ghost" size="sm" onclick={startNewComment}>
							<XIcon size={11} />
							{$_('common.cancel')}
						</Button>
					{/if}
					<Button
						variant="solid"
						size="sm"
						onclick={saveComment}
						disabled={commentSubmitting || !commentDraft.trim()}
					>
						{#if commentSubmitting}
							<SpinnerIcon size={11} class="animate-spin" />
						{:else}
							<PlusIcon size={11} />
						{/if}
						{$_('reader.comment')}
					</Button>
				</div>
			</div>
		</div>
	{/snippet}

	<div class="flex flex-col gap-3 pt-1">
		<div class="flex items-center gap-2 border-b border-[var(--void-3)] pb-2">
			<span class="h-1 w-1 bg-[var(--cosmic)] shadow-[0_0_4px_var(--cosmic-glow)]"></span>
			<span class="font-mono text-[10px] tracking-[0.22em] text-[var(--text-ghost)] uppercase">
				log
			</span>
			<span class="font-mono text-[10px] text-[var(--text-dim)] tabular-nums">
				{sortedComments.length}
			</span>
			<span class="h-px flex-1 bg-[var(--void-3)]"></span>
			<button
				type="button"
				class="flex items-center gap-1 font-mono text-[10px] tracking-[0.16em] text-[var(--text-ghost)] uppercase transition-colors hover:text-[var(--cosmic)]"
				onclick={() => (commentsSortMode = commentsSortMode === 'time' ? 'page' : 'time')}
			>
				<SortAscendingIcon size={10} />
				{commentsSortMode === 'time' ? 'time' : 'page'}
			</button>
		</div>

		{#if loading}
			<div class="flex items-center justify-center py-10">
				<SpinnerIcon size={16} class="animate-spin text-[var(--text-ghost)]" />
			</div>
		{:else if sortedComments.length === 0}
			<div class="flex flex-col items-center gap-1.5 py-10 text-center">
				<ChatIcon size={20} class="text-[var(--void-6)]" />
				<p class="font-mono text-[10px] tracking-[0.16em] text-[var(--text-ghost)] uppercase">
					{$_('reader.noComments')}
				</p>
			</div>
		{:else}
			<ul class="flex flex-col">
				{#each sortedComments as comment (comment._id)}
					{@const isEditingThis = editingCommentId === comment._id}
					<li
						class="group relative flex flex-col gap-1.5 border-l-2 py-2.5 pr-1 pl-3 transition-colors {isEditingThis
							? 'border-[var(--cosmic)] bg-[var(--cosmic-soft)]'
							: 'border-[var(--void-3)] hover:border-[var(--void-6)] hover:bg-[var(--void-2)]'}"
					>
						<div class="flex items-center gap-2 font-mono text-[10px] text-[var(--text-ghost)]">
							<button
								type="button"
								class="border border-[var(--void-4)] px-1.5 py-px tabular-nums transition-colors hover:border-[var(--cosmic-halo)] hover:text-[var(--cosmic)]"
								onclick={() => onJumpToPage(comment.pageIndex)}
								title={$_('reader.page') + ' ' + (comment.pageIndex + 1)}
							>
								p.{comment.pageIndex + 1}
							</button>
							<span class="ml-auto text-[var(--text-dim)]">
								{formatTimestamp(comment.createdAt)}
							</span>
						</div>
						<p class="text-[12px] leading-relaxed whitespace-pre-wrap text-[var(--text-soft)]">
							{comment.message}
						</p>
						<div
							class="flex items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100"
						>
							<button
								type="button"
								class="flex items-center gap-1 font-mono text-[10px] tracking-wider text-[var(--text-ghost)] uppercase transition-colors hover:text-[var(--text)]"
								onclick={() => startEditComment(comment)}
							>
								<PencilSimpleIcon size={10} />
								{$_('common.edit')}
							</button>
							<span class="text-[var(--void-5)]">·</span>
							<button
								type="button"
								class="flex items-center gap-1 font-mono text-[10px] tracking-wider text-[var(--text-ghost)] uppercase transition-colors hover:text-[var(--error)]"
								onclick={() => (deleteCommentConfirmId = comment._id)}
								disabled={deletingCommentId === comment._id}
							>
								<TrashIcon size={10} />
								{$_('common.delete')}
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</SlidePanel>

<ConfirmDialog
	open={deleteCommentConfirmId !== null}
	title="Delete comment"
	description="This will permanently delete this comment."
	confirmLabel="delete"
	variant="danger"
	loading={deletingCommentId !== null}
	onConfirm={async () => {
		if (deleteCommentConfirmId) {
			await removeComment(deleteCommentConfirmId);
			deleteCommentConfirmId = null;
		}
	}}
	onCancel={() => (deleteCommentConfirmId = null)}
/>
