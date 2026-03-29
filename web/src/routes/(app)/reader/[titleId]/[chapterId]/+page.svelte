<script lang="ts">
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import { SvelteSet, SvelteURLSearchParams } from 'svelte/reactivity';
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
	import { waitForCommand, type CommandState } from '$lib/client/commands';
	import { Button } from '$lib/elements/button';
	import { ConfirmDialog } from '$lib/elements/confirm-dialog';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { _ } from '$lib/i18n';
	import { navigateBack } from '$lib/stores/nav-history';
	import { panelOverlayOpen } from '$lib/stores/ui';
	import { getReaderProgress, setReaderProgress } from '$lib/utils/reader-progress';
	import {
		formatChapterNumberValue,
		hasDisplayableChapterNumber,
		parseStructuredChapterName
	} from '$lib/utils/chapter-display';
	import { buildReaderPath, buildTitlePath } from '$lib/utils/routes';

	const { data } = $props<{
		data: { titleSegment: string | null; chapterSegment: string | null };
	}>();

	type ReaderMode = 'vertical' | 'horizontal';

	type ChapterItem = {
		_id: Id<'libraryChapters'>;
		routeSegment?: string | null;
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
		routeSegment?: string | null;
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

	type CommandItem = CommandState<Record<string, unknown>>;

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
	const readerQuery = useQuery(convexApi.library.getReaderByRouteSegments, () =>
		data.titleSegment && data.chapterSegment
			? {
					titleRouteSegment: data.titleSegment,
					chapterRouteSegment: data.chapterSegment
				}
			: 'skip'
	);
	const rawReaderData = $derived((readerQuery.data as ReaderQuery) ?? null);
	const resolvedCommentChapterId = $derived(rawReaderData?.chapter?._id ?? null);
	const commentsQuery = useQuery(convexApi.library.listChapterComments, () =>
		resolvedCommentChapterId ? { chapterId: resolvedCommentChapterId } : 'skip'
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
	let progressFlushTimer: ReturnType<typeof setTimeout> | null = null;
	let progressSyncInFlight = $state(false);
	let pendingServerPageIndex = $state<number | null>(null);
	let lastSavedServerPageIndex = $state<number | null>(null);
	let lastChapterId = $state<string | null>(null);
	let remotePagesCommand = $state<CommandItem | null>(null);
	let pageRetryCounts = $state<Record<string, number>>({});
	let localPagesUnavailableForChapterId = $state<string | null>(null);
	let reconcileRequestedForTitleId = $state<string | null>(null);
	let scrollFrame = 0;
	let sequentialPageCeiling = $state(0);

	const readerData = $derived(rawReaderData);
	const title = $derived(readerData?.title ?? null);
	const chapter = $derived(readerData?.chapter ?? null);
	const currentChapterId = $derived(chapter?._id ?? null);
	const chapters = $derived(readerData?.chapters ?? []);
	const comments = $derived((commentsQuery.data ?? []) as CommentItem[]);
	const loadError = $derived(readerQuery.error instanceof Error ? readerQuery.error.message : null);

	const pageParamIndex = $derived.by(() => {
		const raw = page.url.searchParams.get('page');
		if (!raw) return null;
		const parsed = Number(raw);
		return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
	});

	const remotePagesResult = $derived(remotePagesCommand);

	const remotePages = $derived.by(() =>
		[...((remotePagesResult?.result?.pages as RemotePage[] | undefined) ?? [])].sort(
			(left, right) => left.index - right.index
		)
	);
	const canUseDownloadedPages = $derived.by(() => {
		if (!chapter) return false;
		if (localPagesUnavailableForChapterId === chapter._id) return false;
		return (
			chapter.downloadStatus === 'downloaded' &&
			Boolean(chapter.localRelativePath) &&
			Boolean(chapter.storageKind) &&
			typeof chapter.totalPages === 'number' &&
			chapter.totalPages > 0
		);
	});
	const isPagesLoading = $derived.by(() => {
		if (!chapter) return false;
		if (canUseDownloadedPages) {
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

	const pages = $derived.by((): ReaderPage[] => {
		if (!chapter) return [] as ReaderPage[];
		if (canUseDownloadedPages) {
			const totalPages = chapter.totalPages ?? 0;
			return Array.from({ length: totalPages }, (_, index) => ({
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

	const currentPage = $derived((pages[currentPageIndex] ?? null) as ReaderPage | null);
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
	const prevChapter = $derived.by(() =>
		prevChapterId ? (chapters.find((item) => item._id === prevChapterId) ?? null) : null
	);
	const nextChapter = $derived.by(() =>
		nextChapterId ? (chapters.find((item) => item._id === nextChapterId) ?? null) : null
	);
	const canonicalTitlePath = $derived.by(() =>
		title ? buildTitlePath(String(title._id), title.title, title.routeSegment ?? null) : '/library'
	);
	const canonicalReaderPath = $derived.by(() =>
		title && chapter
			? buildReaderPath({
					titleId: title._id,
					titleName: title.title,
					titleRouteSegment: title.routeSegment ?? null,
					chapterId: chapter._id,
					chapterName: chapter.chapterName,
					chapterNumber: chapter.chapterNumber ?? null,
					chapterRouteSegment: chapter.routeSegment ?? null
				})
			: null
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
		const retryCount = pageRetryCounts[item.id] ?? 0;
		if (item.kind === 'local' && chapter.localRelativePath && chapter.storageKind) {
			const params = new SvelteURLSearchParams({
				path: chapter.localRelativePath,
				index: String(item.index)
			});
			return `/api/internal/bridge/library/page?${params.toString()}`;
		}

		const params = new SvelteURLSearchParams({
			sourceId: chapter.sourceId,
			chapterUrl: chapter.chapterUrl,
			index: String(item.index)
		});
		if (retryCount > 0) {
			params.set('retry', String(retryCount));
		}
		return `/api/internal/bridge/reader/page?${params.toString()}`;
	}

	function markPageLoaded(id: string, pageIndex: number) {
		loadedPageIds.add(id);
		if (mode === 'vertical') {
			sequentialPageCeiling = Math.max(sequentialPageCeiling, pageIndex + 1);
		}
	}

	function markPagePainted(id: string) {
		paintedPageIds.add(id);
	}

	function handlePageError(item: ReaderPage) {
		if (item.kind === 'local') {
			if (chapter) {
				localPagesUnavailableForChapterId = chapter._id;
				if (title && reconcileRequestedForTitleId !== title._id) {
					reconcileRequestedForTitleId = title._id;
					void fetch('/api/internal/bridge/downloads/reconcile', {
						method: 'POST',
						headers: {
							'content-type': 'application/json'
						},
						body: JSON.stringify({ titleId: title._id })
					}).finally(() => {
						if (reconcileRequestedForTitleId === title._id) {
							reconcileRequestedForTitleId = null;
						}
					});
				}
			}
			return;
		}
		const retries = pageRetryCounts[item.id] ?? 0;
		if (retries >= 2) return;
		pageRetryCounts = {
			...pageRetryCounts,
			[item.id]: retries + 1
		};
	}

	function pageDistanceFromCurrent(pageIndex: number) {
		return Math.abs(pageIndex - currentPageIndex);
	}

	function pageRequestUnlocked(readerPage: ReaderPage): boolean {
		if (mode !== 'vertical') return true;
		return readerPage.pageIndex <= sequentialPageCeiling;
	}

	function pageLoadingMode(readerPage: ReaderPage): 'eager' | 'lazy' {
		if (mode !== 'vertical') {
			return pageDistanceFromCurrent(readerPage.pageIndex) <= 1 ? 'eager' : 'lazy';
		}
		return readerPage.pageIndex <= sequentialPageCeiling ? 'eager' : 'lazy';
	}

	function pageFetchPriority(readerPage: ReaderPage): 'high' | 'auto' {
		if (mode !== 'vertical') {
			return pageDistanceFromCurrent(readerPage.pageIndex) <= 1 ? 'high' : 'auto';
		}
		return readerPage.pageIndex <= sequentialPageCeiling ? 'high' : 'auto';
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

	function chapterListLabel(item: ChapterItem): string {
		if (hasDisplayableChapterNumber(item.chapterNumber)) {
			return $_('chapter.chapterShort', {
				values: { number: formatChapterNumberValue(item.chapterNumber) }
			});
		}
		const parsed = parseStructuredChapterName(item.chapterName);
		if (!parsed) return item.chapterName;
		const parts: string[] = [];
		if (parsed.volumeNumber) {
			parts.push($_('chapter.volumeShort', { values: { number: parsed.volumeNumber } }));
		}
		if (parsed.chapterNumber) {
			parts.push($_('chapter.chapterShort', { values: { number: parsed.chapterNumber } }));
		}
		return parts.join(' · ') || item.chapterName;
	}

	function chapterListDetail(item: ChapterItem): string | null {
		const raw = item.chapterName.trim();
		if (!raw) return null;
		if (hasDisplayableChapterNumber(item.chapterNumber)) {
			const chapterShort = $_('chapter.chapterShort', {
				values: { number: formatChapterNumberValue(item.chapterNumber) }
			});
			return raw === chapterShort ? null : raw;
		}
		return parseStructuredChapterName(raw)?.detail ?? null;
	}

	function openChapter(target: ChapterItem | null) {
		if (!title || !target) return;
		showChapterPanel = false;
		showCommentsPanel = false;
		void goto(
			buildReaderPath({
				titleId: title._id,
				titleName: title.title,
				titleRouteSegment: title.routeSegment ?? null,
				chapterId: target._id,
				chapterName: target.chapterName,
				chapterNumber: target.chapterNumber ?? null,
				chapterRouteSegment: target.routeSegment ?? null
			})
		);
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

	function scheduleServerProgressFlush(delayMs = 900) {
		if (progressFlushTimer) {
			clearTimeout(progressFlushTimer);
		}
		progressFlushTimer = setTimeout(() => {
			void flushServerProgress();
		}, delayMs);
	}

	async function flushServerProgress() {
		if (!chapter || progressSyncInFlight) return;
		const activeChapterId = chapter._id;
		const pageIndex = pendingServerPageIndex;
		if (pageIndex === null || pageIndex === lastSavedServerPageIndex) {
			return;
		}

		progressSyncInFlight = true;
		try {
			await client.mutation(convexApi.library.upsertChapterProgress, {
				chapterId: activeChapterId,
				pageIndex
			});
			if (chapter?._id !== activeChapterId) {
				return;
			}
			lastSavedServerPageIndex = pageIndex;
			if (pendingServerPageIndex === pageIndex) {
				pendingServerPageIndex = null;
			}
		} finally {
			progressSyncInFlight = false;
			if (pendingServerPageIndex !== null && pendingServerPageIndex !== lastSavedServerPageIndex) {
				scheduleServerProgressFlush(500);
			}
		}
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
		if (!canonicalReaderPath) return;
		if (page.url.pathname !== canonicalReaderPath) {
			void goto(canonicalReaderPath, { replaceState: true, noScroll: true });
		}
	});

	$effect(() => {
		if (!chapter || fetchRequested) return;
		if (canUseDownloadedPages) return;
		if (remotePagesResult?.status === 'running' || remotePagesResult?.status === 'queued') return;
		if (remotePages.length > 0) return;
		const requestKey = `${chapter.sourceId}::${chapter.chapterUrl}`;
		fetchRequested = true;
		remotePagesCommand = {
			id: requestKey,
			commandType: 'reader.pages.fetch',
			status: 'queued'
		};
		void (async () => {
			try {
				const { commandId } = await client.mutation(convexApi.commands.enqueueReaderPagesFetch, {
					sourceId: chapter.sourceId,
					chapterUrl: chapter.chapterUrl
				});
				const command = await waitForCommand<CommandItem>(client, commandId, {
					timeoutMs: 15_000,
					pollIntervalMs: 250,
					onUpdate: (next) => {
						if (`${chapter.sourceId}::${chapter.chapterUrl}` === requestKey) {
							remotePagesCommand = next;
						}
					}
				});
				if (`${chapter.sourceId}::${chapter.chapterUrl}` === requestKey) {
					remotePagesCommand = command;
				}
			} catch (error) {
				if (`${chapter.sourceId}::${chapter.chapterUrl}` === requestKey) {
					remotePagesCommand = {
						id: requestKey,
						commandType: 'reader.pages.fetch',
						status: 'failed',
						lastErrorMessage: error instanceof Error ? error.message : $_('reader.noPages')
					};
				}
			} finally {
				if (`${chapter.sourceId}::${chapter.chapterUrl}` === requestKey) {
					fetchRequested = false;
				}
			}
		})();
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
		if (mode === 'vertical' && preferredIndex > 0) {
			void tick().then(() => {
				window.requestAnimationFrame(() => {
					const node = document.querySelector(
						`[data-reader-page-index="${preferredPage}"]`
					) as HTMLElement | null;
					node?.scrollIntoView({ behavior: 'auto', block: 'start' });
				});
			});
		}
	});

	$effect(() => {
		if (!initializedProgress || !chapter || !pages[currentPageIndex]) return;
		if (typeof window === 'undefined') return;
		const pageIndex = pages[currentPageIndex].pageIndex;
		const currentParam = page.url.searchParams.get('page');
		if (currentParam === String(pageIndex)) return;
		const nextUrl = new URL(page.url);
		nextUrl.searchParams.set('page', String(pageIndex));
		replaceState(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`, page.state);
	});

	$effect(() => {
		const serverPage = readerData?.progress?.pageIndex ?? null;
		lastSavedServerPageIndex = serverPage;
	});

	$effect(() => {
		if (currentChapterId === null) {
			lastChapterId = null;
			fetchRequested = false;
			remotePagesCommand = null;
			initializedProgress = false;
			currentPageIndex = 0;
			sequentialPageCeiling = 0;
			progressSyncInFlight = false;
			pendingServerPageIndex = null;
			lastSavedServerPageIndex = null;
			loadedPageIds.clear();
			paintedPageIds.clear();
			pageRetryCounts = {};
			localPagesUnavailableForChapterId = null;
			return;
		}

		if (lastChapterId !== currentChapterId) {
			lastChapterId = currentChapterId;
			fetchRequested = false;
			remotePagesCommand = null;
			initializedProgress = false;
			currentPageIndex = 0;
			sequentialPageCeiling = 0;
			progressSyncInFlight = false;
			pendingServerPageIndex = null;
			lastSavedServerPageIndex =
				readerData?.progress?.pageIndex ?? getReaderProgress(currentChapterId) ?? null;
			loadedPageIds.clear();
			paintedPageIds.clear();
			pageRetryCounts = {};
			localPagesUnavailableForChapterId = null;
		}
	});

	$effect(() => {
		if (mode !== 'vertical' || pages.length === 0) return;
		const targetCeiling = Math.min(
			Math.max(currentPageIndex + 1, 0),
			Math.max(pages.length - 1, 0)
		);
		if (targetCeiling > sequentialPageCeiling) {
			sequentialPageCeiling = targetCeiling;
		}
	});

	$effect(() => {
		if (!chapter || !pages[currentPageIndex]) return;
		const pageIndex = pages[currentPageIndex].pageIndex;
		setReaderProgress(chapter._id, pageIndex);
		if (pageIndex === lastSavedServerPageIndex) {
			pendingServerPageIndex = null;
			return;
		}
		pendingServerPageIndex = pageIndex;
		scheduleServerProgressFlush();

		return () => {
			if (progressFlushTimer) {
				clearTimeout(progressFlushTimer);
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
		const handleScroll = () => {
			if (scrollFrame) return;
			scrollFrame = window.requestAnimationFrame(() => {
				scrollFrame = 0;
				syncScroll();
			});
		};

		syncTouch();
		syncScroll();
		media.addEventListener('change', syncTouch);
		window.addEventListener('scroll', handleScroll, { passive: true });
		return () => {
			document.documentElement.classList.remove('reader-mode');
			document.body.classList.remove('reader-mode');
			media.removeEventListener('change', syncTouch);
			window.removeEventListener('scroll', handleScroll);
			if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
			if (progressFlushTimer) clearTimeout(progressFlushTimer);
			void flushServerProgress();
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
					<Button
						variant="ghost"
						size="icon-sm"
						onclick={() => openChapter(prevChapter)}
						disabled={!prevChapter}
					>
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
						{#if mode === 'vertical'}<ArrowsOutIcon size={16} />{:else}<ArrowsInIcon
								size={16}
							/>{/if}
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						onclick={() => openChapter(nextChapter)}
						disabled={!nextChapter}
					>
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
					<div
						data-reader-page-index={readerPage.pageIndex}
						class="relative"
						style="content-visibility: auto; contain-intrinsic-size: 1000px 1500px;"
					>
						{#if !paintedPageIds.has(readerPage.id)}
							<div class="aspect-[2/3] w-full bg-[var(--void-1)]"></div>
						{/if}
						<img
							src={pageRequestUnlocked(readerPage) ? resolvePageUrl(readerPage) : undefined}
							alt="{$_('reader.page')} {readerPage.pageIndex + 1}"
							loading={pageLoadingMode(readerPage)}
							fetchpriority={pageFetchPriority(readerPage)}
							decoding="async"
							class="bg-[var(--void-1)] object-contain {paintedPageIds.has(readerPage.id)
								? 'w-full'
								: 'absolute inset-0 opacity-0'}"
							onload={() => {
								markPageLoaded(readerPage.id, readerPage.pageIndex);
								markPagePainted(readerPage.id);
							}}
							onerror={() => handlePageError(readerPage)}
						/>
					</div>
				{/each}
			</div>
		{:else if currentPage}
			<div class="relative flex min-h-svh items-center justify-center md:px-8">
				<img
					src={resolvePageUrl(currentPage)}
					alt="{$_('reader.page')} {currentPage.pageIndex + 1}"
					loading="eager"
					class="max-h-svh w-auto max-w-full bg-[var(--void-1)] object-contain"
					onerror={() => handlePageError(currentPage)}
				/>
				{#if isTouchDevice}
					<button
						type="button"
						class="absolute inset-y-0 left-0 z-20 w-1/3"
						aria-label={$_('reader.prevPage')}
						onclick={prevPage}
					></button>
					<button
						type="button"
						class="absolute inset-y-0 right-0 z-20 w-1/3"
						aria-label={$_('reader.nextPage')}
						onclick={nextPage}
					></button>
				{/if}
			</div>
		{/if}

		<div class="flex flex-col items-center gap-6 px-6 py-16">
			{#if chapter?.chapterName}
				<p class="text-xs text-[var(--text-ghost)]">{chapter.chapterName}</p>
			{/if}
			<div class="flex items-center gap-3">
				{#if prevChapter}
					<Button variant="outline" size="sm" onclick={() => openChapter(prevChapter)}>
						<CaretLeftIcon size={14} />
						{$_('reader.prevChapter')}
					</Button>
				{/if}
				{#if nextChapter}
					<Button variant="outline" size="sm" onclick={() => openChapter(nextChapter)}>
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
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={() => openChapter(prevChapter)}
					disabled={!prevChapter}
				>
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
						{#if mode === 'vertical'}<ArrowsOutIcon size={16} />{:else}<ArrowsInIcon
								size={16}
							/>{/if}
					</Button>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={() => openChapter(nextChapter)}
					disabled={!nextChapter}
				>
					<SkipForwardIcon size={16} />
				</Button>
			</div>
		</div>
	{/if}
</div>

<SlidePanel
	open={showChapterPanel}
	title={$_('reader.chapters')}
	onclose={() => (showChapterPanel = false)}
>
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
					onclick={() => openChapter(item)}
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
						<span class="shrink-0 text-[10px] text-[var(--text-ghost)] tabular-nums"
							>{item.chapterNumber}</span
						>
					{/if}
				</button>
			{/each}
		{/if}
	</div>
</SlidePanel>

<SlidePanel
	open={showCommentsPanel}
	title={$_('reader.comments')}
	onclose={() => (showCommentsPanel = false)}
>
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
						<Button variant="ghost" size="sm" onclick={startNewComment}
							>{$_('common.cancel')}</Button
						>
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
							<button
								type="button"
								class="transition-colors hover:text-[var(--text-muted)]"
								onclick={() => startEditComment(comment)}
							>
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
