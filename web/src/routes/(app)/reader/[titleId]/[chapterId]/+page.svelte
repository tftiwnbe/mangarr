<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		getLibraryChapterReader,
		getLibraryFileUrl,
		getLibraryTitle,
		listLibraryStatuses,
		listLibraryTitleChapters,
		updateLibraryTitlePreferences,
		type LibraryChapterResource,
		type LibraryReaderChapterResource
	} from '$lib/api/library';
	import { Button } from '$lib/elements/button';
	import { Icon } from '$lib/elements/icon';
	import { _ } from '$lib/i18n';
	import { readerProgressStore } from '$lib/stores/reader-progress';
	import {
		buildReaderPath,
		buildTitlePath,
		inferChapterNumber,
		parseIdFromRouteParam,
		parseReaderChapterParam
	} from '$lib/utils/routes';

	type ReaderMode = 'vertical' | 'horizontal';
	type ChapterMeta = { name: string; number: number | null };

	let mode = $state<ReaderMode>('vertical');
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let reader = $state<LibraryReaderChapterResource | null>(null);
	let readerTitleName = $state('');
	let chapterMetaById = $state<Map<number, ChapterMeta>>(new Map());
	let currentPageIndex = $state(0);
	let loadedPageIds = $state<Set<number>>(new Set());
	let bookmarkingReading = $state(false);
	let bookmarkError = $state<string | null>(null);
	let loadRequestId = 0;

	const titleIdParam = $derived(page.params.titleId);
	const chapterIdParam = $derived(page.params.chapterId);
	const titleId = $derived(parseIdFromRouteParam(titleIdParam) ?? NaN);
	const chapterRef = $derived(parseReaderChapterParam(chapterIdParam));
	const currentChapterMeta = $derived.by(() => {
		if (!reader) return null;
		return chapterMetaById.get(reader.chapter_id) ?? null;
	});
	const canonicalTitlePath = $derived.by(() => {
		const resolvedTitleId = reader?.library_title_id ?? titleId;
		if (!Number.isFinite(resolvedTitleId) || resolvedTitleId <= 0) return null;
		if (!readerTitleName) return `/title/${resolvedTitleId}`;
		return buildTitlePath(resolvedTitleId, readerTitleName);
	});
	const canonicalReaderPath = $derived.by(() => {
		if (!reader || !readerTitleName) return null;
		return buildReaderPath({
			titleId: reader.library_title_id,
			titleName: readerTitleName,
			chapterId: reader.chapter_id,
			chapterName: currentChapterMeta?.name ?? null,
			chapterNumber: currentChapterMeta?.number ?? null
		});
	});

	const pages = $derived.by(() => {
		if (!reader) return [];
		return [...reader.pages].sort((a, b) => a.page_index - b.page_index);
	});

	const currentPage = $derived(pages[currentPageIndex] ?? null);
	const canPrevPage = $derived(currentPageIndex > 0);
	const canNextPage = $derived(currentPageIndex < pages.length - 1);

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
			reader = null;
			error = $_('reader.invalidChapter');
			loadedPageIds = new Set();
			return;
		}

		const requestId = ++loadRequestId;
		isLoading = true;
		error = null;
		readerTitleName = '';
		chapterMetaById = new Map();
		loadedPageIds = new Set();

		void (async () => {
			try {
				let resolvedChapterId = chapterIdFromParam;
				let preloadedChapters: LibraryChapterResource[] | null = null;
				if (resolvedChapterId === null && chapterNumberFromParam !== null) {
					preloadedChapters = await listLibraryTitleChapters(titleIdFromParam);
					chapterMetaById = chapterMetaMap(preloadedChapters);
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
				const savedPage = readerProgressStore.getPage(data.chapter_id);
				const savedIndex =
					savedPage === null
						? -1
						: sorted.findIndex((readerPage) => readerPage.page_index === savedPage);
				currentPageIndex = savedIndex >= 0 ? savedIndex : 0;

				const [titleResult, chaptersResult] = await Promise.allSettled([
					getLibraryTitle(data.library_title_id),
					preloadedChapters
						? Promise.resolve(preloadedChapters)
						: listLibraryTitleChapters(data.library_title_id)
				]);
				if (requestId !== loadRequestId) return;
				if (titleResult.status === 'fulfilled') {
					readerTitleName = titleResult.value.title;
				}
				if (chaptersResult.status === 'fulfilled') {
					chapterMetaById = chapterMetaMap(chaptersResult.value);
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
		if (!canonicalReaderPath) return;
		if (page.url.pathname !== canonicalReaderPath) {
			void goto(canonicalReaderPath, { replaceState: true, noScroll: true });
		}
	});

	$effect(() => {
		if (pages.length === 0) {
			return;
		}
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

		const timeout = window.setTimeout(() => {
			readerProgressStore.setPage(chapterIdForSave, readerPage.page_index);
		}, 250);

		return () => window.clearTimeout(timeout);
	});

	function resolvePageUrl(readerPage: (typeof pages)[number]): string {
		if (readerPage.local_path) {
			return getLibraryFileUrl(readerPage.local_path);
		}
		return readerPage.src || readerPage.remote_url;
	}

	function chapterHref(chapter: number | null): string | null {
		if (!chapter) return null;
		const chapterMeta = chapterMetaById.get(chapter);
		const resolvedTitleId = reader?.library_title_id ?? titleId;
		if (!Number.isFinite(resolvedTitleId) || resolvedTitleId <= 0) return null;
		return buildReaderPath({
			titleId: resolvedTitleId,
			titleName: readerTitleName || `title-${resolvedTitleId}`,
			chapterId: chapter,
			chapterName: chapterMeta?.name ?? null,
			chapterNumber: chapterMeta?.number ?? null
		});
	}

	function openChapter(chapter: number | null): void {
		const href = chapterHref(chapter);
		if (!href) return;
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
		if (!reader) return;
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

<div class="flex flex-col gap-4">
	<!-- Header -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex items-center gap-2">
			<Button variant="ghost" size="icon-sm" href={canonicalTitlePath ?? '/library'}>
				<Icon name="chevron-left" size={20} />
			</Button>
			<div>
				<p class="line-clamp-1 text-sm text-[var(--text-muted)]">
					{readerTitleName || $_('reader.title')}
				</p>
				{#if currentChapterMeta?.name}
					<p class="line-clamp-1 text-xs text-[var(--text-ghost)]">{currentChapterMeta.name}</p>
				{/if}
			</div>
		</div>
		<div class="flex items-center gap-1">
			<Button
				variant="outline"
				size="sm"
				onclick={bookmarkAsReading}
				disabled={bookmarkingReading || !reader}
			>
				{#if bookmarkingReading}
					<Icon name="loader" size={14} class="animate-spin" />
				{:else}
					<Icon name="book" size={14} />
				{/if}
				{$_('reader.bookmarkReading')}
			</Button>
			<Button
				variant={mode === 'vertical' ? 'default' : 'ghost'}
				size="sm"
				onclick={() => (mode = 'vertical')}
			>
				{$_('reader.vertical')}
			</Button>
			<Button
				variant={mode === 'horizontal' ? 'default' : 'ghost'}
				size="sm"
				onclick={() => (mode = 'horizontal')}
			>
				{$_('reader.horizontal')}
			</Button>
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
		<!-- Navigation -->
		<div class="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--text-muted)]">
			<div class="flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					onclick={() => openChapter(reader?.prev_chapter_id ?? null)}
					disabled={!reader?.prev_chapter_id}
				>
					<Icon name="skip-back" size={14} />
					{$_('reader.prevChapter')}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onclick={() => openChapter(reader?.next_chapter_id ?? null)}
					disabled={!reader?.next_chapter_id}
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
			<!-- Vertical scroll mode -->
			<div class="mx-auto flex w-full max-w-4xl flex-col gap-1">
				{#each pages as readerPage (readerPage.id)}
					<div use:lazyLoadPage={{ pageId: readerPage.id }}>
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
			<!-- Horizontal page mode -->
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

		<!-- Chapter navigation at bottom -->
		<div class="mt-4 flex items-center justify-center gap-2 border-t border-[var(--line)] pt-4">
			<Button
				variant="outline"
				size="sm"
				onclick={() => openChapter(reader?.prev_chapter_id ?? null)}
				disabled={!reader?.prev_chapter_id}
			>
				<Icon name="skip-back" size={14} />
				{$_('reader.prevChapter')}
			</Button>
			<Button
				variant="outline"
				size="sm"
				onclick={() => openChapter(reader?.next_chapter_id ?? null)}
				disabled={!reader?.next_chapter_id}
			>
				{$_('reader.nextChapter')}
				<Icon name="skip-forward" size={14} />
			</Button>
		</div>
	{/if}
</div>
