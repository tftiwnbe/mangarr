<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import {
		BookOpenIcon,
		CompassIcon,
		MagnifyingGlassIcon,
		SpinnerIcon,
		StackIcon,
		ImagesIcon
	} from 'phosphor-svelte';

	import { convexApi } from '$lib/convex/api';
	import { Button } from '$lib/elements/button';
	import { Input } from '$lib/elements/input';
	import { Select } from '$lib/elements/select';
	import { Tabs } from '$lib/elements/tabs';
	import { _ } from '$lib/i18n';

	type SourceItem = {
		id: string;
		name: string;
		lang: string;
		supportsLatest: boolean;
		extensionName: string;
		extensionPkg: string;
	};

	type SearchItem = {
		canonicalKey: string;
		sourceId: string;
		sourcePkg: string;
		sourceLang: string;
		sourceName: string;
		titleUrl: string;
		title: string;
		description?: string;
		coverUrl?: string | null;
	};

	type ChapterItem = {
		url: string;
		name: string;
		dateUpload: number;
		chapterNumber: number;
		scanlator?: string;
	};

	type PageItem = {
		index: number;
		url: string;
		imageUrl: string;
	};

	type CommandItem = {
		id: string;
		commandType: string;
		status: string;
		payload?: Record<string, unknown> | null;
		result?: Record<string, unknown> | null;
		lastErrorMessage?: string | null;
	};

	const client = useConvexClient();
	const commands = useQuery(convexApi.commands.listMine, () => ({ limit: 150 }));
	const sources = useQuery(convexApi.extensions.listSources, () => ({}));

	const browseTabs = [
		{ value: 'search', label: 'Search' },
		{ value: 'popular', label: 'Popular' },
		{ value: 'latest', label: 'Latest' }
	];

	let browseMode = $state('search');
	let query = $state('');
	let selectedSourceId = $state('');
	let busyKey = $state<string | null>(null);
	let error = $state<string | null>(null);
	let selectedTitle = $state<SearchItem | null>(null);
	let selectedChapterUrl = $state<string | null>(null);

	const installedSources = $derived((sources.data ?? []) as SourceItem[]);
	const allCommands = $derived((commands.data ?? []) as CommandItem[]);
	const sourceOptions = $derived(
		[
			{ value: 'all', label: 'All installed sources' },
			...installedSources.map((source) => ({
				value: source.id,
				label: `${source.extensionName} · ${source.name} (${source.lang})`
			}))
		]
	);

	$effect(() => {
		if (!selectedSourceId) {
			selectedSourceId = installedSources[0]?.id ?? 'all';
		}
	});

	const latestSearchResult = $derived.by(() =>
		findLatestResult<SearchItem[]>('explore.search', (item) => {
			if (browseMode !== 'search') return false;
			const payload = item.payload ?? {};
			const payloadSourceId = String(payload.sourceId ?? 'all');
			const currentSourceId = selectedSourceId || 'all';
			return payloadSourceId === currentSourceId || (currentSourceId === 'all' && !payload.sourceId);
		})
	);

	const latestFeedResult = $derived.by(() =>
		findLatestResult<SearchItem[]>(browseMode === 'popular' ? 'explore.popular' : 'explore.latest', (item) => {
			if (browseMode !== 'popular' && browseMode !== 'latest') return false;
			return String(item.payload?.sourceId ?? '') === selectedSourceId;
		})
	);

const selectedTitleDetails = $derived.by(() => {
		const currentTitle = selectedTitle;
		if (!currentTitle) return null;
		return findLatestSingleResult('explore.title.fetch', (item) => {
			const payload = item.payload ?? {};
			return (
				String(payload.sourceId ?? '') === currentTitle.sourceId &&
				String(payload.titleUrl ?? '') === currentTitle.titleUrl
			);
		}) as { title?: SearchItem } | null;
	});

const selectedTitleChapters = $derived.by(() => {
		const currentTitle = selectedTitle;
		if (!currentTitle) return [] as ChapterItem[];
		return (
			findLatestSingleResult('explore.chapters.fetch', (item) => {
				const payload = item.payload ?? {};
				return (
					String(payload.sourceId ?? '') === currentTitle.sourceId &&
					String(payload.titleUrl ?? '') === currentTitle.titleUrl
				);
			})?.chapters ?? []
		) as ChapterItem[];
	});

