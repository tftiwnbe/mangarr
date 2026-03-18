<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import {
		ArrowsInIcon,
		ArrowsOutIcon,
		CaretLeftIcon,
		CaretRightIcon,
		ChatIcon,
		ClockIcon,
		FileIcon,
		ListIcon,
		PlusIcon,
		SkipBackIcon,
		SkipForwardIcon,
		SpinnerIcon,
		WarningCircleIcon
	} from 'phosphor-svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import { convexApi } from '$lib/convex/api';
	import { Button } from '$lib/elements/button';
	import { ConfirmDialog } from '$lib/elements/confirm-dialog';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { _ } from '$lib/i18n';
	import { navigateBack } from '$lib/stores/nav-history';
	import { panelOverlayOpen } from '$lib/stores/ui';
	import { getReaderProgress, setReaderProgress } from '$lib/utils/reader-progress';
	import { buildReaderPath, buildTitlePath } from '$lib/utils/routes';

	const { data } = $props<{ data: { titleId: string | null; chapterId: string | null } }>();

	type ReaderMode = 'vertical' | 'horizontal';

	type ChapterItem = {
		_id: Id<'libraryChapters'>;
		libraryTitleId: Id<'libraryTitles'>;
		chapterName: string;
		chapterNumber?: number | null;
		chapterUrl: string;
		sourceId: string;
		sourceLang: string;
		downloadStatus: 'missing' | 'queued' | 'downloading' | 'downloaded' | 'failed';
		totalPages?: number | null;
		localRelativePath?: string | null;
		storageKind?: 'directory' | 'archive' | null;
		dateUpload?: number | null;
		scanlator?: string | null;
		sequence: number;
	};

	type ReaderTitle = {
		_id: Id<'libraryTitles'>;
		title: string;
		sourceId: string;
		sourceLang: string;
	};

	type ReaderProgress = {
		id: string;
		pageIndex: number;
		updatedAt: number;
	} | null;

	type ReaderQuery = {
		title: ReaderTitle;
		chapter: ChapterItem;
		chapters: ChapterItem[];
		progress: ReaderProgress;
	} | null;

	type RemotePage = {
		index: number;
		url?: string;
		imageUrl?: string;
	};

	type CommandItem = {
		id: string;
		commandType: string;
		status: string;
		payload?: Record<string, unknown> | null;
		result?: Record<string, unknown> | null;
		lastErrorMessage?: string | null;
	};

	type CommentItem = {
		_id: Id<'chapterComments'>;
		chapterId: Id<'libraryChapters'>;
		pageIndex: number;
		message: string;
		createdAt: number;
		updatedAt: number;
	};

	type ReaderPage =
		| { id: string; pageIndex: number; kind: 'remote'; index: number }
		| { id: string; pageIndex: number; kind: 'local'; index: number };

	const readerBackSkipPrefixes = ['/reader/'];

	const client = useConvexClient();
	const readerQuery = useQuery(
		convexApi.library.getReaderByChapterId,
		() => (data.chapterId ? { chapterId: data.chapterId as Id<'libraryChapters'> } : 'skip')
	);
	const commandsQuery = useQuery(convexApi.commands.listMine, () => ({ limit: 100 }));
	const commentsQuery = useQuery(
		convexApi.library.listChapterComments,
		() => (data.chapterId ? { chapterId: data.chapterId as Id<'libraryChapters'> } : 'skip')
	);

	let mode = $state<ReaderMode>('vertical');
	let currentPageIndex = $state(0);
	let showChapterPanel = $state(false);
	let showCommentsPanel = $state(false);
	let commentsSortMode = $state<'time' | 'page'>('time');
	let commentDraft = $state('');
	let editingCommentId = $state<Id<'chapterComments'> | null>(null);
	let commentSubmitting = $state(false);
	let deleteCommentConfirmId = $state<Id<'chapterComments'> | null>(null);
	let deletingCommentId = $state<Id<'chapterComments'> | null>(null);
	let commentsError = $state<string | null>(null);
	let bookmarkError = $state<string | null>(null);
	let isTouchDevice = $state(false);
	let readerHeaderVisible = $state(true);
	let isPointerInHeader = $state(false);
	let showTopZone = $state(false);
	let isReaderAtTop = $state(true);
	let loadedPageIds = new SvelteSet<string>();
	let paintedPageIds = new SvelteSet<string>();
	let fetchRequested = $state(false);
	let initializedProgress = $state(false);
	let progressSaveTimer = $state<ReturnType<typeof setTimeout> | null>(null);
	let lastChapterId = $state<string | null>(null);

	const readerData = $derived((readerQuery.data as ReaderQuery) ?? null);
	const title = $derived(readerData?.title ?? null);
	const chapter = $derived(readerData?.chapter ?? null);
	const currentChapterId = $derived(chapter?._id ?? null);
	const chapters = $derived(readerData?.chapters ?? []);
	const commands = $derived((commandsQuery.data ?? []) as CommandItem[]);
	const comments = $derived((commentsQuery.data ?? []) as CommentItem[]);
	const loadError = $derived(
		readerQuery.error instanceof Error ? readerQuery.error.message : null
	);

	const pageParamIndex = $derived.by(() => {
		const raw = page.url.searchParams.get('page');
		if (!raw) return null;
		const parsed = Number(raw);
		return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
	});

	const remotePagesResult = $derived.by(() => {
		if (!chapter) return null;
		for (const item of commands) {
			if (item.commandType !== 'reader.pages.fetch') continue;
			const payload = item.payload ?? {};
			if (
				String(payload.sourceId ?? '') !== chapter.sourceId ||
				String(payload.chapterUrl ?? '') !== chapter.chapterUrl
			) {
				continue;
			}
			return item;
		}
		return null;
	});

	const remotePages = $derived.by(() =>
		((remotePagesResult?.result?.pages as RemotePage[] | undefined) ?? []).sort(
			(left, right) => left.index - right.index
		)
	);
	const isPagesLoading = $derived.by(() => {
		if (!chapter) return false;
		if (
			chapter.downloadStatus === 'downloaded' &&
			chapter.localRelativePath &&
			chapter.storageKind &&
			typeof chapter.totalPages === 'number' &&
			chapter.totalPages > 0
		) {
			return false;
		}
		return (
			pages.length === 0 &&
			(fetchRequested ||
				remotePagesResult === null ||
				remotePagesResult?.status === 'queued' ||
				remotePagesResult?.status === 'running')
		);
	});

	const pages = $derived.by(() => {
		if (!chapter) return [] as ReaderPage[];
		if (
			chapter.downloadStatus === 'downloaded' &&
			chapter.localRelativePath &&
			chapter.storageKind &&
			typeof chapter.totalPages === 'number' &&
			chapter.totalPages > 0
		) {
			return Array.from({ length: chapter.totalPages }, (_, index) => ({
				id: `local:${chapter._id}:${index}`,
				pageIndex: index,
				kind: 'local' as const,
				index
			}));
		}
		return remotePages.map((item) => ({
			id: `remote:${chapter._id}:${item.index}`,
			pageIndex: item.index,
			kind: 'remote' as const,
			index: item.index
		}));
	});

	const currentPage = $derived(pages[currentPageIndex] ?? null);
	const prevChapterId = $derived.by(() => {
		if (!currentChapterId || chapters.length === 0) return null;
		const index = chapters.findIndex((item) => item._id === currentChapterId);
		if (index <= 0) return null;
		return chapters[index - 1]?._id ?? null;
	});
	const nextChapterId = $derived.by(() => {
		if (!currentChapterId || chapters.length === 0) return null;
		const index = chapters.findIndex((item) => item._id === currentChapterId);
		if (index < 0 || index >= chapters.length - 1) return null;
		return chapters[index + 1]?._id ?? null;
	});
	const canonicalTitlePath = $derived.by(() =>
		title ? buildTitlePath(title._id, title.title) : '/library'
	);
	const sortedComments = $derived.by(() => {
		const rows = [...comments];
		if (commentsSortMode === 'page') {
			rows.sort((left, right) => {
				if (left.pageIndex !== right.pageIndex) return left.pageIndex - right.pageIndex;
				return right.createdAt - left.createdAt;
			});
			return rows;
		}
		rows.sort((left, right) => right.createdAt - left.createdAt);
		return rows;
	});

	function resolvePageUrl(item: ReaderPage): string {
		if (!chapter) return '';
		if (item.kind === 'local' && chapter.localRelativePath && chapter.storageKind) {
			const params = new URLSearchParams({
				path: chapter.localRelativePath,
				storage: chapter.storageKind,
				index: String(item.index)
			});
			return `/api/internal/bridge/library/page?${params.toString()}`;
		}

		const params = new URLSearchParams({
			sourceId: chapter.sourceId,
			chapterUrl: chapter.chapterUrl,
			index: String(item.index)
		});
		return `/api/internal/bridge/reader/page?${params.toString()}`;
	}

	function markPageLoaded(id: string) {
		loadedPageIds.add(id);
	}

	function markPagePainted(id: string) {
		paintedPageIds.add(id);
	}

	function jumpToPage(pageIndex: number) {
		const targetIndex = pages.findIndex((item) => item.pageIndex === pageIndex);
		if (targetIndex < 0) return;
		currentPageIndex = targetIndex;
		if (mode === 'vertical') {
			const node = document.querySelector(
				`[data-reader-page-index="${pageIndex}"]`
			) as HTMLElement | null;
			node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}

	function openChapter(chapterId: Id<'libraryChapters'> | null) {
		if (!title || !chapterId) return;
		showChapterPanel = false;
		showCommentsPanel = false;
		void goto(buildReaderPath({ titleId: title._id, chapterId }));
	}

	function prevPage() {
		if (currentPageIndex > 0) currentPageIndex -= 1;
	}

	function nextPage() {
		if (currentPageIndex < pages.length - 1) currentPageIndex += 1;
	}

	function formatTimestamp(timestamp: number): string {
		return new Date(timestamp).toLocaleString();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (mode !== 'horizontal') return;
		if (event.target instanceof HTMLElement) {
			const tag = event.target.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
		}
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			prevPage();
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			nextPage();
		}
	}

	function syncReaderHeaderVisibility() {
		if (isTouchDevice) {
			readerHeaderVisible = isReaderAtTop;
			return;
		}
		readerHeaderVisible = isReaderAtTop || showTopZone || isPointerInHeader;
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
		if (!chapter || commentSubmitting) return;
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
					chapterId: chapter._id,
					pageIndex: currentPage?.pageIndex ?? 0,
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

	$effect(() => {
		panelOverlayOpen.set(showChapterPanel || showCommentsPanel);
		return () => panelOverlayOpen.set(false);
	});

	$effect(() => {
		if (!chapter || fetchRequested) return;
		if (chapter.downloadStatus === 'downloaded' && chapter.totalPages) return;
		if (remotePagesResult?.status === 'running' || remotePagesResult?.status === 'queued') return;
		if (remotePages.length > 0) return;
		fetchRequested = true;
		void client
			.mutation(convexApi.commands.enqueue, {
				commandType: 'reader.pages.fetch',
				payload: {
					sourceId: chapter.sourceId,
					chapterUrl: chapter.chapterUrl
				}
			})
			.catch(() => {
				fetchRequested = false;
			});
	});

	$effect(() => {
		if (!chapter || pages.length === 0 || initializedProgress) return;
		const requested = pageParamIndex;
		const serverPage = readerData?.progress?.pageIndex ?? null;
		const localPage = getReaderProgress(chapter._id) ?? null;
		const preferredPage = requested ?? serverPage ?? localPage ?? 0;
		const preferredIndex = pages.findIndex((item) => item.pageIndex === preferredPage);
		currentPageIndex = preferredIndex >= 0 ? preferredIndex : 0;
		initializedProgress = true;
	});

	$effect(() => {
		if (currentChapterId === null) {
			lastChapterId = null;
			fetchRequested = false;
			initializedProgress = false;
			currentPageIndex = 0;
			loadedPageIds.clear();
			paintedPageIds.clear();
			return;
		}

		if (lastChapterId !== currentChapterId) {
			lastChapterId = currentChapterId;
			fetchRequested = false;
			initializedProgress = false;
			currentPageIndex = 0;
			loadedPageIds.clear();
			paintedPageIds.clear();
		}
	});

	$effect(() => {
		if (!chapter || !pages[currentPageIndex]) return;
		if (progressSaveTimer) {
			clearTimeout(progressSaveTimer);
		}
		const pageIndex = pages[currentPageIndex].pageIndex;
		setReaderProgress(chapter._id, pageIndex);
		progressSaveTimer = setTimeout(() => {
			void client.mutation(convexApi.library.upsertChapterProgress, {
				chapterId: chapter._id,
				pageIndex
			});
		}, 300);

		return () => {
			if (progressSaveTimer) {
				clearTimeout(progressSaveTimer);
			}
		};
	});

	onMount(() => {
		document.documentElement.classList.add('reader-mode');
		document.body.classList.add('reader-mode');

		const media = window.matchMedia('(hover: hover) and (pointer: fine)');
		const syncTouch = () => {
			isTouchDevice = !media.matches;
			syncReaderHeaderVisibility();
		};
		const syncScroll = () => {
			isReaderAtTop = window.scrollY <= 8;
			syncReaderHeaderVisibility();
			if (mode !== 'vertical') return;
			const nodes = document.querySelectorAll<HTMLElement>('[data-reader-page-index]');
			let bestIndex = currentPageIndex;
			let bestDistance = Number.POSITIVE_INFINITY;
			for (const node of nodes) {
				const rect = node.getBoundingClientRect();
				if (rect.bottom < 40 || rect.top > window.innerHeight) continue;
				const pageIndex = Number(node.dataset.readerPageIndex ?? '-1');
				if (!Number.isInteger(pageIndex)) continue;
				const distance = Math.abs(rect.top - 40);
				if (distance < bestDistance) {
					bestDistance = distance;
					bestIndex = pages.findIndex((item) => item.pageIndex === pageIndex);
				}
			}
			if (bestIndex >= 0 && bestIndex !== currentPageIndex) {
				currentPageIndex = bestIndex;
			}
		};

		syncTouch();
		syncScroll();
		media.addEventListener('change', syncTouch);
		window.addEventListener('scroll', syncScroll, { passive: true });
		return () => {
			document.documentElement.classList.remove('reader-mode');
			document.body.classList.remove('reader-mode');
			media.removeEventListener('change', syncTouch);
			window.removeEventListener('scroll', syncScroll);
			if (progressSaveTimer) clearTimeout(progressSaveTimer);
		};
	});
</script>

<svelte:head>
	<title>{$_('reader.title')} | {$_('app.name')}</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="relative min-h-svh overscroll-none bg-[var(--void-0)]">
	{#if pages.length > 0}
		<div class="fixed inset-x-0 top-0 z-50 h-0.5 bg-[var(--void-2)]">
			<div
				class="h-full bg-[var(--void-7)] transition-[width] duration-150"
				style={`width: ${((currentPageIndex + 1) / pages.length) * 100}%`}
			></div>
		</div>
	{/if}

	{#if !isTouchDevice}
		<div
			class="fixed inset-x-0 top-0 z-30 h-10"
			role="presentation"
			aria-hidden="true"
			onmouseenter={() => {
				showTopZone = true;
				syncReaderHeaderVisibility();
			}}
			onmouseleave={() => {
				showTopZone = false;
				syncReaderHeaderVisibility();
			}}
		></div>
	{/if}

	<div
		class="fixed inset-x-0 top-0 z-40 bg-[var(--void-0)]/90 backdrop-blur-sm transition-transform duration-200 {readerHeaderVisible
			? 'translate-y-0'
			: 'pointer-events-none -translate-y-full'}"
		role="banner"
		onmouseenter={() => {
			isPointerInHeader = true;
			syncReaderHeaderVisibility();
		}}
		onmouseleave={() => {
			isPointerInHeader = false;
			syncReaderHeaderVisibility();
		}}
	>
		<div class="flex h-10 items-center justify-between px-2">
			<div class="flex min-w-0 flex-1 items-center gap-1.5">
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={() =>
						void navigateBack(canonicalTitlePath, { skipPrefixes: readerBackSkipPrefixes })}
				>
					<CaretLeftIcon size={18} />
				</Button>
				<a
					href={canonicalTitlePath}
					class="truncate text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
				>
					{title?.title || $_('reader.title')}
				</a>
			</div>

			{#if pages.length > 0}
				<div class="mx-2 hidden items-center gap-0.5 md:flex">
					<Button variant="ghost" size="icon-sm" onclick={() => openChapter(prevChapterId)} disabled={!prevChapterId}>
						<SkipBackIcon size={16} />
					</Button>
					<Button variant="ghost" size="icon-sm" onclick={() => (showChapterPanel = true)}>
						<ListIcon size={16} />
					</Button>
					<Button variant="ghost" size="icon-sm" onclick={() => (showCommentsPanel = true)}>
						<ChatIcon size={16} />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						onclick={() => (mode = mode === 'vertical' ? 'horizontal' : 'vertical')}
					>
						{#if mode === 'vertical'}<ArrowsOutIcon size={16} />{:else}<ArrowsInIcon size={16} />{/if}
					</Button>
					<Button variant="ghost" size="icon-sm" onclick={() => openChapter(nextChapterId)} disabled={!nextChapterId}>
						<SkipForwardIcon size={16} />
					</Button>
				</div>
			{/if}

			<div class="flex shrink-0 items-center gap-0.5">
				{#if pages.length > 0}
					<span class="pr-1 text-[11px] text-[var(--text-ghost)] tabular-nums">
						{currentPageIndex + 1}/{pages.length}
					</span>
				{/if}
			</div>
		</div>
	</div>

	{#if readerQuery.isLoading}
		<div class="flex min-h-svh items-center justify-center">
			<SpinnerIcon size={20} class="animate-spin text-[var(--text-ghost)]" />
		</div>
	{:else if loadError}
		<div class="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
			<WarningCircleIcon size={24} class="text-[var(--text-ghost)]" />
			<div>
				<p class="text-sm text-[var(--text-muted)]">{$_('reader.failed')}</p>
				<p class="mt-1 text-xs text-[var(--text-ghost)]">{loadError}</p>
			</div>
		</div>
	{:else if chapter && remotePagesResult?.status === 'failed' && pages.length === 0}
		<div class="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
			<WarningCircleIcon size={24} class="text-[var(--text-ghost)]" />
			<div>
				<p class="text-sm text-[var(--text-muted)]">{$_('reader.failed')}</p>
				<p class="mt-1 text-xs text-[var(--text-ghost)]">
					{remotePagesResult?.lastErrorMessage || $_('reader.noPages')}
				</p>
			</div>
		</div>
	{:else if chapter && isPagesLoading}
		<div class="flex min-h-svh items-center justify-center">
			<SpinnerIcon size={20} class="animate-spin text-[var(--text-ghost)]" />
		</div>
	{:else if !chapter || pages.length === 0}
		<div class="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
			<FileIcon size={24} class="text-[var(--text-ghost)]" />
			<p class="text-sm text-[var(--text-muted)]">{$_('reader.noPages')}</p>
		</div>
	{:else}
		{#if mode === 'vertical'}
			<div class="flex flex-col pt-10 md:mx-auto md:max-w-3xl">
				{#each pages as readerPage (readerPage.id)}
					<div data-reader-page-index={readerPage.pageIndex} class="relative">
						{#if !paintedPageIds.has(readerPage.id)}
							<div class="aspect-[2/3] w-full bg-[var(--void-1)]"></div>
						{/if}
						<img
							src={resolvePageUrl(readerPage)}
							alt="{$_('reader.page')} {readerPage.pageIndex + 1}"
							decoding="async"
							class="bg-[var(--void-1)] object-contain {paintedPageIds.has(readerPage.id)
								? 'w-full'
								: 'absolute inset-0 opacity-0'}"
							onload={() => {
								markPageLoaded(readerPage.id);
								markPagePainted(readerPage.id);
							}}
						/>
					</div>
				{/each}
			</div>
		{:else if currentPage}
			<div class="relative flex min-h-svh items-center justify-center md:px-8">
				<img
					src={resolvePageUrl(currentPage)}
					alt="{$_('reader.page')} {currentPage.pageIndex + 1}"
					class="max-h-svh w-auto max-w-full bg-[var(--void-1)] object-contain"
				/>
				{#if isTouchDevice}
					<button type="button" class="absolute inset-y-0 left-0 z-20 w-1/3" aria-label={$_('reader.prevPage')} onclick={prevPage}></button>
					<button type="button" class="absolute inset-y-0 right-0 z-20 w-1/3" aria-label={$_('reader.nextPage')} onclick={nextPage}></button>
				{/if}
			</div>
		{/if}

		<div class="flex flex-col items-center gap-6 px-6 py-16">
			{#if chapter?.chapterName}
				<p class="text-xs text-[var(--text-ghost)]">{chapter.chapterName}</p>
			{/if}
			<div class="flex items-center gap-3">
				{#if prevChapterId}
					<Button variant="outline" size="sm" onclick={() => openChapter(prevChapterId)}>
						<CaretLeftIcon size={14} />
						{$_('reader.prevChapter')}
					</Button>
				{/if}
				{#if nextChapterId}
					<Button variant="outline" size="sm" onclick={() => openChapter(nextChapterId)}>
						{$_('reader.nextChapter')}
						<CaretRightIcon size={14} />
					</Button>
				{/if}
			</div>
			{#if bookmarkError}
				<p class="text-xs text-[var(--error)]">{bookmarkError}</p>
			{/if}
		</div>
	{/if}

	{#if pages.length > 0}
		<div
			class="fixed inset-x-0 bottom-0 z-40 bg-[var(--void-0)]/90 backdrop-blur-sm transition-transform duration-200 md:hidden {readerHeaderVisible
				? 'translate-y-0'
				: 'pointer-events-none translate-y-full'}"
		>
			<div class="flex h-11 items-center justify-between px-2">
				<Button variant="ghost" size="icon-sm" onclick={() => openChapter(prevChapterId)} disabled={!prevChapterId}>
					<SkipBackIcon size={16} />
				</Button>
				<div class="flex items-center gap-1">
					<Button variant="ghost" size="icon-sm" onclick={() => (showChapterPanel = true)}>
						<ListIcon size={16} />
					</Button>
					<Button variant="ghost" size="icon-sm" onclick={() => (showCommentsPanel = true)}>
						<ChatIcon size={16} />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						onclick={() => (mode = mode === 'vertical' ? 'horizontal' : 'vertical')}
					>
						{#if mode === 'vertical'}<ArrowsOutIcon size={16} />{:else}<ArrowsInIcon size={16} />{/if}
					</Button>
				</div>
				<Button variant="ghost" size="icon-sm" onclick={() => openChapter(nextChapterId)} disabled={!nextChapterId}>
					<SkipForwardIcon size={16} />
				</Button>
			</div>
		</div>
	{/if}
</div>

<SlidePanel open={showChapterPanel} title={$_('reader.chapters')} onclose={() => (showChapterPanel = false)}>
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
					onclick={() => openChapter(item._id)}
				>
					<p class="min-w-0 flex-1 truncate">{item.chapterName}</p>
					{#if item.chapterNumber != null}
						<span class="shrink-0 text-[10px] text-[var(--text-ghost)] tabular-nums">{item.chapterNumber}</span>
					{/if}
				</button>
			{/each}
		{/if}
	</div>
</SlidePanel>

<SlidePanel open={showCommentsPanel} title={$_('reader.comments')} onclose={() => (showCommentsPanel = false)}>
	<div class="flex flex-col gap-4">
		<div class="flex flex-col gap-2">
			<textarea
				class="min-h-20 w-full bg-[var(--void-2)] px-3 py-2 text-xs text-[var(--text)] placeholder:text-[var(--text-ghost)] focus:outline-none"
				placeholder={$_('reader.commentPlaceholder')}
				bind:value={commentDraft}
			></textarea>
			<div class="flex items-center justify-between">
				<p class="text-[10px] text-[var(--text-ghost)]">
					{$_('reader.commentAutoPage', { values: { page: (currentPage?.pageIndex ?? 0) + 1 } })}
				</p>
				<div class="flex items-center gap-1.5">
					{#if editingCommentId}
						<Button variant="ghost" size="sm" onclick={startNewComment}>{$_('common.cancel')}</Button>
					{/if}
					<Button variant="ghost" size="sm" onclick={saveComment} disabled={commentSubmitting}>
						{#if commentSubmitting}
							<SpinnerIcon size={12} class="animate-spin" />
						{:else}
							<PlusIcon size={12} />
						{/if}
						{$_('reader.comment')}
					</Button>
				</div>
			</div>
		</div>

		{#if commentsError}
			<p class="text-xs text-[var(--error)]">{commentsError}</p>
		{/if}

		<button
			type="button"
			class="flex items-center gap-1.5 text-[10px] text-[var(--text-ghost)] transition-colors hover:text-[var(--text-muted)]"
			onclick={() => (commentsSortMode = commentsSortMode === 'time' ? 'page' : 'time')}
		>
			<ClockIcon size={12} />
			{commentsSortMode === 'time' ? $_('reader.sortByTime') : $_('reader.sortByPage')}
		</button>

		{#if commentsQuery.isLoading}
			<div class="flex items-center justify-center py-8">
				<SpinnerIcon size={16} class="animate-spin text-[var(--text-ghost)]" />
			</div>
		{:else if sortedComments.length === 0}
			<p class="py-8 text-center text-xs text-[var(--text-ghost)]">{$_('reader.noComments')}</p>
		{:else}
			<div class="flex flex-col gap-3">
				{#each sortedComments as comment (comment._id)}
					<div class="flex flex-col gap-1.5">
						<div class="flex items-center justify-between text-[10px] text-[var(--text-ghost)]">
							<button
								type="button"
								class="transition-colors hover:text-[var(--text-muted)]"
								onclick={() => jumpToPage(comment.pageIndex)}
							>
								p.{comment.pageIndex + 1}
							</button>
							<span>{formatTimestamp(comment.createdAt)}</span>
						</div>
						<p class="text-xs whitespace-pre-wrap text-[var(--text-soft)]">{comment.message}</p>
						<div class="flex items-center gap-2 text-[10px] text-[var(--text-ghost)]">
							<button type="button" class="transition-colors hover:text-[var(--text-muted)]" onclick={() => startEditComment(comment)}>
								{$_('common.edit')}
							</button>
							<button
								type="button"
								class="transition-colors hover:text-[var(--error)]"
								onclick={() => (deleteCommentConfirmId = comment._id)}
								disabled={deletingCommentId === comment._id}
							>
								{$_('common.delete')}
							</button>
						</div>
					</div>
				{/each}
			</div>
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
