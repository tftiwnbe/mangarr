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
		FileIcon,
		ListIcon,
		SkipBackIcon,
		SkipForwardIcon,
		SpinnerIcon,
		WarningCircleIcon
	} from 'phosphor-svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import { convexApi } from '$lib/convex/api';
	import { waitForCommand, type CommandState } from '$lib/client/commands';
	import ReaderChapterPanel from '$lib/components/reader-chapter-panel.svelte';
	import ReaderCommentsPanel from '$lib/components/reader-comments-panel.svelte';
	import ReadFinishPanel from '$lib/components/read-finish-panel.svelte';
	import { Button } from '$lib/elements/button';
	import { toast } from '$lib/elements/toast';
	import { _ } from '$lib/i18n';
	import { getReaderProgress, setReaderProgress } from '$lib/utils/reader-progress';
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

	const SERVER_PROGRESS_FLUSH_DELAY_MS = 2_500;
	const SERVER_PROGRESS_RETRY_DELAY_MS = 1_000;

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
	const resolvedTitleId = $derived(rawReaderData?.title?._id ?? null);
	const activeReadSessionQuery = useQuery(convexApi.library.getActiveReadSession, () =>
		resolvedTitleId ? { titleId: resolvedTitleId } : 'skip'
	);
	const activeReadSession = $derived(
		(activeReadSessionQuery.data as {
			id: string;
			startedAt: number;
			rating: number | null;
			notes: string | null;
		} | null) ?? null
	);
	let dismissedFinishPromptForChapterId = $state<string | null>(null);
	let finishingReadSession = $state(false);

	let mode = $state<ReaderMode>('vertical');
	let currentPageIndex = $state(0);
	let showChapterPanel = $state(false);
	let showCommentsPanel = $state(false);
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
	let pageErrorLookupRequested = $state<Record<string, true>>({});
	let pageErrorToastKeys = $state<Record<string, true>>({});
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
	const showFinishPrompt = $derived(
		!!chapter &&
			!nextChapter &&
			!!activeReadSession &&
			dismissedFinishPromptForChapterId !== chapter._id
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
			chapterName: chapter.chapterName,
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

	function getBrowserFetch(): typeof window.fetch {
		if (typeof window === 'undefined') {
			throw new Error('Browser fetch is unavailable during server-side rendering');
		}

		return window.fetch.bind(window);
	}

	function handlePageError(item: ReaderPage) {
		if (item.kind === 'local') {
			if (chapter) {
				localPagesUnavailableForChapterId = chapter._id;
				if (typeof window !== 'undefined' && title && reconcileRequestedForTitleId !== title._id) {
					reconcileRequestedForTitleId = title._id;
					void getBrowserFetch()('/api/internal/bridge/downloads/reconcile', {
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
		if (retries >= 2) {
			void notifyPageAssetFailure(item);
			return;
		}
		pageRetryCounts = {
			...pageRetryCounts,
			[item.id]: retries + 1
		};
	}

	async function notifyPageAssetFailure(item: ReaderPage) {
		if (!chapter || pageErrorLookupRequested[item.id]) return;
		pageErrorLookupRequested = {
			...pageErrorLookupRequested,
			[item.id]: true
		};
		try {
			const response = await getBrowserFetch()(resolvePageUrl(item), {
				headers: {
					accept: 'application/json'
				}
			});
			const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
			let message = $_('reader.noPages');
			if (contentType.includes('application/json')) {
				const payload = (await response.json().catch(() => null)) as { message?: string } | null;
				if (payload?.message?.trim()) {
					message = payload.message.trim();
				}
			} else if (!response.ok) {
				message = `${$_('reader.failed')} (${response.status})`;
			} else {
				return;
			}

			const toastKey = `${chapter._id}::${message}`;
			if (pageErrorToastKeys[toastKey]) return;
			pageErrorToastKeys = {
				...pageErrorToastKeys,
				[toastKey]: true
			};
			toast.error(message, {
				title: $_('reader.failed'),
				duration: 7000
			});
		} catch {
			const message = $_('reader.noPages');
			const toastKey = `${chapter._id}::${message}`;
			if (pageErrorToastKeys[toastKey]) return;
			pageErrorToastKeys = {
				...pageErrorToastKeys,
				[toastKey]: true
			};
			toast.error(message, {
				title: $_('reader.failed'),
				duration: 7000
			});
		}
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

	function scheduleServerProgressFlush(delayMs = SERVER_PROGRESS_FLUSH_DELAY_MS) {
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
				scheduleServerProgressFlush(SERVER_PROGRESS_RETRY_DELAY_MS);
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
			// On touch the header is user-controlled via tap (handleReaderTap)
			// AND auto-hidden after meaningful downward scrolling. The header
			// is force-shown when at the top so the back button/title remain
			// reachable on a fresh chapter open.
			if (isReaderAtTop) readerHeaderVisible = true;
			return;
		}
		readerHeaderVisible = isReaderAtTop || showTopZone || isPointerInHeader;
	}

	const SCROLL_HIDE_THRESHOLD_PX = 80;
	const SCROLL_HIDE_DELTA_PX = 24;
	const SCROLL_SHOW_DELTA_PX = 12;
	let lastScrollY = 0;
	function applyScrollDirectionToHeader(currentY: number) {
		if (!isTouchDevice) return;
		const delta = currentY - lastScrollY;
		if (currentY <= 8) {
			readerHeaderVisible = true;
		} else if (delta > SCROLL_HIDE_DELTA_PX && currentY > SCROLL_HIDE_THRESHOLD_PX) {
			readerHeaderVisible = false;
			lastScrollY = currentY;
		} else if (delta < -SCROLL_SHOW_DELTA_PX) {
			readerHeaderVisible = true;
			lastScrollY = currentY;
		} else if (Math.abs(delta) < 2) {
			lastScrollY = currentY;
		}
	}

	function handleReaderTap() {
		if (!isTouchDevice) return;
		readerHeaderVisible = !readerHeaderVisible;
	}

	async function commitFinishReadSession(rating: number | null, notes: string | null) {
		if (!activeReadSession || finishingReadSession) return;
		finishingReadSession = true;
		try {
			await client.mutation(convexApi.library.finishReadSession, {
				sessionId: activeReadSession.id as Id<'titleReadSessions'>,
				finishedAt: Date.now(),
				rating: rating ?? undefined,
				notes: notes ?? undefined
			});
			toast.success($_('reads.finishedToast'), { duration: 3500 });
		} catch (error) {
			toast.error(error instanceof Error ? error.message : $_('reads.finishFailedToast'), {
				duration: 5000
			});
		} finally {
			finishingReadSession = false;
		}
	}

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
					chapterUrl: chapter.chapterUrl,
					chapterName: chapter.chapterName
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
			pageErrorLookupRequested = {};
			pageErrorToastKeys = {};
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
			pageErrorLookupRequested = {};
			pageErrorToastKeys = {};
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
			const y = window.scrollY;
			isReaderAtTop = y <= 8;
			applyScrollDirectionToHeader(y);
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
		class="fixed inset-x-0 top-0 z-40 bg-[var(--void-0)]/90 pt-[env(safe-area-inset-top)] backdrop-blur-sm transition-transform duration-200 {readerHeaderVisible
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
				<Button variant="ghost" size="icon-sm" onclick={() => void goto(canonicalTitlePath)}>
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
			<div
				class="flex flex-col pt-[calc(2.5rem+env(safe-area-inset-top))] md:mx-auto md:max-w-3xl md:pt-10"
				role="presentation"
				onclick={handleReaderTap}
				onkeydown={undefined}
			>
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

		<div
			class="flex flex-col items-center gap-6 px-6 pt-16 pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-16"
		>
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
				{:else if title && !showFinishPrompt}
					<Button variant="outline" size="sm" href={canonicalTitlePath}>
						{title.title}
					</Button>
				{/if}
			</div>
			{#if bookmarkError}
				<p class="text-xs text-[var(--error)]">{bookmarkError}</p>
			{/if}
			{#if showFinishPrompt && title && activeReadSession}
				<div class="w-full max-w-md">
					<ReadFinishPanel
						startedAt={activeReadSession.startedAt}
						busy={finishingReadSession}
						variant="reader"
						headingLabel={$_('reads.endOfHeading')}
						headingDetail={title.title}
						saveLabel={$_('reads.saveAndReturn')}
						secondaryAction={{
							label: $_('reads.returnWithoutSaving'),
							onClick: () => {
								void commitFinishReadSession(null, null);
								void goto(canonicalTitlePath);
							}
						}}
						onSave={(rating, notes) => {
							void commitFinishReadSession(rating, notes);
							void goto(canonicalTitlePath);
						}}
						onDismiss={() => {
							dismissedFinishPromptForChapterId = chapter?._id ?? null;
						}}
					/>
				</div>
			{/if}
		</div>
	{/if}

	{#if pages.length > 0}
		<div
			class="fixed inset-x-0 bottom-0 z-40 bg-[var(--void-0)]/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm transition-transform duration-200 md:hidden {readerHeaderVisible
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

<ReaderChapterPanel
	open={showChapterPanel}
	onclose={() => (showChapterPanel = false)}
	{chapters}
	{currentChapterId}
	onOpenChapter={(target) => openChapter(target as ChapterItem)}
/>

<ReaderCommentsPanel
	open={showCommentsPanel}
	onclose={() => (showCommentsPanel = false)}
	comments={comments as CommentItem[]}
	loading={commentsQuery.isLoading}
	chapterId={resolvedCommentChapterId}
	currentPageIndex={currentPage?.pageIndex ?? 0}
	onJumpToPage={jumpToPage}
/>