const selectedChapterPages = $derived.by(() => {
		const currentTitle = selectedTitle;
		if (!currentTitle || !selectedChapterUrl) return [] as PageItem[];
		return (
			findLatestSingleResult('reader.pages.fetch', (item) => {
				const payload = item.payload ?? {};
				return (
					String(payload.sourceId ?? '') === currentTitle.sourceId &&
					String(payload.chapterUrl ?? '') === selectedChapterUrl
				);
			})?.pages ?? []
		) as PageItem[];
	});

	function findLatestResult<T>(
		commandType: string,
		match: (item: CommandItem) => boolean
	): T {
		for (const item of allCommands) {
			if (item.commandType !== commandType || item.status !== 'succeeded') continue;
			if (!match(item)) continue;
			const result = item.result as { items?: T } | null;
			return (result?.items ?? ([] as unknown as T)) as T;
		}
		return [] as unknown as T;
	}

	function findLatestSingleResult(
		commandType: string,
		match: (item: CommandItem) => boolean
	): Record<string, unknown> | null {
		for (const item of allCommands) {
			if (item.commandType !== commandType || item.status !== 'succeeded') continue;
			if (!match(item)) continue;
			return item.result ?? null;
		}
		return null;
	}

	function currentResults() {
		return browseMode === 'search' ? latestSearchResult : latestFeedResult;
	}

	function readerPageSrc(page: PageItem) {
		if (!selectedTitle || !selectedChapterUrl) {
			return page.imageUrl;
		}
		const params = new URLSearchParams({
			sourceId: selectedTitle.sourceId,
			chapterUrl: selectedChapterUrl,
			index: String(page.index)
		});
		return `/api/internal/bridge/reader/page?${params.toString()}`;
	}

	async function enqueue(
		commandType: string,
		payload: Record<string, unknown>,
		busy: string
	) {
		busyKey = busy;
		error = null;
		try {
			await client.mutation(convexApi.commands.enqueue, { commandType, payload });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to queue command';
		} finally {
			busyKey = null;
		}
	}

	async function runBrowse(event?: SubmitEvent) {
		event?.preventDefault();
		const currentSourceId = selectedSourceId || 'all';
		if (browseMode === 'search') {
			const value = query.trim();
			if (!value) return;
			await enqueue(
				'explore.search',
				{
					query: value,
					limit: 40,
					...(currentSourceId !== 'all' ? { sourceId: currentSourceId } : {})
				},
				'explore-search'
			);
			return;
		}

		if (currentSourceId === 'all') {
			error = 'Select a source for popular or latest feeds';
			return;
		}

		await enqueue(
			browseMode === 'popular' ? 'explore.popular' : 'explore.latest',
			{
				sourceId: currentSourceId,
				page: 1,
				limit: 40
			},
			`feed:${browseMode}:${currentSourceId}`
		);
	}

	async function openTitle(item: SearchItem) {
		selectedTitle = item;
		selectedChapterUrl = null;
		await Promise.all([
			enqueue(
				'explore.title.fetch',
				{ sourceId: item.sourceId, titleUrl: item.titleUrl },
				`title:${item.canonicalKey}`
			),
			enqueue(
				'explore.chapters.fetch',
				{ sourceId: item.sourceId, titleUrl: item.titleUrl },
				`chapters:${item.canonicalKey}`
			)
		]);
	}

	async function openChapter(chapterUrl: string) {
		if (!selectedTitle) return;
		selectedChapterUrl = chapterUrl;
		await enqueue(
			'reader.pages.fetch',
			{ sourceId: selectedTitle.sourceId, chapterUrl },
			`pages:${selectedTitle.canonicalKey}:${chapterUrl}`
		);
	}

	async function importTitle(item: SearchItem) {
		await enqueue(
			'library.import',
			{
				canonicalKey: item.canonicalKey,
				sourceId: item.sourceId,
				sourcePkg: item.sourcePkg,
				sourceLang: item.sourceLang,
				titleUrl: item.titleUrl
			},
			`import:${item.canonicalKey}`
		);
	}
</script>

