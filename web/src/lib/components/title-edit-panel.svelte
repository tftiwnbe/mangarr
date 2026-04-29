<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { CheckIcon, PlusIcon, XIcon } from 'phosphor-svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import { Button } from '$lib/elements/button';
	import { PanelSection } from '$lib/elements/panel-section';
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
		descriptionEl.style.height = `${descriptionEl.scrollHeight}px`;
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

{#snippet chipPill(label: string, onclick: () => void)}
	<button
		type="button"
		class="flex items-center gap-1 border border-[var(--void-4)] bg-[var(--void-2)] px-2 py-0.5 text-[11px] text-[var(--text-ghost)] transition-colors hover:border-[var(--cosmic-halo)] hover:bg-[var(--void-3)] hover:text-[var(--text)]"
		{onclick}
	>
		<PlusIcon size={9} class="text-[var(--cosmic)]" />
		<span class="truncate max-w-[220px]">{label}</span>
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

	<PanelSection label={$_('title.editName')} index="01">
		<input
			type="text"
			bind:value={editTitle}
			class="w-full border-b border-[var(--void-4)] bg-transparent py-1.5 text-sm text-[var(--text)] transition-colors outline-none placeholder:text-[var(--void-6)] focus:border-[var(--cosmic)]"
			placeholder={title.title}
		/>
		{#if titleSuggestions.length > 0}
			<div class="flex flex-col gap-1.5">
				<span class="font-mono text-[9px] tracking-[0.18em] text-[var(--text-dim)] uppercase">
					{$_('title.editAlsoKnownAs')}
				</span>
				<div class="flex flex-wrap gap-1.5">
					{#each titleSuggestions as suggestion (suggestion)}
						{@render chipPill(suggestion, () => (editTitle = suggestion))}
					{/each}
				</div>
			</div>
		{/if}
	</PanelSection>

	<PanelSection label={$_('title.author')} index="02">
		<input
			type="text"
			bind:value={editAuthor}
			class="w-full border-b border-[var(--void-4)] bg-transparent py-1.5 text-sm text-[var(--text)] transition-colors outline-none placeholder:text-[var(--void-6)] focus:border-[var(--cosmic)]"
			placeholder="—"
		/>
		{#if authorSuggestions.length > 0}
			<div class="flex flex-wrap gap-1.5">
				{#each authorSuggestions as suggestion (suggestion)}
					{@render chipPill(suggestion, () => (editAuthor = suggestion))}
				{/each}
			</div>
		{/if}
	</PanelSection>

	<PanelSection label={$_('title.artist')} index="03">
		<input
			type="text"
			bind:value={editArtist}
			class="w-full border-b border-[var(--void-4)] bg-transparent py-1.5 text-sm text-[var(--text)] transition-colors outline-none placeholder:text-[var(--void-6)] focus:border-[var(--cosmic)]"
			placeholder="—"
		/>
		{#if artistSuggestions.length > 0}
			<div class="flex flex-wrap gap-1.5">
				{#each artistSuggestions as suggestion (suggestion)}
					{@render chipPill(suggestion, () => (editArtist = suggestion))}
				{/each}
			</div>
		{/if}
	</PanelSection>

	<PanelSection label={$_('title.description')} index="04">
		<textarea
			bind:this={descriptionEl}
			bind:value={editDescription}
			rows={4}
			class="w-full resize-none border-b border-[var(--void-4)] bg-transparent py-1.5 font-mono text-[12px] leading-relaxed text-[var(--text)] transition-colors outline-none placeholder:text-[var(--void-6)] focus:border-[var(--cosmic)]"
			placeholder={$_('title.noDescription')}
		></textarea>

		{#if descriptionAlternatives.length > 0}
			<div class="flex flex-col gap-2 pt-1">
				<span class="font-mono text-[9px] tracking-[0.18em] text-[var(--text-dim)] uppercase">
					{$_('title.editDescriptionAlternatives')}
				</span>
				{#each descriptionAlternatives as alt, i (i)}
					<div
						class="group relative border-l-2 border-[var(--void-4)] bg-[var(--void-1)] py-2 pr-2 pl-3 transition-colors hover:border-[var(--cosmic)] hover:bg-[var(--void-2)]"
					>
						<p
							class="line-clamp-3 text-[12px] leading-relaxed text-[var(--text-ghost)] transition-colors group-hover:text-[var(--text-soft)]"
						>
							{alt}
						</p>
						<button
							type="button"
							class="mt-2 flex items-center gap-1 font-mono text-[9px] tracking-[0.18em] text-[var(--text-dim)] uppercase transition-colors hover:text-[var(--cosmic)]"
							onclick={() => (editDescription = alt)}
						>
							<PlusIcon size={9} />
							{$_('title.editUseThis')}
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</PanelSection>

	<PanelSection
		label={$_('title.genres')}
		index="05"
		count={editGenres.length}
		divider={false}
	>
		<div
			class="flex min-h-[40px] flex-wrap items-center gap-1.5 border border-[var(--void-4)] bg-[var(--void-2)] px-2 py-1.5 transition-colors focus-within:border-[var(--cosmic)]"
			role="group"
			aria-label="Genres"
		>
			{#each editGenres as genre, i (genre)}
				<span
					class="flex items-center gap-1.5 border border-[var(--cosmic-halo)] bg-[var(--cosmic-soft)] px-1.5 py-0.5 text-[11px] text-[var(--text)]"
				>
					<span class="h-1 w-1 bg-[var(--cosmic)] shadow-[0_0_3px_var(--cosmic-glow)]"></span>
					{genre}
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
			<div class="flex flex-col gap-1.5">
				<span class="font-mono text-[9px] tracking-[0.18em] text-[var(--text-dim)] uppercase">
					{$_('title.editFromSources')}
				</span>
				<div class="flex flex-wrap gap-1.5">
					{#each genreSuggestions as genre (genre)}
						{@render chipPill(genre, () => addGenre(genre))}
					{/each}
				</div>
			</div>
		{/if}
	</PanelSection>
</SlidePanel>
