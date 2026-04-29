<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { CheckIcon, PlusIcon, XIcon } from 'phosphor-svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import { Button } from '$lib/elements/button';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { convexApi } from '$lib/convex/api';
	import { _ } from '$lib/i18n';

	interface VariantData {
		id: string;
		title: string;
		author?: string | null;
		artist?: string | null;
		description?: string | null;
		genre?: string | null;
	}

	interface TitleData {
		_id: Id<'libraryTitles'>;
		title: string;
		author?: string | null;
		artist?: string | null;
		description?: string | null;
		genre?: string | null;
		variants: VariantData[];
	}

	interface Props {
		open: boolean;
		title: TitleData;
		onclose: () => void;
	}

	let { open, title, onclose }: Props = $props();

	const client = useConvexClient();

	let editTitle = $state('');
	let editAuthor = $state('');
	let editArtist = $state('');
	let editDescription = $state('');
	let editGenres = $state<string[]>([]);
	let genreInput = $state('');
	let saving = $state(false);
	let saveError = $state<string | null>(null);

	let descriptionEl = $state<HTMLTextAreaElement | null>(null);

	$effect(() => {
		if (!open) return;
		editTitle = title.title;
		editAuthor = title.author ?? '';
		editArtist = title.artist ?? '';
		editDescription = title.description ?? '';
		editGenres = String(title.genre ?? '')
			.split(',')
			.map((g) => g.trim())
			.filter(Boolean);
		genreInput = '';
		saveError = null;
	});

	$effect(() => {
		if (!descriptionEl) return;
		void editDescription;
		descriptionEl.style.height = 'auto';
		descriptionEl.style.height = `${Math.max(96, descriptionEl.scrollHeight)}px`;
	});

	function uniqueTrimmed(values: Iterable<string>, current: string) {
		const cur = current.trim().toLowerCase();
		const seen = new Set<string>();
		const out: string[] = [];
		for (const raw of values) {
			const t = (raw ?? '').trim();
			const k = t.toLowerCase();
			if (!t || k === cur || seen.has(k)) continue;
			seen.add(k);
			out.push(t);
		}
		return out;
	}

	const titleSuggestions = $derived(
		uniqueTrimmed(
			title.variants.map((v) => v.title),
			editTitle
		)
	);
	const authorSuggestions = $derived(
		uniqueTrimmed(
			title.variants.map((v) => v.author ?? ''),
			editAuthor
		)
	);
	const artistSuggestions = $derived(
		uniqueTrimmed(
			title.variants.map((v) => v.artist ?? ''),
			editArtist
		)
	);

	const descriptionAlternatives = $derived.by(() => {
		const seen: string[] = [];
		const current = editDescription.trim().slice(0, 60).toLowerCase();
		return title.variants
			.map((v) => (v.description ?? '').trim())
			.filter((t) => {
				const key = t.slice(0, 60).toLowerCase();
				if (!t || key === current || seen.includes(key)) return false;
				seen.push(key);
				return true;
			})
			.slice(0, 4);
	});

	const genreSuggestions = $derived.by(() => {
		const seen: string[] = [];
		const active = editGenres.map((g) => g.toLowerCase());
		const suggestions: string[] = [];
		for (const variant of title.variants) {
			const genres = String(variant.genre ?? '')
				.split(',')
				.map((g) => g.trim())
				.filter(Boolean);
			for (const genre of genres) {
				const lower = genre.toLowerCase();
				if (!seen.includes(lower) && !active.includes(lower)) {
					seen.push(lower);
					suggestions.push(genre);
				}
			}
		}
		return suggestions;
	});

	function addGenre(genre: string) {
		const trimmed = genre.trim();
		if (!trimmed) return;
		if (editGenres.some((g) => g.toLowerCase() === trimmed.toLowerCase())) return;
		editGenres = [...editGenres, trimmed];
	}

	function removeGenre(index: number) {
		editGenres = editGenres.filter((_, i) => i !== index);
	}

	function handleGenreKeydown(e: KeyboardEvent) {
		if ((e.key === 'Enter' || e.key === ',') && genreInput.trim()) {
			e.preventDefault();
			addGenre(genreInput);
			genreInput = '';
		} else if (e.key === 'Backspace' && !genreInput && editGenres.length > 0) {
			editGenres = editGenres.slice(0, -1);
		}
	}

	async function handleSave() {
		if (saving) return;
		saving = true;
		saveError = null;
		try {
			await client.mutation(convexApi.library.updateTitleCustomMetadata, {
				titleId: title._id,
				title: editTitle.trim() || title.title,
				description: editDescription.trim() || null,
				genre: editGenres.length > 0 ? editGenres.join(', ') : null,
				author: editAuthor.trim() || null,
				artist: editArtist.trim() || null
			});
			onclose();
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Unable to save changes';
		} finally {
			saving = false;
		}
	}
