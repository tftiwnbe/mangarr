<script lang="ts">
	import { useQuery } from 'convex-svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import { convexApi } from '$lib/convex/api';
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

	type CommandItem = {
		id: string;
		commandType: string;
		status: string;
	};

	const library = useQuery(convexApi.library.listMine, () => ({}));
	const commands = useQuery(convexApi.commands.listMine, () => ({ limit: 20 }));

	const titles = $derived((library.data ?? []) as TitleItem[]);
	const recentImports = $derived.by(
		() =>
			((commands.data ?? []) as CommandItem[]).filter(
				(item) => item.commandType === 'library.import' && item.status === 'succeeded'
			)
	);

	function coverSrc(title: TitleItem) {
		if (title.localCoverPath) {
			const params = new URLSearchParams({ path: title.localCoverPath });
			return `/api/internal/bridge/library/cover?${params.toString()}`;
		}
		return title.coverUrl ?? '';
	}
</script>

<svelte:head>
	<title>{$_('nav.library')} | {$_('app.name')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex items-center gap-3">
		<h1 class="text-display flex-1 text-xl text-[var(--text)]">{$_('nav.library').toLowerCase()}</h1>
	</div>

	<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
		<h2 class="mb-3 text-sm tracking-wider text-[var(--text)] uppercase">Your Titles</h2>
		{#if library.isLoading}
			<p class="text-sm text-[var(--text-ghost)]">Loading library…</p>
		{:else if titles.length === 0}
			<p class="text-sm text-[var(--text-ghost)]">
				No titles imported yet. Install extensions, search in Explore, then import a title.
			</p>
		{:else}
			<div class="grid gap-3 lg:grid-cols-2">
				{#each titles as title (title._id)}
					<div class="grid gap-3 border border-[var(--line)] p-3 md:grid-cols-[5rem_1fr]">
						{#if coverSrc(title)}
							<img
								src={coverSrc(title)}
								alt={title.title}
								class="h-28 w-20 rounded-sm object-cover"
								loading="lazy"
							/>
						{:else}
							<div class="flex h-28 w-20 items-center justify-center border border-dashed border-[var(--line)] text-xs text-[var(--text-ghost)]">
								No cover
							</div>
						{/if}

						<div>
							<p class="text-sm text-[var(--text)]">{title.title}</p>
							<p class="mt-1 text-xs text-[var(--text-ghost)]">
								{title.sourcePkg} · {title.sourceLang} · {new Date(title.updatedAt).toLocaleString()}
							</p>
							<div class="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--text-muted)]">
								<span>{title.chapterStats.total} chapters</span>
								<span>{title.chapterStats.downloaded} downloaded</span>
								<span>{title.chapterStats.queued + title.chapterStats.downloading} active</span>
								<span>{title.chapterStats.failed} failed</span>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<div class="border border-[var(--line)] bg-[var(--surface)] p-4">
		<h2 class="mb-3 text-sm tracking-wider text-[var(--text)] uppercase">Recent Imports</h2>
		{#if commands.isLoading}
			<p class="text-sm text-[var(--text-ghost)]">Loading command history…</p>
		{:else if recentImports.length === 0}
			<p class="text-sm text-[var(--text-ghost)]">No completed imports yet.</p>
		{:else}
			<div class="flex flex-col gap-2">
				{#each recentImports as cmd (cmd.id)}
					<div class="flex items-center justify-between border-b border-[var(--line)] pb-2">
						<span class="text-xs text-[var(--text-muted)]">{cmd.commandType}</span>
						<span class="text-xs text-[var(--text-ghost)]">{cmd.status}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
