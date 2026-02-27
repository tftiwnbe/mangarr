<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import {
		createLibraryChapterComment,
		deleteLibraryChapterComment,
		getLibraryChapterProgress,
		getLibraryChapterReader,
		getLibraryFileUrl,
		getLibraryTitle,
		listLibraryChapterComments,
		listLibraryStatuses,
		listLibraryTitleChapters,
		updateLibraryChapterComment,
		updateLibraryChapterProgress,
		updateLibraryTitlePreferences,
		type LibraryChapterResource,
		type LibraryChapterCommentResource,
		type LibraryReaderChapterResource
	} from '$lib/api/library';
	import { Button } from '$lib/elements/button';
	import { Icon } from '$lib/elements/icon';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { _ } from '$lib/i18n';
	import {
		buildReaderPath,
		buildTitlePath,
		inferChapterNumber,
		parseIdFromRouteParam,
		parseReaderChapterParam
	} from '$lib/utils/routes';

	type ReaderMode = 'vertical' | 'horizontal';
	type ChapterMeta = { name: string; number: number | null };
	type ReaderParentRoute = 'library' | 'explore';
	type ChapterListItem = { id: number; name: string; number: number | null };
	type CommentSortMode = 'time' | 'page';

	let mode = $state<ReaderMode>('vertical');
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let reader = $state<LibraryReaderChapterResource | null>(null);
	let readerTitleName = $state('');
	let chapterMetaById = $state<Map<number, ChapterMeta>>(new Map());
	let chapterList = $state<ChapterListItem[]>([]);
	let currentPageIndex = $state(0);
	let loadedPageIds = $state<Set<number>>(new Set());
	let bookmarkingReading = $state(false);
	let bookmarkError = $state<string | null>(null);
	let commentsError = $state<string | null>(null);
	let hasAnyTitleStatus = $state(false);
	let showChapterPanel = $state(false);
	let showCommentsPanel = $state(false);
	let chapterComments = $state<LibraryChapterCommentResource[]>([]);
	let chapterCommentsLoading = $state(false);
	let commentsSortMode = $state<CommentSortMode>('time');
	let commentDraft = $state('');
	let editingCommentId = $state<number | null>(null);
	let commentSubmitting = $state(false);
	let deletingCommentId = $state<number | null>(null);

	let readerHeaderVisible = $state(true);
	let readerHeaderElement = $state<HTMLDivElement | null>(null);
	let isPointerInHeader = $state(false);
	let isPointerInTopZone = $state(false);
	let isTouchDevice = $state(false);
	let isReaderAtTop = $state(true);
	let touchPointerId: number | null = null;
	let touchStartX = 0;
	let touchStartY = 0;
	let touchMoved = false;
	let touchTargetInteractive = false;
	let verticalPageSyncFrame: number | null = null;
	let chapterProgressSaveTimer: ReturnType<typeof setTimeout> | null = null;

	let loadRequestId = 0;

	const titleIdParam = $derived(page.params.titleId);
	const chapterIdParam = $derived(page.params.chapterId);
	const titleId = $derived(parseIdFromRouteParam(titleIdParam) ?? NaN);
	const chapterRef = $derived(parseReaderChapterParam(chapterIdParam));
	const readerParentRoute = $derived.by<ReaderParentRoute>(() =>
		page.url.searchParams.get('from') === 'explore' ? 'explore' : 'library'
	);

	function withReaderParent(path: string): string {
		return `${path}?from=${readerParentRoute}`;
	}

	const currentChapterMeta = $derived.by(() => {
		if (!reader) return null;
		return chapterMetaById.get(reader.chapter_id) ?? null;
	});
	const canonicalTitlePath = $derived.by(() => {
		const resolvedTitleId = reader?.library_title_id ?? titleId;
		if (!Number.isFinite(resolvedTitleId) || resolvedTitleId <= 0) return null;
		if (!readerTitleName) return withReaderParent(`/title/${resolvedTitleId}`);
		return withReaderParent(buildTitlePath(resolvedTitleId, readerTitleName));
	});
	const canonicalReaderPath = $derived.by(() => {
		if (!reader || !readerTitleName) return null;
		return withReaderParent(
			buildReaderPath({
				titleId: reader.library_title_id,
				titleName: readerTitleName,
				chapterId: reader.chapter_id,
				chapterName: currentChapterMeta?.name ?? null,
				chapterNumber: null
			})
		);
	});

	const pages = $derived.by(() => {
		if (!reader) return [];
		return [...reader.pages].sort((a, b) => a.page_index - b.page_index);
	});

	const currentPage = $derived(pages[currentPageIndex] ?? null);
	const canPrevPage = $derived(currentPageIndex > 0);
	const canNextPage = $derived(currentPageIndex < pages.length - 1);
	const sortedChapterComments = $derived.by(() => {
		const rows = [...chapterComments];
		if (commentsSortMode === 'page') {
			rows.sort((left, right) => {
				if (left.page_index !== right.page_index) {
					return left.page_index - right.page_index;
				}
				return right.created_at.localeCompare(left.created_at);
			});
			return rows;
		}
		rows.sort((left, right) => right.created_at.localeCompare(left.created_at));
		return rows;
	});
	const requestedPageIndex = $derived.by(() => {
		const raw = page.url.searchParams.get('page');
		if (!raw) return null;
		const parsed = Number(raw);
		if (!Number.isInteger(parsed) || parsed < 0) return null;
		return parsed;
	});
	const prevChapterId = $derived.by(() => {
		const currentReader = reader;
		if (!currentReader) return null;
		const index = chapterList.findIndex((chapter) => chapter.id === currentReader.chapter_id);
		if (index <= 0) return null;
		return chapterList[index - 1]?.id ?? null;
	});
	const nextChapterId = $derived.by(() => {
		const currentReader = reader;
		if (!currentReader) return null;
		const index = chapterList.findIndex((chapter) => chapter.id === currentReader.chapter_id);
		if (index < 0 || index >= chapterList.length - 1) return null;
		return chapterList[index + 1]?.id ?? null;
	});

	function chapterNumberForResource(chapter: LibraryChapterResource): number | null {
		if (chapter.chapter_number > 0) {
			return chapter.chapter_number;
		}
		return inferChapterNumber(chapter.name);
	}

	function chapterMetaMap(chapters: LibraryChapterResource[]): Map<number, ChapterMeta> {
		const mapped = new Map<number, ChapterMeta>();
		for (const chapter of chapters) {
			mapped.set(chapter.id, {
				name: chapter.name,
				number: chapterNumberForResource(chapter)
			});
		}
		return mapped;
	}

	function chapterListFromResources(chapters: LibraryChapterResource[]): ChapterListItem[] {
		return chapters
			.map((chapter) => ({
				id: chapter.id,
				name: chapter.name,
				number: chapterNumberForResource(chapter)
			}))
			.sort((left, right) => {
				const leftNumber = left.number ?? Number.POSITIVE_INFINITY;
				const rightNumber = right.number ?? Number.POSITIVE_INFINITY;
				if (leftNumber !== rightNumber) {
					return leftNumber - rightNumber;
				}
				return left.id - right.id;
			});
	}

	function resolveChapterIdByNumber(
		chapters: LibraryChapterResource[],
		target: number
	): number | null {
		const EPSILON = 1e-6;
		const matches = chapters
			.filter((chapter) => {
				const number = chapterNumberForResource(chapter);
				return number !== null && Math.abs(number - target) <= EPSILON;
			})
			.sort((left, right) => right.date_upload.localeCompare(left.date_upload));
		return matches[0]?.id ?? null;
	}

	function markPagesLoaded(pageIds: number[]): void {
		let changed = false;
		const next = new Set(loadedPageIds);
		for (const pageId of pageIds) {
			if (!next.has(pageId)) {
				next.add(pageId);
				changed = true;
			}
		}
		if (changed) {
			loadedPageIds = next;
		}
	}

	function lazyLoadPage(node: HTMLElement, options: { pageId: number }) {
		let { pageId } = options;
		if (loadedPageIds.has(pageId) || typeof IntersectionObserver === 'undefined') {
			markPagesLoaded([pageId]);
			return {
				update(next: { pageId: number }) {
					pageId = next.pageId;
					markPagesLoaded([pageId]);
				}
			};
		}

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						markPagesLoaded([pageId]);
						observer.unobserve(node);
						break;
					}
				}
			},
			{
				root: null,
				rootMargin: '1200px 0px',
				threshold: 0.01
			}
		);
		observer.observe(node);

		return {
			update(next: { pageId: number }) {
				pageId = next.pageId;
				if (loadedPageIds.has(pageId)) {
					observer.unobserve(node);
				}
			},
			destroy() {
				observer.disconnect();
			}
		};
	}

	function syncReaderHeaderVisibility(): void {
		if (isTouchDevice) {
			if (isReaderAtTop) {
				readerHeaderVisible = true;
			}
			return;
		}
		readerHeaderVisible = isReaderAtTop || isPointerInHeader || isPointerInTopZone;
	}

	function handleHeaderMouseEnter(): void {
		isPointerInHeader = true;
		syncReaderHeaderVisibility();
	}

	function handleHeaderMouseLeave(): void {
		isPointerInHeader = false;
		syncReaderHeaderVisibility();
	}

	function handleHeaderHoverZoneEnter(): void {
		isPointerInTopZone = true;
		syncReaderHeaderVisibility();
	}

	function handleHeaderHoverZoneLeave(): void {
		isPointerInTopZone = false;
		syncReaderHeaderVisibility();
	}

	function resetTouchTracking(): void {
		touchPointerId = null;
		touchMoved = false;
		touchTargetInteractive = false;
	}

	function isInteractiveTarget(target: HTMLElement): boolean {
		return Boolean(target.closest('button, a, input, textarea, select, [role="button"]'));
	}

	function handleReaderPointerDown(event: PointerEvent): void {
		if (!isTouchDevice || isReaderAtTop || event.pointerType !== 'touch') return;
		const target = event.target as HTMLElement | null;
		if (!target) return;
		touchPointerId = event.pointerId;
		touchStartX = event.clientX;
		touchStartY = event.clientY;
		touchMoved = false;
		touchTargetInteractive = isInteractiveTarget(target);
	}

	function handleReaderPointerMove(event: PointerEvent): void {
		if (touchPointerId === null || event.pointerId !== touchPointerId) return;
		const deltaX = Math.abs(event.clientX - touchStartX);
		const deltaY = Math.abs(event.clientY - touchStartY);
		if (deltaX > 10 || deltaY > 10) {
			touchMoved = true;
		}
	}

	function handleReaderPointerUp(event: PointerEvent): void {
		if (!isTouchDevice || touchPointerId === null || event.pointerId !== touchPointerId) return;
		const target = event.target as HTMLElement | null;
		const shouldToggle =
			!touchMoved &&
			!touchTargetInteractive &&
			target !== null &&
			!readerHeaderElement?.contains(target);
		resetTouchTracking();
		if (!isReaderAtTop && shouldToggle) {
			readerHeaderVisible = !readerHeaderVisible;
		}
	}

	function handleReaderPointerCancel(event: PointerEvent): void {
		if (touchPointerId !== null && event.pointerId === touchPointerId) {
			resetTouchTracking();
		}
	}

	function syncVerticalCurrentPageFromScroll(): void {
		if (mode !== 'vertical' || pages.length === 0) return;
		const pageNodes = document.querySelectorAll<HTMLElement>('[data-reader-page-index]');
		if (pageNodes.length === 0) return;
		const topAnchor = 72;
		let bestPageIndex = pages[currentPageIndex]?.page_index ?? pages[0]?.page_index ?? 0;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (const node of pageNodes) {
			const rect = node.getBoundingClientRect();
			if (rect.bottom < topAnchor) continue;
			if (rect.top > window.innerHeight) continue;
			const candidatePageIndex = Number(node.dataset.readerPageIndex ?? '');
			if (!Number.isInteger(candidatePageIndex)) continue;
			const distance = Math.abs(rect.top - topAnchor);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestPageIndex = candidatePageIndex;
			}
		}
		const visibleIndex = pages.findIndex((readerPage) => readerPage.page_index === bestPageIndex);
		if (visibleIndex >= 0 && visibleIndex !== currentPageIndex) {
			currentPageIndex = visibleIndex;
		}
	}

	function scheduleVerticalPageSync(): void {
		if (mode !== 'vertical') return;
		if (verticalPageSyncFrame !== null) return;
		verticalPageSyncFrame = requestAnimationFrame(() => {
			verticalPageSyncFrame = null;
			syncVerticalCurrentPageFromScroll();
		});
	}

	function handleReaderSurfaceKeydown(event: KeyboardEvent): void {
		if (!isTouchDevice || isReaderAtTop) return;
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		readerHeaderVisible = !readerHeaderVisible;
	}

	function jumpToPageIndex(pageIndex: number): void {
		const targetIndex = pages.findIndex((readerPage) => readerPage.page_index === pageIndex);
		if (targetIndex < 0) return;
		currentPageIndex = targetIndex;
		if (mode === 'vertical') {
			const node = document.querySelector(
				`[data-reader-page-index="${pageIndex}"]`
			) as HTMLElement | null;
			if (node) {
				node.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}
		}
	}

	let commentsRequestId = 0;
	async function loadCommentsForChapter(chapterId: number): Promise<void> {
		const requestId = ++commentsRequestId;
		chapterCommentsLoading = true;
		commentsError = null;
		try {
			const rows = await listLibraryChapterComments(chapterId, { newest_first: true });
			if (requestId !== commentsRequestId) return;
			chapterComments = rows;
		} catch (cause) {
			if (requestId !== commentsRequestId) return;
			commentsError = cause instanceof Error ? cause.message : $_('reader.commentLoadFailed');
		} finally {
			if (requestId === commentsRequestId) {
				chapterCommentsLoading = false;
			}
		}
	}

	function startNewComment(): void {
		editingCommentId = null;
		commentDraft = '';
	}

	function startEditComment(comment: LibraryChapterCommentResource): void {
		editingCommentId = comment.id;
		commentDraft = comment.message;
	}

	async function saveComment(): Promise<void> {
		const chapterId = reader?.chapter_id;
		if (!chapterId || commentSubmitting) return;
		const message = commentDraft.trim();
		if (!message) {
			commentsError = $_('reader.commentSaveFailed');
			return;
		}
		commentsError = null;
		commentSubmitting = true;
		try {
			if (editingCommentId === null) {
				await createLibraryChapterComment(chapterId, {
					page_index: Math.max(0, currentPage?.page_index ?? 0),
					message
				});
			} else {
				await updateLibraryChapterComment(editingCommentId, {
					message
				});
			}
			startNewComment();
			await loadCommentsForChapter(chapterId);
		} catch (cause) {
			commentsError = cause instanceof Error ? cause.message : $_('reader.commentSaveFailed');
		} finally {
			commentSubmitting = false;
		}
	}

	async function removeComment(commentId: number): Promise<void> {
		if (deletingCommentId !== null) return;
		const chapterId = reader?.chapter_id;
		if (!chapterId) return;
		commentsError = null;
		deletingCommentId = commentId;
		try {
			await deleteLibraryChapterComment(commentId);
			if (editingCommentId === commentId) {
				startNewComment();
			}
			await loadCommentsForChapter(chapterId);
		} catch (cause) {
			commentsError = cause instanceof Error ? cause.message : $_('reader.commentDeleteFailed');
		} finally {
			deletingCommentId = null;
		}
	}

	function openCommentsPanel(): void {
		showCommentsPanel = true;
		if (reader?.chapter_id) {
			void loadCommentsForChapter(reader.chapter_id);
		}
	}

	onMount(() => {
		if (typeof window !== 'undefined') {
			const media = window.matchMedia('(hover: hover) and (pointer: fine)');
			const syncTouchDevice = () => {
				isTouchDevice = !media.matches;
				syncReaderHeaderVisibility();
			};
			const syncScrollTop = () => {
				isReaderAtTop = window.scrollY <= 8;
				syncReaderHeaderVisibility();
				scheduleVerticalPageSync();
			};
			const syncResize = () => {
				scheduleVerticalPageSync();
			};

			syncTouchDevice();
			syncScrollTop();
			scheduleVerticalPageSync();

			media.addEventListener('change', syncTouchDevice);
			window.addEventListener('scroll', syncScrollTop, { passive: true });
			window.addEventListener('resize', syncResize);

			return () => {
				media.removeEventListener('change', syncTouchDevice);
				window.removeEventListener('scroll', syncScrollTop);
				window.removeEventListener('resize', syncResize);
				if (chapterProgressSaveTimer) {
					clearTimeout(chapterProgressSaveTimer);
				}
				if (verticalPageSyncFrame !== null) {
					cancelAnimationFrame(verticalPageSyncFrame);
					verticalPageSyncFrame = null;
				}
				resetTouchTracking();
			};
		}

		return () => {
			if (chapterProgressSaveTimer) {
				clearTimeout(chapterProgressSaveTimer);
			}
			if (verticalPageSyncFrame !== null) {
				cancelAnimationFrame(verticalPageSyncFrame);
				verticalPageSyncFrame = null;
			}
			resetTouchTracking();
		};
	});

	$effect(() => {
		const chapterIdFromParam = chapterRef.id;
		const chapterNumberFromParam = chapterRef.number;
		const titleIdFromParam = titleId;
		const hasResolvableParam =
			(chapterIdFromParam !== null && chapterIdFromParam > 0) ||
			(chapterNumberFromParam !== null &&
				chapterNumberFromParam > 0 &&
				Number.isFinite(titleIdFromParam) &&
				titleIdFromParam > 0);

		if (!hasResolvableParam) {
			isLoading = false;
			reader = null;
			error = $_('reader.invalidChapter');
			loadedPageIds = new Set();
			return;
		}

		const requestId = ++loadRequestId;
		isLoading = true;
		error = null;
		reader = null;
		bookmarkError = null;
		commentsError = null;
		readerTitleName = '';
		hasAnyTitleStatus = true;
		chapterMetaById = new Map();
		chapterList = [];
		loadedPageIds = new Set();
		chapterComments = [];
		editingCommentId = null;
		commentDraft = '';
		showChapterPanel = false;
		showCommentsPanel = false;

		void (async () => {
			try {
				let resolvedChapterId = chapterIdFromParam;
				let preloadedChapters: LibraryChapterResource[] | null = null;
				if (resolvedChapterId === null && chapterNumberFromParam !== null) {
					preloadedChapters = await listLibraryTitleChapters(titleIdFromParam);
					chapterMetaById = chapterMetaMap(preloadedChapters);
					chapterList = chapterListFromResources(preloadedChapters);
					resolvedChapterId = resolveChapterIdByNumber(preloadedChapters, chapterNumberFromParam);
					if (resolvedChapterId === null) {
						throw new Error($_('reader.invalidChapter'));
					}
				}
				if (resolvedChapterId === null) {
					throw new Error($_('reader.invalidChapter'));
				}

				const data = await getLibraryChapterReader(resolvedChapterId);
				if (requestId !== loadRequestId) return;

				reader = data;
				const sorted = [...data.pages].sort((a, b) => a.page_index - b.page_index);
				currentPageIndex = 0;

				const [titleResult, chaptersResult] = await Promise.allSettled([
					getLibraryTitle(data.library_title_id),
					preloadedChapters
						? Promise.resolve(preloadedChapters)
						: listLibraryTitleChapters(data.library_title_id)
				]);
				if (requestId !== loadRequestId) return;
				if (titleResult.status === 'fulfilled') {
					readerTitleName = titleResult.value.title;
					hasAnyTitleStatus = titleResult.value.user_status != null;
				}
				if (chaptersResult.status === 'fulfilled') {
					chapterMetaById = chapterMetaMap(chaptersResult.value);
					chapterList = chapterListFromResources(chaptersResult.value);
				}
				try {
					const progress = await getLibraryChapterProgress(data.chapter_id);
					if (requestId !== loadRequestId) return;
					let preferredIndex = -1;
					if (requestedPageIndex !== null) {
						preferredIndex = sorted.findIndex(
							(readerPage) => readerPage.page_index === requestedPageIndex
						);
					}
					if (preferredIndex < 0 && progress.page_index !== null) {
						preferredIndex = sorted.findIndex(
							(readerPage) => readerPage.page_index === progress.page_index
						);
					}
					currentPageIndex = preferredIndex >= 0 ? preferredIndex : 0;
				} catch {
					if (requestedPageIndex !== null) {
						const requestedIndex = sorted.findIndex(
							(readerPage) => readerPage.page_index === requestedPageIndex
						);
						currentPageIndex = requestedIndex >= 0 ? requestedIndex : 0;
					}
				}
			} catch (cause) {
				if (requestId !== loadRequestId) return;
				reader = null;
				error = cause instanceof Error ? cause.message : $_('reader.failed');
			} finally {
				if (requestId === loadRequestId) {
					isLoading = false;
				}
			}
		})();
	});

	$effect(() => {
		if (pages.length === 0) {
			return;
		}
		scheduleVerticalPageSync();
		const start = Math.max(0, currentPageIndex - 1);
		const end = Math.min(pages.length - 1, currentPageIndex + 2);
		const pageIds: number[] = [];
		for (let idx = start; idx <= end; idx += 1) {
			pageIds.push(pages[idx].id);
		}
		markPagesLoaded(pageIds);
	});

	$effect(() => {
		if (!reader || pages.length === 0) return;
		const readerPage = pages[currentPageIndex];
		if (!readerPage) return;
		const chapterIdForSave = reader.chapter_id;
		if (chapterProgressSaveTimer) {
			clearTimeout(chapterProgressSaveTimer);
		}
		chapterProgressSaveTimer = setTimeout(() => {
			void updateLibraryChapterProgress(chapterIdForSave, {
				page_index: readerPage.page_index
			}).catch(() => {
				// Keep reader responsive even if sync fails.
			});
		}, 300);
		return () => {
			if (chapterProgressSaveTimer) {
				clearTimeout(chapterProgressSaveTimer);
			}
		};
	});

	$effect(() => {
		void isLoading;
		void error;
		void pages.length;
		syncReaderHeaderVisibility();
	});

	$effect(() => {
		if (!showCommentsPanel) return;
		const chapterId = reader?.chapter_id;
		if (!chapterId) return;
		void loadCommentsForChapter(chapterId);
	});

	function resolvePageUrl(readerPage: (typeof pages)[number]): string {
		if (readerPage.local_path) {
			return getLibraryFileUrl(readerPage.local_path);
		}
		return readerPage.src || readerPage.remote_url;
	}

	function formatTimestamp(timestamp: string): string {
		const date = new Date(timestamp);
		if (Number.isNaN(date.getTime())) return timestamp;
		return date.toLocaleString();
	}

	function chapterHref(chapter: number | null): string | null {
		if (!chapter) return null;
		const resolvedTitleId = reader?.library_title_id ?? titleId;
		if (!Number.isFinite(resolvedTitleId) || resolvedTitleId <= 0) return null;
		return withReaderParent(
			buildReaderPath({
				titleId: resolvedTitleId,
				titleName: readerTitleName || `title-${resolvedTitleId}`,
				chapterId: chapter,
				chapterName: null,
				chapterNumber: null
			})
		);
	}