<svelte:head>
	<title>{$_('nav.explore')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex items-center gap-3">
		<h1 class="text-display flex-1 text-xl text-[var(--text)]">{$_('nav.explore').toLowerCase()}</h1>
	</div>

	<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
		<div class="mb-4 flex flex-wrap items-center gap-4">
			<Tabs tabs={browseTabs} value={browseMode} onValueChange={(value) => (browseMode = value)} />
			<div class="min-w-[18rem] flex-1">
				<Select
					value={selectedSourceId}
					options={sourceOptions}
					placeholder="Choose a source"
					onValueChange={(value) => {
						selectedSourceId = value;
						if (browseMode !== 'search') {
							void runBrowse();
						}
					}}
				/>
			</div>
		</div>

		<form class="flex items-end gap-3" onsubmit={runBrowse}>
			<div class="relative flex-1">
				<div class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-ghost)]">
					{#if browseMode === 'search'}
						<MagnifyingGlassIcon size={14} />
					{:else if browseMode === 'popular'}
						<CompassIcon size={14} />
					{:else}
						<StackIcon size={14} />
					{/if}
				</div>
				<Input
					type="search"
					label={browseMode === 'search' ? 'Search titles' : browseMode === 'popular' ? 'Popular titles' : 'Latest titles'}
					bind:value={query}
					placeholder={browseMode === 'search'
						? 'Find manga by title...'
						: 'Run feed for the selected source'}
					class="pl-9"
					disabled={browseMode !== 'search'}
				/>
			</div>
			<Button
				type="submit"
				size="sm"
				disabled={busyKey?.startsWith('explore-search') || (browseMode === 'search' && !query.trim())}
			>
				{#if busyKey}
					<SpinnerIcon size={12} class="animate-spin" />
				{:else if browseMode === 'search'}
					Search
				{:else if browseMode === 'popular'}
					Load popular
				{:else}
					Load latest
				{/if}
			</Button>
		</form>
	</div>

	{#if error}
		<p class="text-sm text-[var(--error)]">{error}</p>
	{/if}

	<div class="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
		<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
			<h2 class="mb-3 text-sm tracking-wider text-[var(--text)] uppercase">
				{browseMode === 'search' ? 'Results' : browseMode === 'popular' ? 'Popular' : 'Latest'}
			</h2>
			{#if commands.isLoading}
				<p class="text-sm text-[var(--text-ghost)]">Loading commands…</p>
			{:else if currentResults().length === 0}
				<p class="text-sm text-[var(--text-ghost)]">
					{browseMode === 'search'
						? 'Run a source-backed search to populate results.'
						: 'Run the selected source feed to populate results.'}
				</p>
			{:else}
				<div class="flex flex-col gap-3">
					{#each currentResults() as item (item.canonicalKey)}
						<div class="border border-[var(--line)] p-3">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0 flex-1">
									<p class="line-clamp-1 text-sm text-[var(--text)]">{item.title}</p>
									<p class="mt-1 line-clamp-2 text-xs text-[var(--text-ghost)]">{item.description}</p>
									<p class="mt-2 text-[10px] uppercase text-[var(--text-muted)]">
										{item.sourceName} · {item.sourceLang}
									</p>
								</div>
								<div class="flex flex-col gap-2">
									<Button size="sm" onclick={() => openTitle(item)}>Open</Button>
									<Button
										size="sm"
										disabled={busyKey === `import:${item.canonicalKey}`}
										onclick={() => importTitle(item)}
									>
										{busyKey === `import:${item.canonicalKey}` ? 'Queuing…' : 'Import'}
									</Button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="flex flex-col gap-4">
			<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
				<div class="mb-3 flex items-center gap-2 text-[var(--text)]">
					<BookOpenIcon size={16} />
					<h2 class="text-sm tracking-wider uppercase">Title Details</h2>
				</div>
				{#if !selectedTitle}
					<p class="text-sm text-[var(--text-ghost)]">Open a title from results to inspect details and chapters.</p>
				{:else}
					{@const details = selectedTitleDetails?.title ?? selectedTitle}
					<div class="flex flex-col gap-3">
						{#if details.coverUrl}
							<img
								src={details.coverUrl}
								alt={details.title}
								class="h-48 w-32 object-cover"
								loading="lazy"
							/>
						{/if}
						<div>
							<p class="text-base text-[var(--text)]">{details.title}</p>
							<p class="mt-1 text-xs uppercase text-[var(--text-muted)]">
								{details.sourceName ?? selectedTitle.sourceName} · {details.sourceLang ?? selectedTitle.sourceLang}
							</p>
						</div>
						<p class="text-sm text-[var(--text-ghost)]">{details.description || 'No description available.'}</p>
					</div>
				{/if}
			</div>

			<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
				<div class="mb-3 flex items-center gap-2 text-[var(--text)]">
					<StackIcon size={16} />
					<h2 class="text-sm tracking-wider uppercase">Chapters</h2>
				</div>
				{#if !selectedTitle}
					<p class="text-sm text-[var(--text-ghost)]">Choose a title to load chapters.</p>
				{:else if selectedTitleChapters.length === 0}
					<p class="text-sm text-[var(--text-ghost)]">No chapters loaded yet.</p>
				{:else}
					<div class="max-h-72 overflow-y-auto">
						<div class="flex flex-col gap-2">
							{#each selectedTitleChapters as chapter (chapter.url)}
								<button
									type="button"
									class="border border-[var(--line)] p-3 text-left transition-colors {selectedChapterUrl === chapter.url
										? 'bg-[var(--void-2)] text-[var(--text)]'
										: 'text-[var(--text-ghost)] hover:bg-[var(--void-2)] hover:text-[var(--text)]'}"
									onclick={() => openChapter(chapter.url)}
								>
									<p class="text-sm">{chapter.name || `Chapter ${chapter.chapterNumber}`}</p>
									<p class="mt-1 text-xs uppercase text-[var(--text-muted)]">
										{chapter.scanlator || 'Unknown scanlator'}
									</p>
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
				<div class="mb-3 flex items-center gap-2 text-[var(--text)]">
					<ImagesIcon size={16} />
					<h2 class="text-sm tracking-wider uppercase">Pages</h2>
				</div>
				{#if !selectedChapterUrl}
					<p class="text-sm text-[var(--text-ghost)]">Open a chapter to render pages.</p>
				{:else if selectedChapterPages.length === 0}
					<p class="text-sm text-[var(--text-ghost)]">No pages loaded yet.</p>
				{:else}
					<div class="flex max-h-[36rem] flex-col gap-4 overflow-y-auto">
						{#each selectedChapterPages as page (page.index)}
							<div class="flex flex-col gap-2">
								<p class="text-[10px] uppercase text-[var(--text-muted)]">Page {page.index + 1}</p>
								<img
									src={readerPageSrc(page)}
									alt={`Page ${page.index + 1}`}
									class="w-full object-contain"
									loading="lazy"
								/>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
