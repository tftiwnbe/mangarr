<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { CaretLeftIcon, ClockIcon, SpinnerIcon, WarningCircleIcon } from 'phosphor-svelte';

	import { convexApi } from '$lib/convex/api';
	import { waitForCommand } from '$lib/client/commands';
	import { Button } from '$lib/elements/button';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { _ } from '$lib/i18n';
	import {
		formatChapterNumberValue,
		hasDisplayableChapterNumber,
		parseStructuredChapterName
	} from '$lib/utils/chapter-display';
	import { buildTitlePath } from '$lib/utils/routes';
	import { TITLE_STATUS } from '$lib/utils/title-status';

	type SourceItem = {
		id: string;
		name: string;
		lang: string;
		supportsLatest: boolean;
		enabled?: boolean;
		extensionName: string;
		extensionPkg: string;
	};

	type PreviewDetail = {
		sourceId: string;
		titleUrl: string;
		sourcePkg?: string | null;
		sourceLang?: string | null;
		title: string;
		author?: string | null;
		artist?: string | null;
		description?: string | null;
		coverUrl?: string | null;
		genre?: string | null;
		status?: number | null;
		fetchedAt?: number | null;
	};

	type PreviewChapter = {
		url: string;
		name: string;
		dateUpload?: number | null;
		chapterNumber?: number | null;
		scanlator?: string | null;
	};

	const client = useConvexClient();
	const sourcesQuery = useQuery(convexApi.extensions.listSources, () => ({}));

	let sourceId = $state('');
	let sourcePkg = $state('');
	let sourceLang = $state('');
	let titleUrl = $state('');
	let canonicalKey = $state('');
	let fallbackTitle = $state('');
	let fallbackThumbnailUrl = $state('');

	let loading = $state(true);
	let adding = $state(false);
	let error = $state<string | null>(null);
	let chaptersError = $state<string | null>(null);
	let detail = $state<PreviewDetail | null>(null);
	let chapters = $state<PreviewChapter[]>([]);

	const sources = $derived((sourcesQuery.data ?? []) as SourceItem[]);
	const source = $derived(sources.find((item) => item.id === sourceId) ?? null);
	const coverSrc = $derived(detail?.coverUrl?.trim() || fallbackThumbnailUrl || null);
	const displayTitle = $derived(detail?.title?.trim() || fallbackTitle || titleUrl);
	const genres = $derived.by(() =>
		String(detail?.genre ?? '')
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean)
	);
	const displayStatus = $derived.by(() => {
		const status = Number(detail?.status ?? 0);
		if (status === TITLE_STATUS.ONGOING) return $_('status.ongoing');
		if (status === TITLE_STATUS.COMPLETED || status === TITLE_STATUS.COMPLETED_ALT) {
			return $_('status.completed');
		}
		if (status === TITLE_STATUS.HIATUS) return $_('status.hiatus');
		return '';
	});
	const chapterCountLabel = $derived(
		$_('title.chapterCount', {
			values: {
				count: chapters.length
			}
		})
	);

	function readParams() {
		sourceId = page.url.searchParams.get('source_id')?.trim() ?? '';
		sourcePkg = page.url.searchParams.get('source_pkg')?.trim() ?? '';
		sourceLang = page.url.searchParams.get('source_lang')?.trim() ?? '';
		titleUrl = page.url.searchParams.get('title_url')?.trim() ?? '';
		canonicalKey = page.url.searchParams.get('canonical_key')?.trim() ?? '';
		fallbackTitle = page.url.searchParams.get('title')?.trim() ?? '';
		fallbackThumbnailUrl = page.url.searchParams.get('thumbnail_url')?.trim() ?? '';
	}

	function chapterLabel(chapter: PreviewChapter): string {
		if (hasDisplayableChapterNumber(chapter.chapterNumber)) {
			return $_('chapter.chapterShort', {
				values: { number: formatChapterNumberValue(chapter.chapterNumber) }
			});
		}
		const parsed = parseStructuredChapterName(chapter.name);
		if (!parsed) return chapter.name;
		const parts: string[] = [];
		if (parsed.volumeNumber) {
			parts.push($_('chapter.volumeShort', { values: { number: parsed.volumeNumber } }));
		}
		if (parsed.chapterNumber) {
			parts.push($_('chapter.chapterShort', { values: { number: parsed.chapterNumber } }));
		}
		return parts.join(' · ') || chapter.name;
	}

	function chapterDetail(chapter: PreviewChapter): string | null {
		const raw = chapter.name.trim();
		if (!raw) return null;
		if (hasDisplayableChapterNumber(chapter.chapterNumber)) {
			const chapterShort = $_('chapter.chapterShort', {
				values: { number: formatChapterNumberValue(chapter.chapterNumber) }
			});
			return raw === chapterShort ? null : raw;
		}
		return parseStructuredChapterName(raw)?.detail ?? raw;
	}

	function formatDate(value?: number | null): string {
		if (!value) return '';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		return date.toLocaleDateString();
	}

	function mergeDetail(next: Partial<PreviewDetail>) {
		detail = {
			sourceId,
			titleUrl,
			sourcePkg,
			sourceLang,
			title: fallbackTitle || titleUrl,
			...detail,
			...next
		};
	}

	function requireValidParams(): boolean {
		if (!sourceId || !titleUrl) {
			void goto('/explore', { replaceState: true });
			return false;
		}
		return true;
	}

	async function loadTitleDetails(force = false) {
		if (!requireValidParams()) return;
		const cached = await client.query(convexApi.library.getExploreTitlePreview, {
			sourceId,
			titleUrl
		});
		if (cached) {
			mergeDetail(cached);
		}
		const shouldFetch =
			force ||
			!cached ||
			!String(cached.description ?? '').trim() ||
			!String(cached.author ?? '').trim() ||
			!String(cached.genre ?? '').trim();
		if (!shouldFetch) {
			return;
		}

		const { commandId } = await client.mutation(convexApi.commands.enqueueExploreTitleFetch, {
			sourceId,
			titleUrl,
			contextKey: canonicalKey || 'preview'
		});
		const command = await waitForCommand(client, commandId, {
			timeoutMs: 20_000,
			pollIntervalMs: 300
		});
		const resolved = command.result?.title as PreviewDetail | undefined;
		if (!resolved) {
			throw new Error('Title details were not returned');
		}
		mergeDetail({
			sourceId,
			titleUrl,
			sourcePkg: resolved.sourcePkg ?? sourcePkg,
			sourceLang: resolved.sourceLang ?? sourceLang,
			title: resolved.title,
			author: resolved.author ?? null,
			artist: resolved.artist ?? null,
			description: resolved.description ?? null,
			coverUrl: resolved.coverUrl ?? null,
			genre: resolved.genre ?? null,
			status: resolved.status ?? null,
			fetchedAt: Date.now()
		});
	}

	async function loadChapters(force = false) {
		if (!requireValidParams()) return;
		if (!force && chapters.length > 0) {
			return;
		}
		const { commandId } = await client.mutation(convexApi.commands.enqueueExploreChaptersFetch, {
			sourceId,
			titleUrl,
			contextKey: canonicalKey || 'preview'
		});
		const command = await waitForCommand(client, commandId, {
			timeoutMs: 20_000,
			pollIntervalMs: 300
		});
		const resolved = (command.result?.chapters as PreviewChapter[] | undefined) ?? [];
		chapters = resolved;
	}

	async function loadPreview(force = false): Promise<void> {
		readParams();
		if (!requireValidParams()) return;

		loading = true;
		error = null;
		chaptersError = null;
		detail = {
			sourceId,
			titleUrl,
			sourcePkg,
			sourceLang,
			title: fallbackTitle || titleUrl,
			coverUrl: fallbackThumbnailUrl || null
		};
		chapters = force ? [] : chapters;

		try {
			const existing = await client.query(convexApi.library.findMineBySource, {
				canonicalKey,
				sourceId,
				titleUrl
			});
			if (existing?._id) {
				await goto(buildTitlePath(String(existing._id), existing.title || fallbackTitle || titleUrl), {
					replaceState: true
				});
				return;
			}

			const [detailsResult, chaptersResult] = await Promise.allSettled([
				loadTitleDetails(force),
				loadChapters(force)
			]);

			if (detailsResult.status === 'rejected' && !String(detail?.title ?? '').trim()) {
				throw detailsResult.reason;
			}
			if (chaptersResult.status === 'rejected') {
				chaptersError =
					chaptersResult.reason instanceof Error
						? chaptersResult.reason.message
						: $_('title.failedToLoadVariantChapters');
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to open title';
		} finally {
			loading = false;
		}
	}

	async function addToLibrary() {
		if (adding || !requireValidParams()) return;
		adding = true;
		error = null;
		try {
			const { commandId } = await client.mutation(convexApi.commands.enqueueLibraryImport, {
				canonicalKey: canonicalKey || `${sourceId}:${titleUrl}`,
				sourceId,
				sourcePkg: sourcePkg || detail?.sourcePkg || source?.extensionPkg || '',
				sourceLang: sourceLang || detail?.sourceLang || source?.lang || '',
				titleUrl
			});
			const command = await waitForCommand(client, commandId, {
				timeoutMs: 25_000,
				pollIntervalMs: 300
			});
			const titleId = String(command.result?.titleId ?? '');
			if (!titleId) {
				throw new Error('Import completed without a title id');
			}
			await goto(buildTitlePath(titleId, detail?.title || fallbackTitle || titleUrl));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : $_('title.notFound');
		} finally {
			adding = false;
		}
	}

	onMount(() => {
		void loadPreview();
	});
</script>

<svelte:head>
	<title>{displayTitle || $_('common.loading')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col">
	<div class="mb-6 hidden items-center gap-2 md:flex">
		<Button variant="ghost" size="icon-sm" onclick={() => goto('/explore')}>
			<CaretLeftIcon size={18} />
		</Button>
		<span class="text-xs text-[var(--text-ghost)]">{$_('nav.explore')}</span>
	</div>

	{#if loading}
		<div class="flex min-h-[40svh] items-center justify-center">
			<SpinnerIcon size={20} class="animate-spin text-[var(--text-ghost)]" />
		</div>
	{:else if error}
		<div class="flex min-h-[40svh] flex-col items-center justify-center gap-4 px-6 text-center">
			<WarningCircleIcon size={24} class="text-[var(--text-ghost)]" />
			<div>
				<p class="text-sm text-[var(--text-muted)]">{error}</p>
			</div>
			<div class="flex items-center gap-2">
				<Button variant="outline" size="sm" onclick={() => void loadPreview(true)}>
					{$_('common.retry')}
				</Button>
				<Button variant="ghost" size="sm" onclick={() => goto('/explore')}>
					{$_('nav.explore')}
				</Button>
			</div>
		</div>
	{:else}
		<div class="md:grid md:grid-cols-[260px_1fr] md:gap-8">
			<div class="flex flex-col gap-3">
				<div class="overflow-hidden border border-[var(--void-3)] bg-[var(--void-1)] md:aspect-[2/3]">
					{#if coverSrc}
						<LazyImage src={coverSrc} alt={displayTitle} class="h-full w-full object-cover" />
					{:else}
						<div class="flex h-full min-h-[320px] items-center justify-center text-sm text-[var(--text-ghost)]">
							{$_('title.noDescription')}
						</div>
					{/if}
				</div>
				<Button onclick={() => void addToLibrary()} loading={adding} disabled={adding}>
					{$_('preview.addToLibrary')}
				</Button>
			</div>

			<div class="mt-6 flex flex-col gap-5 md:mt-0">
				<div class="flex flex-col gap-2">
					<h1 class="text-3xl font-semibold text-[var(--text)]">{displayTitle}</h1>
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--text-muted)]">
						<span>{detail?.author?.trim() || detail?.artist?.trim() || source?.name || sourceId}</span>
						{#if displayStatus}
							<span>{displayStatus}</span>
						{/if}
						<span>{chapterCountLabel}</span>
					</div>
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-ghost)]">
						<span>{source?.name || sourceId}</span>
						{#if detail?.fetchedAt}
							<span class="inline-flex items-center gap-1">
								<ClockIcon size={12} />
								{new Date(detail.fetchedAt).toLocaleString()}
							</span>
						{/if}
					</div>
				</div>

				{#if genres.length > 0}
					<div class="flex flex-col gap-2">
						<h2 class="text-xs uppercase tracking-[0.24em] text-[var(--text-ghost)]">
							{$_('title.genres')}
						</h2>
						<div class="flex flex-wrap gap-2">
							{#each genres as genre (genre)}
								<span class="border border-[var(--void-4)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
									{genre}
								</span>
							{/each}
						</div>
					</div>
				{/if}

				<div class="grid gap-3 text-sm text-[var(--text-muted)] md:grid-cols-2">
					{#if detail?.author?.trim()}
						<div>
							<p class="text-xs uppercase tracking-[0.18em] text-[var(--text-ghost)]">
								{$_('title.author')}
							</p>
							<p class="mt-1">{detail.author}</p>
						</div>
					{/if}
					{#if detail?.artist?.trim()}
						<div>
							<p class="text-xs uppercase tracking-[0.18em] text-[var(--text-ghost)]">
								{$_('title.artist')}
							</p>
							<p class="mt-1">{detail.artist}</p>
						</div>
					{/if}
				</div>

				<div class="flex flex-col gap-2">
					<h2 class="text-xs uppercase tracking-[0.24em] text-[var(--text-ghost)]">
						{$_('title.description')}
					</h2>
					<p class="whitespace-pre-wrap text-sm leading-6 text-[var(--text-muted)]">
						{detail?.description?.trim() || $_('preview.noDescriptionHint')}
					</p>
				</div>

				<div class="flex flex-col gap-3">
					<div class="flex items-center justify-between gap-3">
						<h2 class="text-xs uppercase tracking-[0.24em] text-[var(--text-ghost)]">
							{$_('title.chapters')}
						</h2>
						{#if chaptersError}
							<Button variant="ghost" size="sm" onclick={() => void loadChapters(true)}>
								{$_('common.retry')}
							</Button>
						{/if}
					</div>

					{#if chaptersError}
						<p class="text-sm text-[var(--error)]">{chaptersError}</p>
					{:else if chapters.length === 0}
						<p class="text-sm text-[var(--text-ghost)]">{$_('title.noChaptersDescription')}</p>
					{:else}
						<div class="flex flex-col divide-y divide-[var(--void-3)] border border-[var(--void-3)]">
							{#each chapters as chapter (`${chapter.url}:${chapter.name}`)}
								<div class="px-4 py-3">
									<div class="flex flex-wrap items-center justify-between gap-3">
										<div class="min-w-0">
											<p class="truncate text-sm text-[var(--text)]">{chapterLabel(chapter)}</p>
											{#if chapterDetail(chapter)}
												<p class="mt-1 truncate text-xs text-[var(--text-muted)]">
													{chapterDetail(chapter)}
												</p>
											{/if}
										</div>
										<div class="text-right text-xs text-[var(--text-ghost)]">
											{#if chapter.dateUpload}
												<p>{formatDate(chapter.dateUpload)}</p>
											{/if}
											{#if chapter.scanlator}
												<p class="truncate">{chapter.scanlator}</p>
											{/if}
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