function openChapter(chapter: number | null): void {
	const href = chapterHref(chapter);
	if (!href) return;
	showChapterPanel = false;
	showCommentsPanel = false;
	void goto(href);
}

	function prevPage(): void {
		if (!canPrevPage) return;
		currentPageIndex -= 1;
	}

	function nextPage(): void {
		if (!canNextPage) return;
		currentPageIndex += 1;
	}

	function handleKeydown(event: KeyboardEvent): void {
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

	function resolveReadingStatusId(
		statuses: Awaited<ReturnType<typeof listLibraryStatuses>>
	): number | null {
		const byKey = statuses.find((status) => status.key.toLowerCase() === 'reading');
		if (byKey) return byKey.id;
		const byLabel = statuses.find((status) => status.label.toLowerCase() === 'reading');
		return byLabel?.id ?? null;
	}

	async function bookmarkAsReading(): Promise<void> {
		if (!reader || hasAnyTitleStatus) return;
		bookmarkingReading = true;
		bookmarkError = null;
		try {
			const statuses = await listLibraryStatuses();
			const readingStatusId = resolveReadingStatusId(statuses);
			if (!readingStatusId) {
				throw new Error($_('reader.readingStatusMissing'));
			}
			await updateLibraryTitlePreferences(reader.library_title_id, {
				user_status_id: readingStatusId
			});
			hasAnyTitleStatus = true;
		} catch (cause) {
			bookmarkError = cause instanceof Error ? cause.message : $_('reader.bookmarkFailed');
		} finally {
			bookmarkingReading = false;
		}
	}
</script>

<svelte:head>
	<title>{$_('reader.title')} | {$_('app.name')}</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div
	class="flex flex-col gap-4 pt-16 sm:pt-12"
	role="presentation"
	onpointerdown={handleReaderPointerDown}
	onpointermove={handleReaderPointerMove}
	onpointerup={handleReaderPointerUp}
	onpointercancel={handleReaderPointerCancel}
	onkeydown={handleReaderSurfaceKeydown}
>
	{#if !isTouchDevice}
		<div
			class="fixed inset-x-0 top-0 z-30 h-14"
			role="presentation"
			aria-hidden="true"
			onmouseenter={handleHeaderHoverZoneEnter}
			onmouseleave={handleHeaderHoverZoneLeave}
		></div>
	{/if}

	<div
		bind:this={readerHeaderElement}
		class="fixed inset-x-0 top-0 z-40 border-b border-[var(--line)] bg-[var(--void-0)]/95 px-3 py-2 backdrop-blur transition-all duration-200 {readerHeaderVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'}"
		role="banner"
		onmouseenter={handleHeaderMouseEnter}
		onmouseleave={handleHeaderMouseLeave}
	>
		<div class="mx-auto flex w-full max-w-5xl items-center justify-between gap-2">
			<div class="flex min-w-0 flex-1 items-center gap-2">
				<Button variant="ghost" size="icon-sm" href={canonicalTitlePath ?? '/library'}>
					<Icon name="chevron-left" size={20} />
				</Button>
				<div class="min-w-0">
					<p class="line-clamp-1 text-sm text-[var(--text-muted)]">
						{readerTitleName || $_('reader.title')}
					</p>
					{#if currentChapterMeta?.name}
						<p class="line-clamp-1 text-xs text-[var(--text-ghost)]">{currentChapterMeta.name}</p>
					{/if}
				</div>
			</div>
			<div class="flex shrink-0 items-center gap-1">
				<Button variant="ghost" size="icon-sm" onclick={() => (showChapterPanel = true)} title={$_('reader.openChapters')} aria-label={$_('reader.openChapters')}>
					<Icon name="list" size={16} />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={openCommentsPanel}
					title={$_('reader.openComments')}
					aria-label={$_('reader.openComments')}
				>
					<Icon name="message-square" size={16} />
				</Button>
				{#if !hasAnyTitleStatus}
					<Button
						variant="outline"
						size="sm"
						onclick={bookmarkAsReading}
						disabled={bookmarkingReading || !reader}
					>
						{#if bookmarkingReading}
							<Icon name="loader" size={14} class="animate-spin" />
						{:else}
							<Icon name="plus" size={14} />
						{/if}
						{$_('title.addToLibrary')}
					</Button>
				{/if}
				<Button
					variant={mode === 'vertical' ? 'default' : 'ghost'}
					size="sm"
					class="hidden sm:inline-flex"
					onclick={() => (mode = 'vertical')}
				>
					{$_('reader.vertical')}
				</Button>
				<Button
					variant={mode === 'horizontal' ? 'default' : 'ghost'}
					size="sm"
					class="hidden sm:inline-flex"
					onclick={() => (mode = 'horizontal')}
				>
					{$_('reader.horizontal')}
				</Button>
				{#if pages.length > 0}
					<span class="hidden text-[11px] text-[var(--text-ghost)] sm:inline">
						{currentPageIndex + 1}/{pages.length}
					</span>
				{/if}
			</div>
		</div>
	</div>

	{#if bookmarkError}
		<div
			class="border border-[var(--error)]/20 bg-[var(--error-soft)] px-3 py-2 text-xs text-[var(--error)]"
		>
			{bookmarkError}
		</div>
	{/if}

	{#if isLoading}
		<div class="flex flex-col items-center gap-4 py-20">
			<Icon name="loader" size={24} class="animate-spin text-[var(--text-muted)]" />
			<p class="text-sm text-[var(--text-ghost)]">{$_('common.loading')}</p>
		</div>
	{:else if error}
		<div class="flex flex-col items-center gap-4 py-20 text-center">
			<div
				class="flex h-16 w-16 items-center justify-center border border-[var(--line)] bg-[var(--void-3)]"
			>
				<Icon name="alert-circle" size={24} class="text-[var(--error)]" />
			</div>
			<div>
				<p class="text-[var(--text)]">{$_('reader.failed')}</p>
				<p class="mt-1 text-sm text-[var(--text-ghost)]">{error}</p>
			</div>
		</div>
	{:else if pages.length === 0}
		<div class="flex flex-col items-center gap-4 py-20 text-center">
			<div
				class="flex h-16 w-16 items-center justify-center border border-[var(--line)] bg-[var(--void-3)]"
			>
				<Icon name="file" size={24} class="text-[var(--text-ghost)]" />
			</div>
			<div>
				<p class="text-[var(--text)]">{$_('reader.noPages')}</p>
				<p class="mt-1 text-sm text-[var(--text-ghost)]">{$_('reader.noPagesDescription')}</p>
			</div>
		</div>
	{:else}
		<div class="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--text-muted)]">
			<div class="flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					onclick={() => openChapter(prevChapterId)}
					disabled={!prevChapterId}
				>
					<Icon name="skip-back" size={14} />
					{$_('reader.prevChapter')}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onclick={() => openChapter(nextChapterId)}
					disabled={!nextChapterId}
				>
					{$_('reader.nextChapter')}
					<Icon name="skip-forward" size={14} />
				</Button>
			</div>
			<p class="text-[var(--text-ghost)]">
				{$_('reader.page')}
				{currentPageIndex + 1} / {pages.length}
			</p>
		</div>

		{#if mode === 'vertical'}
			<div class="mx-auto flex w-full max-w-4xl flex-col gap-1">
				{#each pages as readerPage (readerPage.id)}
					<div
						use:lazyLoadPage={{ pageId: readerPage.id }}
						data-reader-page-index={readerPage.page_index}
					>
						{#if loadedPageIds.has(readerPage.id)}
							<img
								src={resolvePageUrl(readerPage)}
								alt="{$_('reader.page')} {readerPage.page_index + 1}"
								decoding="async"
								class="w-full border border-[var(--line)] bg-[var(--void-2)] object-contain"
							/>
						{:else}
							<div class="aspect-[2/3] w-full border border-[var(--line)] bg-[var(--void-2)]"></div>
						{/if}
					</div>
				{/each}
			</div>
		{:else if currentPage}
			<div class="mx-auto flex w-full max-w-4xl flex-col gap-4">
				<img
					src={resolvePageUrl(currentPage)}
					alt="{$_('reader.page')} {currentPage.page_index + 1}"
					class="mx-auto max-h-[calc(100svh-12rem)] w-auto max-w-full border border-[var(--line)] bg-[var(--void-2)] object-contain"
				/>
				<div class="flex items-center justify-between">
					<Button variant="outline" onclick={prevPage} disabled={!canPrevPage}>
						<Icon name="chevron-left" size={16} />
						{$_('reader.prevPage')}
					</Button>
					<Button variant="outline" onclick={nextPage} disabled={!canNextPage}>
						{$_('reader.nextPage')}
						<Icon name="chevron-right" size={16} />
					</Button>
				</div>
			</div>
		{/if}

		<div class="mt-4 flex items-center justify-center gap-2 border-t border-[var(--line)] pt-4">
			<Button
				variant="outline"
				size="sm"
				onclick={() => openChapter(prevChapterId)}
				disabled={!prevChapterId}
			>
				<Icon name="skip-back" size={14} />
				{$_('reader.prevChapter')}
			</Button>
			<Button
				variant="outline"
				size="sm"
				onclick={() => openChapter(nextChapterId)}
				disabled={!nextChapterId}
			>
				{$_('reader.nextChapter')}
				<Icon name="skip-forward" size={14} />
			</Button>
		</div>
	{/if}
</div>

<SlidePanel
	open={showChapterPanel}
	title={$_('reader.chapters')}
	onclose={() => {
		showChapterPanel = false;
	}}
>
	<div class="flex flex-col gap-1">
		{#if chapterList.length === 0}
			<p class="text-sm text-[var(--text-ghost)]">{$_('common.noResults')}</p>
		{:else}
			{#each chapterList as chapter (chapter.id)}
				<button
					type="button"
					class="flex items-center justify-between gap-2 border px-2.5 py-2 text-left text-xs transition-colors {reader?.chapter_id === chapter.id ? 'border-[var(--text)] bg-[var(--void-3)] text-[var(--text)]' : 'border-[var(--line)] bg-[var(--void-2)] text-[var(--text-muted)] hover:border-[var(--void-6)]'}"
					onclick={() => openChapter(chapter.id)}
				>
					<div class="min-w-0 flex-1">
						<p class="truncate font-medium">{chapter.name}</p>
					</div>
					{#if chapter.number !== null}
						<span class="shrink-0 text-[10px] text-[var(--text-ghost)]">#{chapter.number}</span>
					{/if}
				</button>
			{/each}
		{/if}
	</div>
</SlidePanel>

<SlidePanel
	open={showCommentsPanel}
	title={$_('reader.comments')}
	onclose={() => {
		showCommentsPanel = false;
	}}
>
	<div class="flex flex-col gap-3">
		{#if commentsError}
			<p class="text-xs text-[var(--error)]">{commentsError}</p>
		{/if}

		{#if chapterCommentsLoading}
			<div class="flex items-center justify-center py-6">
				<Icon name="loader" size={16} class="animate-spin text-[var(--text-muted)]" />
			</div>
		{:else if sortedChapterComments.length === 0}
			<p class="text-xs text-[var(--text-ghost)]">{$_('reader.noComments')}</p>
		{:else}
			<div class="flex flex-col gap-1.5">
				{#each sortedChapterComments as comment (comment.id)}
					<div class="border border-[var(--line)] bg-[var(--void-2)] px-2.5 py-2">
						<div class="mb-1 flex items-center justify-between gap-2 text-[10px] text-[var(--text-ghost)]">
							<button
								type="button"
								class="truncate text-left hover:text-[var(--text)]"
								onclick={() => jumpToPageIndex(comment.page_index)}
								title={$_('reader.jumpToPage')}
							>
								{$_('reader.page')} {comment.page_index + 1}
							</button>
							<span>{formatTimestamp(comment.created_at)}</span>
						</div>
						<p class="whitespace-pre-wrap text-xs text-[var(--text)]">{comment.message}</p>
						<div class="mt-2 flex items-center justify-end gap-1.5">
							<Button variant="ghost" size="sm" onclick={() => startEditComment(comment)}>
								{$_('common.edit')}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onclick={() => removeComment(comment.id)}
								disabled={deletingCommentId === comment.id}
							>
								{#if deletingCommentId === comment.id}
									<Icon name="loader" size={12} class="animate-spin" />
								{/if}
								{$_('common.delete')}
							</Button>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<div class="border border-[var(--line)] bg-[var(--void-2)] p-2.5">
			<div class="mb-2 flex items-center justify-between gap-2">
				<Button
					variant="ghost"
					size="sm"
					onclick={() => (commentsSortMode = commentsSortMode === 'time' ? 'page' : 'time')}
				>
					<Icon name="clock" size={14} />
					{commentsSortMode === 'time' ? $_('reader.sortByTime') : $_('reader.sortByPage')}
				</Button>
				<div class="flex items-center gap-1.5">
					{#if editingCommentId !== null}
						<Button variant="ghost" size="sm" onclick={startNewComment}>
							{$_('common.cancel')}
						</Button>
					{/if}
					<Button variant="outline" size="sm" onclick={saveComment} disabled={commentSubmitting}>
						{#if commentSubmitting}
							<Icon name="loader" size={14} class="animate-spin" />
						{:else}
							<Icon name="plus" size={14} />
						{/if}
						{$_('reader.comment')}
					</Button>
				</div>
			</div>
			<textarea
				class="min-h-24 w-full border border-[var(--line)] bg-[var(--void-1)] px-2 py-1.5 text-sm text-[var(--text)] focus:border-[var(--void-6)] focus:outline-none"
				placeholder={$_('reader.commentPlaceholder')}
				bind:value={commentDraft}
			></textarea>
			<p class="mt-1 text-[10px] text-[var(--text-ghost)]">
				{$_('reader.commentAutoPage', { values: { page: (currentPage?.page_index ?? 0) + 1 } })}
			</p>
		</div>
	</div>
</SlidePanel>
