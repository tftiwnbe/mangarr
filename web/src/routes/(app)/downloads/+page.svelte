<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { ArrowClockwiseIcon, DownloadIcon, SpinnerIcon, StackIcon } from 'phosphor-svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import { convexApi } from '$lib/convex/api';
	import { Button } from '$lib/elements/button';
	import { _ } from '$lib/i18n';

	type TitleItem = {
		_id: Id<'libraryTitles'>;
		title: string;
		sourcePkg: string;
		sourceLang: string;
		coverUrl?: string | null;
		localCoverPath?: string | null;
		chapterStats: {
			total: number;
			queued: number;
			downloading: number;
			downloaded: number;
			failed: number;
		};
		updatedAt: number;
	};

	type ChapterItem = {
		_id: Id<'libraryChapters'>;
		libraryTitleId: Id<'libraryTitles'>;
		chapterName: string;
		chapterUrl: string;
		chapterNumber?: number;
		downloadStatus: 'missing' | 'queued' | 'downloading' | 'downloaded' | 'failed';
		downloadedPages: number;
		totalPages?: number;
		localRelativePath?: string | null;
		storageKind?: 'directory' | 'archive' | null;
		lastErrorMessage?: string | null;
		title: string;
		titleCoverUrl?: string | null;
		localCoverPath?: string | null;
		updatedAt: number;
	};

	type CommandItem = {
		id: string;
		commandType: string;
		status: string;
		payload?: Record<string, unknown> | null;
		progress?: {
			downloadedPages?: number;
			totalPages?: number;
			percent?: number;
		} | null;
		result?: Record<string, unknown> | null;
		lastErrorMessage?: string | null;
		createdAt: number;
		updatedAt: number;
	};

	const client = useConvexClient();
	const library = useQuery(convexApi.library.listMine, () => ({}));
	const chapters = useQuery(convexApi.library.listAllMineChapters, () => ({}));
	const commands = useQuery(convexApi.commands.listMine, () => ({ limit: 150 }));

	let selectedTitleId = $state<Id<'libraryTitles'> | null>(null);
	let previewChapterId = $state<Id<'libraryChapters'> | null>(null);
	let busyKey = $state<string | null>(null);
	let error = $state<string | null>(null);
	let info = $state<string | null>(null);

	const titles = $derived((library.data ?? []) as TitleItem[]);
	const allChapters = $derived((chapters.data ?? []) as ChapterItem[]);
	const allCommands = $derived((commands.data ?? []) as CommandItem[]);

	$effect(() => {
		if (!selectedTitleId && titles.length > 0) {
			selectedTitleId = titles[0]._id;
		}
		if (selectedTitleId && !titles.some((title) => title._id === selectedTitleId)) {
			selectedTitleId = titles[0]?._id ?? null;
		}
	});

	const selectedTitle = $derived(titles.find((title) => title._id === selectedTitleId) ?? null);
	const selectedTitleChapters = $derived(
		allChapters
			.filter((chapter) => chapter.libraryTitleId === selectedTitleId)
			.sort((left, right) => right.updatedAt - left.updatedAt)
	);

	const activeDownloads = $derived(
		allCommands.filter(
			(command) =>
				command.commandType === 'downloads.chapter' &&
				['queued', 'leased', 'running'].includes(command.status)
		)
	);

	const recentDownloads = $derived(
		allCommands
			.filter((command) => command.commandType === 'downloads.chapter')
			.slice(0, 12)
	);

	const previewChapter = $derived(
		selectedTitleChapters.find((chapter) => chapter._id === previewChapterId) ?? null
	);

	function coverSrc(title: { localCoverPath?: string | null; coverUrl?: string | null }) {
		if (title.localCoverPath) {
			const params = new URLSearchParams({ path: title.localCoverPath });
			return `/api/internal/bridge/library/cover?${params.toString()}`;
		}
		return title.coverUrl ?? '';
	}

	function downloadedPageSrc(chapter: ChapterItem, index: number) {
		if (!chapter.localRelativePath || !chapter.storageKind) return '';
		const params = new URLSearchParams({
			path: chapter.localRelativePath,
			storage: chapter.storageKind,
			index: String(index)
		});
		return `/api/internal/bridge/library/page?${params.toString()}`;
	}

	function downloadedFileHref(chapter: ChapterItem) {
		if (!chapter.localRelativePath || !chapter.storageKind) return '';
		const params = new URLSearchParams({
			path: chapter.localRelativePath,
			storage: chapter.storageKind
		});
		return `/api/internal/bridge/library/file?${params.toString()}`;
	}

	async function syncTitle(titleId: Id<'libraryTitles'>) {
		busyKey = `sync:${titleId}`;
		error = null;
		info = null;
		try {
			await client.mutation(convexApi.library.requestChapterSync, { titleId });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to sync chapters';
		} finally {
			busyKey = null;
		}
	}

	async function queueMissing(titleId: Id<'libraryTitles'>) {
		busyKey = `queue:${titleId}`;
		error = null;
		info = null;
		try {
			await client.mutation(convexApi.library.requestMissingDownloads, { titleId });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to queue missing chapters';
		} finally {
			busyKey = null;
		}
	}

	async function downloadChapter(chapterId: Id<'libraryChapters'>) {
		busyKey = `chapter:${chapterId}`;
		error = null;
		info = null;
		try {
			await client.mutation(convexApi.library.requestChapterDownload, { chapterId });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to start chapter download';
		} finally {
			busyKey = null;
		}
	}

	async function reconcileDownloads(titleId?: Id<'libraryTitles'> | null) {
		busyKey = titleId ? `reconcile:${titleId}` : 'reconcile:all';
		error = null;
		info = null;
		try {
			const response = await fetch('/api/internal/bridge/downloads/reconcile', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify(titleId ? { titleId } : {})
			});
			const payload = (await response.json().catch(() => null)) as
				| { fixed?: number; message?: string }
				| null;
			if (!response.ok) {
				throw new Error(payload?.message ?? 'Unable to scan downloads');
			}
			info = `Scan complete. Fixed ${payload?.fixed ?? 0} chapter records.`;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to scan downloads';
		} finally {
			busyKey = null;
		}
	}

	async function deleteDownloadedFile(chapterId: Id<'libraryChapters'>) {
		busyKey = `delete:${chapterId}`;
		error = null;
		info = null;
		try {
			const response = await fetch('/api/internal/bridge/downloads/delete', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({ chapterId })
			});
			const payload = (await response.json().catch(() => null)) as
				| { deleted?: boolean; message?: string }
				| null;
			if (!response.ok) {
				throw new Error(payload?.message ?? 'Unable to delete downloaded chapter');
			}
			info = payload?.deleted
				? 'Downloaded chapter file removed.'
				: 'No stored file was found for this chapter.';
			if (previewChapterId === chapterId) {
				previewChapterId = null;
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to delete downloaded chapter';
		} finally {
			busyKey = null;
		}
	}
