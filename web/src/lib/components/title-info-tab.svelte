<script lang="ts">
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
		chaptersLabel: string;
		sourcesLabel: string;
		updatesEnabled: boolean;
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
		chaptersLabel,
		sourcesLabel,
		updatesEnabled
	}: Props = $props();

	const uniqueGenres = $derived(
		Array.from(new Set(genres.map((genre) => genre.trim()).filter((genre) => genre.length > 0)))
	);
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
					{$_('title.chapters')}
				</span>
				<span class="text-xs text-[var(--text-muted)]">{chaptersLabel}</span>
			</div>
			<div class="flex items-baseline justify-between gap-4">
				<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
					{$_('title.sources')}
				</span>
				<span class="text-xs text-[var(--text-muted)]">{sourcesLabel}</span>
			</div>
			<div class="flex items-baseline justify-between gap-4">
				<span class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">
					{$_('title.downloadMonitoring')}
				</span>
				<span class="text-xs text-[var(--text-muted)]">
					{updatesEnabled ? $_('downloads.enabled') : $_('downloads.disabled')}
				</span>
			</div>
		</div>
	</div>
</div>
