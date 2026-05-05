<script lang="ts">
	import { getCachedCoverUrl } from '$lib/api/covers';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { _ } from '$lib/i18n';

	type Props = {
		description: string | null;
		showFullDescription: boolean;
		onToggleDescription: () => void;
		genres: string[];
		author: string;
		artist: string;
		displayStatus: string;
		sourceName: string;
		sourceLang: string;
		addedAt: number | null;
		lastReadAt: number | null;
		lastUpdatedAt: number | null;
		similarTitles: Array<{
			title: string;
			coverUrl?: string | null;
			href: string;
		}>;
		similarTitlesLoading: boolean;
		similarTitlesWarming: boolean;
	};

	let {
		description,
		showFullDescription,
		onToggleDescription,
		genres,
		author,
		artist,
		displayStatus,
		sourceName,
		sourceLang,
		addedAt,
		lastReadAt,
		lastUpdatedAt,
		similarTitles,
		similarTitlesLoading,
		similarTitlesWarming
	}: Props = $props();

	const uniqueGenres = $derived(
		Array.from(new Set(genres.map((genre) => genre.trim()).filter((genre) => genre.length > 0)))
	);

	function formatDate(ms: number | null): string {
		if (!ms) return $_('title.never');
		return new Date(ms).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<div class="flex flex-col gap-8">
	{#if description}
		<div>
			<p
				class="text-sm leading-relaxed text-[var(--text-soft)] {!showFullDescription
					? 'line-clamp-6'
					: ''}"
			>
				{description}
			</p>
			{#if description.length > 300}
				<button
					type="button"
					class="mt-2 text-xs text-[var(--void-7)] transition-colors hover:text-[var(--text-muted)]"
					onclick={onToggleDescription}
				>
					{showFullDescription ? $_('common.less') : $_('common.more')}
				</button>
			{/if}
		</div>
	{:else}
		<p class="text-sm text-[var(--text-ghost)]">{$_('title.noDescription')}</p>
	{/if}

	{#if uniqueGenres.length > 0}
		<div class="flex flex-wrap gap-2">
			{#each uniqueGenres as genre (genre)}
				<span class="bg-[var(--void-2)] px-2.5 py-1 text-[11px] text-[var(--text-ghost)]">
					{genre}
				</span>
			{/each}
		</div>
	{/if}

	<div class="flex flex-col gap-8">
		<div class="flex flex-col gap-3">
			{#if author}
				<div class="flex items-baseline justify-between gap-4">
					<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
						{$_('title.author')}
					</span>
					<span class="text-xs text-[var(--text-muted)]">{author}</span>
				</div>
			{/if}
			{#if artist && artist !== author}
				<div class="flex items-baseline justify-between gap-4">
					<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
						{$_('title.artist')}
					</span>
					<span class="text-xs text-[var(--text-muted)]">{artist}</span>
				</div>
			{/if}
		</div>

		<div class="flex flex-col gap-3">
			{#if displayStatus}
				<div class="flex items-baseline justify-between gap-4">
					<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
						{$_('title.status')}
					</span>
					<span class="text-xs text-[var(--text-muted)]">{displayStatus}</span>
				</div>
			{/if}
			<div class="flex items-baseline justify-between gap-4">
				<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
					{$_('title.readingSource')}
				</span>
				<span class="text-right text-xs text-[var(--text-muted)]">
					{sourceName} [{sourceLang}]
				</span>
			</div>
			<div class="flex items-baseline justify-between gap-4">
				<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
					{$_('title.addedToLibrary')}
				</span>
				<span class="text-xs text-[var(--text-muted)]">{formatDate(addedAt)}</span>
			</div>
			<div class="flex items-baseline justify-between gap-4">
				<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
					{$_('title.lastRead')}
				</span>
				<span class="text-xs text-[var(--text-muted)]">{formatDate(lastReadAt)}</span>
			</div>
			<div class="flex items-baseline justify-between gap-4">
				<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
					{$_('title.lastUpdated')}
				</span>
				<span class="text-xs text-[var(--text-muted)]">{formatDate(lastUpdatedAt)}</span>
			</div>
		</div>
	</div>

	{#if similarTitlesLoading || similarTitles.length > 0 || similarTitlesWarming}
		<div class="flex flex-col gap-3">
			<div class="flex items-center justify-between gap-3">
				<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
					{$_('title.similarTitles')}
				</span>
				{#if similarTitlesLoading}
					<span class="text-[10px] text-[var(--text-ghost)]">{$_('common.loading')}</span>
				{/if}
			</div>

			{#if similarTitles.length > 0}
				<!-- Mobile: horizontal scroll snap. Desktop: grid -->
				<div
					class="flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-2 [scrollbar-width:none] sm:grid sm:grid-cols-4 sm:overflow-visible sm:pb-0 lg:grid-cols-6 [&::-webkit-scrollbar]:hidden"
				>
					{#each similarTitles as item (item.href)}
						<a
							href={item.href}
							class="group flex w-[40vw] shrink-0 snap-start flex-col gap-1.5 text-left sm:w-auto"
							title={item.title}
						>
							<div
								class="aspect-[2/3] overflow-hidden bg-[var(--void-2)] ring-1 ring-[var(--void-4)] transition-all duration-300 group-hover:scale-[1.02] group-hover:ring-[var(--void-6)]"
							>
								{#if item.coverUrl}
									<LazyImage
										src={getCachedCoverUrl(item.coverUrl)}
										alt={item.title}
										class="h-full w-full"
										imgClass="transition-transform duration-500 group-hover:scale-[1.05]"
									/>
								{:else}
									<div
										class="flex h-full items-center justify-center text-[10px] text-[var(--text-ghost)]"
									>
										{$_('common.empty')}
									</div>
								{/if}
							</div>
							<p class="line-clamp-2 text-[10px] leading-snug text-[var(--text)]">
								{item.title}
							</p>
						</a>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-[var(--text-ghost)]">
					{similarTitlesWarming ? $_('title.similarTitlesWarming') : $_('title.similarTitlesEmpty')}
				</p>
			{/if}
		</div>
	{/if}
</div>