</script>

<svelte:head>
	<title>{$_('nav.downloads')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex items-center gap-3">
		<h1 class="text-display flex-1 text-xl text-[var(--text)]">{$_('nav.downloads').toLowerCase()}</h1>
		<Button size="sm" variant="outline" disabled={busyKey !== null} onclick={() => void reconcileDownloads()}>
			<StackIcon class="size-4" />
			Scan All
		</Button>
	</div>

	{#if error}
		<div class="border border-red-400/50 bg-red-100/80 px-4 py-3 text-sm text-red-900">{error}</div>
	{/if}

	{#if info}
		<div class="border border-emerald-400/50 bg-emerald-100/80 px-4 py-3 text-sm text-emerald-900">
			{info}
		</div>
	{/if}

	<div class="grid gap-6 xl:grid-cols-[0.95fr_1.25fr]">
		<section class="border border-[var(--line)] bg-[var(--surface)] p-4">
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-sm tracking-wider text-[var(--text)] uppercase">Tracked Titles</h2>
				<span class="text-xs text-[var(--text-ghost)]">{titles.length} titles</span>
			</div>

			{#if library.isLoading}
				<p class="text-sm text-[var(--text-ghost)]">Loading library…</p>
			{:else if titles.length === 0}
				<p class="text-sm text-[var(--text-ghost)]">
					Import a title from Explore first. Chapter sync and downloads start from imported titles.
				</p>
			{:else}
				<div class="flex flex-col gap-3">
					{#each titles as title (title._id)}
						<button
							type="button"
							class="grid gap-3 border p-3 text-left transition xl:grid-cols-[4.5rem_1fr] {selectedTitleId ===
							title._id
								? 'border-[var(--accent)] bg-[var(--surface-2)]'
								: 'border-[var(--line)] hover:border-[var(--accent)]/40'}"
							onclick={() => {
								selectedTitleId = title._id;
								previewChapterId = null;
							}}
						>
							{#if coverSrc(title)}
								<img
									src={coverSrc(title)}
									alt={title.title}
									class="h-24 w-18 rounded-sm object-cover"
									loading="lazy"
								/>
							{:else}
								<div class="flex h-24 w-18 items-center justify-center border border-dashed border-[var(--line)] text-xs text-[var(--text-ghost)]">
									No cover
								</div>
							{/if}

							<div class="min-w-0">
								<p class="truncate text-sm text-[var(--text)]">{title.title}</p>
								<p class="mt-1 text-xs text-[var(--text-ghost)]">
									{title.sourcePkg} · {title.sourceLang}
								</p>
								<div class="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--text-muted)]">
									<span>{title.chapterStats.downloaded}/{title.chapterStats.total} downloaded</span>
									<span>{title.chapterStats.queued + title.chapterStats.downloading} active</span>
									<span>{title.chapterStats.failed} failed</span>
									<span>{new Date(title.updatedAt).toLocaleDateString()}</span>
								</div>
								<div class="mt-3 flex flex-wrap gap-2">
									<Button
										size="sm"
										variant="outline"
										disabled={busyKey !== null}
										onclick={(event) => {
											event.stopPropagation();
											void syncTitle(title._id);
										}}
									>
										<ArrowClockwiseIcon class="size-4" />
										Sync
									</Button>
									<Button
										size="sm"
										disabled={busyKey !== null}
										onclick={(event) => {
											event.stopPropagation();
											void queueMissing(title._id);
										}}
									>
										<DownloadIcon class="size-4" />
										Queue Missing
									</Button>
									<Button
										size="sm"
										variant="outline"
										disabled={busyKey !== null}
										onclick={(event) => {
											event.stopPropagation();
											void reconcileDownloads(title._id);
										}}
									>
										<StackIcon class="size-4" />
										Scan Downloads
									</Button>
								</div>
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</section>

		<section class="flex flex-col gap-6">
			<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
				<div class="mb-4 flex items-center justify-between">
					<h2 class="text-sm tracking-wider text-[var(--text)] uppercase">Queue</h2>
					<span class="text-xs text-[var(--text-ghost)]">{activeDownloads.length} active</span>
				</div>

				{#if activeDownloads.length === 0}
					<p class="text-sm text-[var(--text-ghost)]">No active chapter downloads.</p>
				{:else}
					<div class="flex flex-col gap-3">
						{#each activeDownloads as command (command.id)}
							<div class="border border-[var(--line)] p-3">
								<div class="flex items-center justify-between gap-3">
									<div class="min-w-0">
										<p class="truncate text-sm text-[var(--text)]">
											{String(command.payload?.title ?? 'Library title')}
										</p>
										<p class="truncate text-xs text-[var(--text-ghost)]">
											{String(command.payload?.chapterName ?? command.payload?.chapterUrl ?? '')}
										</p>
									</div>
									<span class="text-xs uppercase text-[var(--text-muted)]">{command.status}</span>
								</div>
								{#if command.progress}
									<div class="mt-3">
										<div class="mb-1 flex items-center justify-between text-xs text-[var(--text-ghost)]">
											<span>
												{command.progress.downloadedPages ?? 0}/{command.progress.totalPages ?? 0}
												pages
											</span>
											<span>{command.progress.percent ?? 0}%</span>
										</div>
										<div class="h-2 overflow-hidden rounded-full bg-[var(--line)]">
											<div
												class="h-full bg-[var(--accent)] transition-[width] duration-200"
												style={`width: ${command.progress.percent ?? 0}%`}
											></div>
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
				<div class="mb-4 flex items-center justify-between">
					<div>
						<h2 class="text-sm tracking-wider text-[var(--text)] uppercase">Chapters</h2>
						<p class="mt-1 text-xs text-[var(--text-ghost)]">
							{selectedTitle?.title ?? 'Select a title to manage downloaded chapters'}
						</p>
					</div>
					<span class="text-xs text-[var(--text-ghost)]">{selectedTitleChapters.length} chapters</span>
				</div>

				{#if !selectedTitle}
					<p class="text-sm text-[var(--text-ghost)]">No imported title selected.</p>
				{:else if selectedTitleChapters.length === 0}
					<p class="text-sm text-[var(--text-ghost)]">
						No chapters synced yet. Use “Sync” to fetch chapters from the source.
					</p>
				{:else}
					<div class="grid gap-4 xl:grid-cols-[1fr_18rem]">
						<div class="flex max-h-[38rem] flex-col gap-2 overflow-y-auto pr-1">
							{#each selectedTitleChapters as chapter (chapter._id)}
								<div class="border border-[var(--line)] p-3">
									<div class="flex flex-wrap items-start justify-between gap-3">
										<div class="min-w-0 flex-1">
											<p class="truncate text-sm text-[var(--text)]">{chapter.chapterName}</p>
											<p class="mt-1 text-xs text-[var(--text-ghost)]">
												{chapter.downloadStatus}
												{#if chapter.totalPages}
													· {chapter.downloadedPages}/{chapter.totalPages} pages
												{/if}
											</p>
											{#if chapter.lastErrorMessage}
												<p class="mt-1 text-xs text-red-700">{chapter.lastErrorMessage}</p>
											{/if}
										</div>

										<div class="flex flex-wrap gap-2">
											{#if chapter.downloadStatus !== 'downloaded'}
												<Button
													size="sm"
													disabled={busyKey !== null}
													onclick={() => void downloadChapter(chapter._id)}
												>
													{#if busyKey === `chapter:${chapter._id}`}
														<SpinnerIcon class="size-4 animate-spin" />
													{:else}
														<DownloadIcon class="size-4" />
													{/if}
													Download
												</Button>
											{:else}
												<div class="flex flex-wrap gap-2">
													<Button
														size="sm"
														variant="outline"
														onclick={() => {
															previewChapterId = chapter._id;
														}}
													>
														<StackIcon class="size-4" />
														Preview
													</Button>
													<a
														href={downloadedFileHref(chapter)}
														class="relative inline-flex h-8 items-center justify-center gap-2 border border-[var(--line)] px-3 text-xs font-medium text-[var(--text-soft)] transition-all hover:border-[var(--void-6)] hover:bg-[var(--void-2)] hover:text-[var(--text)] active:bg-[var(--void-3)]"
													>
														<DownloadIcon class="size-4" />
														Export CBZ
													</a>
													<Button
														size="sm"
														variant="outline"
														disabled={busyKey !== null}
														onclick={() => void deleteDownloadedFile(chapter._id)}
													>
														Delete File
													</Button>
												</div>
											{/if}
										</div>
									</div>
								</div>
							{/each}
						</div>

						<div class="border border-[var(--line)] bg-[var(--surface-2)] p-3">
							<h3 class="text-xs tracking-wider text-[var(--text)] uppercase">Downloaded Preview</h3>
							{#if previewChapter && previewChapter.localRelativePath && previewChapter.storageKind}
								<p class="mt-2 text-xs text-[var(--text-ghost)]">{previewChapter.chapterName}</p>
								<img
									src={downloadedPageSrc(previewChapter, 0)}
									alt={`${previewChapter.chapterName} preview`}
									class="mt-3 max-h-[34rem] w-full rounded-sm border border-[var(--line)] object-contain"
									loading="lazy"
								/>
							{:else}
								<p class="mt-2 text-sm text-[var(--text-ghost)]">
									Choose a downloaded chapter to preview its first stored page.
								</p>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
				<div class="mb-4 flex items-center justify-between">
					<h2 class="text-sm tracking-wider text-[var(--text)] uppercase">Recent Download Commands</h2>
					<span class="text-xs text-[var(--text-ghost)]">{recentDownloads.length} recent</span>
				</div>

				{#if recentDownloads.length === 0}
					<p class="text-sm text-[var(--text-ghost)]">No download activity yet.</p>
				{:else}
					<div class="flex flex-col gap-2">
						{#each recentDownloads as command (command.id)}
							<div class="flex items-center justify-between gap-3 border-b border-[var(--line)] pb-2 text-xs">
								<div class="min-w-0">
									<p class="truncate text-[var(--text)]">
										{String(command.payload?.title ?? 'Library title')}
									</p>
									<p class="truncate text-[var(--text-ghost)]">
										{String(command.payload?.chapterName ?? command.payload?.chapterUrl ?? '')}
									</p>
								</div>
								<span
									class:text-red-700={command.status === 'failed' || command.status === 'dead_letter'}
									class:text-[var(--text-muted)]={command.status !== 'failed' && command.status !== 'dead_letter'}
								>
									{command.status}
								</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</section>
	</div>
</div>