</script>

{#snippet field(label: string, hint?: string)}
	<div class="flex items-baseline justify-between gap-2 pb-1.5">
		<span class="font-mono text-[10px] tracking-[0.2em] text-[var(--text-ghost)] uppercase">
			{label}
		</span>
		{#if hint}
			<span class="font-mono text-[9px] tracking-[0.18em] text-[var(--text-dim)] tabular-nums uppercase">
				{hint}
			</span>
		{/if}
	</div>
{/snippet}

{#snippet suggestionPill(label: string, onclick: () => void)}
	<button
		type="button"
		class="group flex max-w-full items-center gap-1 border border-[var(--void-3)] bg-[var(--void-2)] px-2 py-1 text-[11px] text-[var(--text-ghost)] transition-colors hover:border-[var(--cosmic-halo)] hover:bg-[var(--void-3)] hover:text-[var(--text)]"
		{onclick}
	>
		<PlusIcon size={9} class="shrink-0 text-[var(--cosmic)] opacity-60 group-hover:opacity-100" />
		<span class="truncate">{label}</span>
	</button>
{/snippet}

<SlidePanel {open} title={$_('title.editMetadata')} {onclose}>
	{#snippet footer()}
		{#if saveError}
			<p class="mb-2 font-mono text-[10px] tracking-[0.16em] text-[var(--error)] uppercase">
				{saveError}
			</p>
		{/if}
		<div class="flex items-center gap-2">
			<Button variant="ghost" class="flex-1" onclick={onclose} disabled={saving}>
				{$_('common.cancel')}
			</Button>
			<Button
				variant="solid"
				class="flex-1"
				onclick={handleSave}
				disabled={saving}
				loading={saving}
			>
				{#if !saving}
					<CheckIcon size={13} />
				{/if}
				{$_('title.editSaveChanges')}
			</Button>
		</div>
	{/snippet}

	<div class="flex flex-col gap-5 pt-3 pb-2">
		<!-- Title -->
		<div>
			{@render field($_('title.editName'))}
			<input
				type="text"
				bind:value={editTitle}
				class="block w-full overflow-x-auto border border-[var(--void-3)] bg-[var(--void-2)] px-3 py-2.5 text-sm text-[var(--text)] transition-colors outline-none placeholder:text-[var(--void-6)] hover:border-[var(--void-5)] focus:border-[var(--cosmic-halo)] focus:bg-[var(--void-1)]"
				placeholder={title.title}
			/>
			{#if titleSuggestions.length > 0}
				<div class="mt-2 flex flex-col gap-1.5">
					<span class="font-mono text-[9px] tracking-[0.2em] text-[var(--text-dim)] uppercase">
						{$_('title.editAlsoKnownAs')}
					</span>
					<div class="flex flex-wrap gap-1.5">
						{#each titleSuggestions as suggestion (suggestion)}
							{@render suggestionPill(suggestion, () => (editTitle = suggestion))}
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Author / Artist (two columns on >=sm) -->
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<div>
				{@render field($_('title.author'))}
				<input
					type="text"
					bind:value={editAuthor}
					class="block w-full border border-[var(--void-3)] bg-[var(--void-2)] px-3 py-2.5 text-sm text-[var(--text)] transition-colors outline-none placeholder:text-[var(--void-6)] hover:border-[var(--void-5)] focus:border-[var(--cosmic-halo)] focus:bg-[var(--void-1)]"
					placeholder="—"
				/>
				{#if authorSuggestions.length > 0}
					<div class="mt-2 flex flex-wrap gap-1.5">
						{#each authorSuggestions as suggestion (suggestion)}
							{@render suggestionPill(suggestion, () => (editAuthor = suggestion))}
						{/each}
					</div>
				{/if}
			</div>
			<div>
				{@render field($_('title.artist'))}
				<input
					type="text"
					bind:value={editArtist}
					class="block w-full border border-[var(--void-3)] bg-[var(--void-2)] px-3 py-2.5 text-sm text-[var(--text)] transition-colors outline-none placeholder:text-[var(--void-6)] hover:border-[var(--void-5)] focus:border-[var(--cosmic-halo)] focus:bg-[var(--void-1)]"
					placeholder="—"
				/>
				{#if artistSuggestions.length > 0}
					<div class="mt-2 flex flex-wrap gap-1.5">
						{#each artistSuggestions as suggestion (suggestion)}
							{@render suggestionPill(suggestion, () => (editArtist = suggestion))}
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<!-- Genres -->
		<div>
			{@render field(
				$_('title.genres'),
				editGenres.length > 0 ? `${editGenres.length}` : undefined
			)}
			<div
				class="flex min-h-[44px] flex-wrap items-center gap-1.5 border border-[var(--void-3)] bg-[var(--void-2)] px-2 py-1.5 transition-colors hover:border-[var(--void-5)] focus-within:border-[var(--cosmic-halo)] focus-within:bg-[var(--void-1)]"
				role="group"
				aria-label="Genres"
			>
				{#each editGenres as genre, i (genre)}
					<span
						class="flex items-center gap-1 border border-[var(--cosmic-halo)] bg-[var(--cosmic-soft)] px-1.5 py-0.5 text-[11px] text-[var(--text)]"
					>
						<span class="h-1 w-1 bg-[var(--cosmic)] shadow-[0_0_3px_var(--cosmic-glow)]"></span>
						<span class="max-w-[160px] truncate">{genre}</span>
						<button
							type="button"
							class="text-[var(--text-ghost)] transition-colors hover:text-[var(--text)]"
							onclick={() => removeGenre(i)}
							aria-label={`Remove ${genre}`}
						>
							<XIcon size={10} />
						</button>
					</span>
				{/each}
				<input
					type="text"
					bind:value={genreInput}
					onkeydown={handleGenreKeydown}
					class="min-w-[120px] flex-1 bg-transparent py-0.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--void-6)]"
					placeholder={editGenres.length === 0 ? $_('title.editGenresPlaceholder') : ''}
				/>
			</div>

			{#if genreSuggestions.length > 0}
				<div class="mt-2 flex flex-col gap-1.5">
					<span class="font-mono text-[9px] tracking-[0.2em] text-[var(--text-dim)] uppercase">
						{$_('title.editFromSources')}
					</span>
					<div class="flex flex-wrap gap-1.5">
						{#each genreSuggestions as genre (genre)}
							{@render suggestionPill(genre, () => addGenre(genre))}
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Description -->
		<div>
			{@render field(
				$_('title.description'),
				editDescription.length > 0 ? `${editDescription.length}` : undefined
			)}
			<textarea
				bind:this={descriptionEl}
				bind:value={editDescription}
				rows={4}
				class="block w-full resize-none border border-[var(--void-3)] bg-[var(--void-2)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--text)] transition-colors outline-none placeholder:text-[var(--void-6)] hover:border-[var(--void-5)] focus:border-[var(--cosmic-halo)] focus:bg-[var(--void-1)]"
				placeholder={$_('title.noDescription')}
			></textarea>

			{#if descriptionAlternatives.length > 0}
				<div class="mt-3 flex flex-col gap-2">
					<span class="font-mono text-[9px] tracking-[0.2em] text-[var(--text-dim)] uppercase">
						{$_('title.editDescriptionAlternatives')}
					</span>
					{#each descriptionAlternatives as alt, i (i)}
						<button
							type="button"
							class="group flex flex-col gap-2 border border-[var(--void-3)] bg-[var(--void-2)] px-3 py-2.5 text-left transition-colors hover:border-[var(--cosmic-halo)] hover:bg-[var(--void-3)]"
							onclick={() => (editDescription = alt)}
						>
							<p
								class="line-clamp-3 text-[12px] leading-relaxed text-[var(--text-ghost)] transition-colors group-hover:text-[var(--text-soft)]"
							>
								{alt}
							</p>
							<span
								class="flex items-center gap-1 font-mono text-[9px] tracking-[0.2em] text-[var(--text-dim)] uppercase transition-colors group-hover:text-[var(--cosmic)]"
							>
								<PlusIcon size={9} />
								{$_('title.editUseThis')}
							</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</SlidePanel>
