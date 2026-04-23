<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { CheckIcon, PencilLineIcon, PlusIcon, XIcon } from 'phosphor-svelte';

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

	let genreInputEl = $state<HTMLInputElement | null>(null);
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

	// Auto-resize textarea when description changes
	$effect(() => {
		if (!descriptionEl) return;
		void editDescription; // track
		descriptionEl.style.height = 'auto';
		descriptionEl.style.height = `${descriptionEl.scrollHeight}px`;
	});

	// Suggestions from variants — deduplicated, excluding the current value
	const titleSuggestions = $derived.by(() => {
		const seen = new Set<string>();
		const current = editTitle.trim().toLowerCase();
		return title.variants
			.map((v) => v.title.trim())
			.filter((t) => {
				const lower = t.toLowerCase();
				if (!t || lower === current || seen.has(lower)) return false;
				seen.add(lower);
				return true;
			});
	});

	const authorSuggestions = $derived.by(() => {
		const seen = new Set<string>();
		const current = editAuthor.trim().toLowerCase();
		return title.variants
			.map((v) => (v.author ?? '').trim())
			.filter((t) => {
				const lower = t.toLowerCase();
				if (!t || lower === current || seen.has(lower)) return false;
				seen.add(lower);
				return true;
			});
	});

	const artistSuggestions = $derived.by(() => {
		const seen = new Set<string>();
		const current = editArtist.trim().toLowerCase();
		return title.variants
			.map((v) => (v.artist ?? '').trim())
			.filter((t) => {
				const lower = t.toLowerCase();
				if (!t || lower === current || seen.has(lower)) return false;
				seen.add(lower);
				return true;
			});
	});

	const descriptionAlternatives = $derived.by(() => {
		const seen = new Set<string>();
		const current = editDescription.trim().slice(0, 60).toLowerCase();
		return title.variants
			.map((v) => (v.description ?? '').trim())
			.filter((t) => {
				const key = t.slice(0, 60).toLowerCase();
				if (!t || key === current || seen.has(key)) return false;
				seen.add(key);
				return true;
			})
			.slice(0, 4);
	});

	const genreSuggestions = $derived.by(() => {
		const seen = new Set<string>();
		const active = new Set(editGenres.map((g) => g.toLowerCase()));
		const suggestions: string[] = [];
		for (const variant of title.variants) {
			const genres = String(variant.genre ?? '')
				.split(',')
				.map((g) => g.trim())
				.filter(Boolean);
			for (const genre of genres) {
				const lower = genre.toLowerCase();
				if (!seen.has(lower) && !active.has(lower)) {
					seen.add(lower);
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

<SlidePanel open={open} title={$_('title.editMetadata')} onclose={onclose}>
	<div class="flex flex-col divide-y divide-[var(--void-2)]">
		<!-- Name -->
		<div class="flex flex-col gap-3 py-5">
			<span class="text-label text-[var(--text-ghost)]">{$_('title.editName')}</span>
			<input
				type="text"
				bind:value={editTitle}
				class="w-full border-b border-[var(--void-4)] bg-transparent py-1.5 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--text-ghost)] placeholder:text-[var(--void-6)]"
				placeholder={title.title}
			/>
			{#if titleSuggestions.length > 0}
				<div class="flex flex-col gap-1.5">
					<span class="text-[10px] tracking-wide text-[var(--void-6)] uppercase"
						>{$_('title.editAlsoKnownAs')}</span
					>
					<div class="flex flex-wrap gap-1.5">
						{#each titleSuggestions as suggestion (suggestion)}
							<button
								type="button"
								class="flex items-center gap-1 border border-dashed border-[var(--void-4)] px-2 py-0.5 text-xs text-[var(--text-ghost)] transition-colors hover:border-[var(--void-6)] hover:text-[var(--text-muted)]"
								onclick={() => (editTitle = suggestion)}
							>
								<PlusIcon size={9} />
								{suggestion}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Author -->
		<div class="flex flex-col gap-3 py-5">
			<span class="text-label text-[var(--text-ghost)]">{$_('title.author')}</span>
			<input
				type="text"
				bind:value={editAuthor}
				class="w-full border-b border-[var(--void-4)] bg-transparent py-1.5 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--text-ghost)] placeholder:text-[var(--void-6)]"
				placeholder="—"
			/>
			{#if authorSuggestions.length > 0}
				<div class="flex flex-wrap gap-1.5">
					{#each authorSuggestions as suggestion (suggestion)}
						<button
							type="button"
							class="flex items-center gap-1 border border-dashed border-[var(--void-4)] px-2 py-0.5 text-xs text-[var(--text-ghost)] transition-colors hover:border-[var(--void-6)] hover:text-[var(--text-muted)]"
							onclick={() => (editAuthor = suggestion)}
						>
							<PlusIcon size={9} />
							{suggestion}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Artist -->
		<div class="flex flex-col gap-3 py-5">
			<span class="text-label text-[var(--text-ghost)]">{$_('title.artist')}</span>
			<input
				type="text"
				bind:value={editArtist}
				class="w-full border-b border-[var(--void-4)] bg-transparent py-1.5 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--text-ghost)] placeholder:text-[var(--void-6)]"
				placeholder="—"
			/>
			{#if artistSuggestions.length > 0}
				<div class="flex flex-wrap gap-1.5">
					{#each artistSuggestions as suggestion (suggestion)}
						<button
							type="button"
							class="flex items-center gap-1 border border-dashed border-[var(--void-4)] px-2 py-0.5 text-xs text-[var(--text-ghost)] transition-colors hover:border-[var(--void-6)] hover:text-[var(--text-muted)]"
							onclick={() => (editArtist = suggestion)}
						>
							<PlusIcon size={9} />
							{suggestion}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Description -->
		<div class="flex flex-col gap-3 py-5">
			<span class="text-label text-[var(--text-ghost)]">{$_('title.description')}</span>
			<textarea
				bind:this={descriptionEl}
				bind:value={editDescription}
				rows={4}
				class="w-full resize-none border-b border-[var(--void-4)] bg-transparent py-1.5 text-sm leading-relaxed text-[var(--text)] outline-none transition-colors focus:border-[var(--text-ghost)] placeholder:text-[var(--void-6)]"
				placeholder={$_('title.noDescription')}
			></textarea>

			{#if descriptionAlternatives.length > 0}
				<div class="flex flex-col gap-2">
					<span class="text-[10px] tracking-wide text-[var(--void-6)] uppercase"
						>{$_('title.editDescriptionAlternatives')}</span
					>
					{#each descriptionAlternatives as alt, i (i)}
						<div class="group relative border border-[var(--void-2)] bg-[var(--void-1)] p-3">
							<p
								class="line-clamp-3 text-xs leading-relaxed text-[var(--text-ghost)] transition-colors group-hover:text-[var(--text-muted)]"
							>
								{alt}
							</p>
							<button
								type="button"
								class="mt-2 text-[10px] tracking-wide text-[var(--void-6)] uppercase transition-colors hover:text-[var(--text-ghost)]"
								onclick={() => (editDescription = alt)}
							>
								{$_('title.editUseThis')}
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Genres -->
		<div class="flex flex-col gap-3 py-5">
			<span class="text-label text-[var(--text-ghost)]">{$_('title.genres')}</span>

			<!-- Active genre tags + input -->
			<div
				class="flex min-h-[36px] flex-wrap items-center gap-1.5 border-b border-[var(--void-4)] pb-2 transition-colors focus-within:border-[var(--text-ghost)]"
				role="group"
				aria-label="Genres"
			>
				{#each editGenres as genre, i (genre)}
					<span
						class="flex items-center gap-1 bg-[var(--void-3)] px-2 py-0.5 text-xs text-[var(--text)]"
					>
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
					bind:this={genreInputEl}
					type="text"
					bind:value={genreInput}
					onkeydown={handleGenreKeydown}
					class="min-w-[120px] flex-1 bg-transparent py-1 text-sm text-[var(--text)] outline-none placeholder:text-[var(--void-6)]"
					placeholder={editGenres.length === 0 ? $_('title.editGenresPlaceholder') : ''}
				/>
			</div>

			{#if genreSuggestions.length > 0}
				<div class="flex flex-col gap-1.5">
					<span class="text-[10px] tracking-wide text-[var(--void-6)] uppercase"
						>{$_('title.editFromSources')}</span
					>
					<div class="flex flex-wrap gap-1.5">
						{#each genreSuggestions as genre (genre)}
							<button
								type="button"
								class="flex items-center gap-1 border border-dashed border-[var(--void-4)] px-2 py-0.5 text-xs text-[var(--text-ghost)] transition-colors hover:border-[var(--void-6)] hover:bg-[var(--void-2)] hover:text-[var(--text-muted)]"
								onclick={() => addGenre(genre)}
							>
								<PlusIcon size={9} />
								{genre}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Save -->
		<div class="pt-5 pb-2">
			{#if saveError}
				<p class="mb-3 text-xs text-[var(--error)]">{saveError}</p>
			{/if}
			<Button
				variant="solid"
				class="w-full"
				onclick={handleSave}
				disabled={saving}
				loading={saving}
			>
				{#if !saving}
					<CheckIcon size={14} />
				{/if}
				{$_('title.editSaveChanges')}
			</Button>
		</div>
	</div>
</SlidePanel>
