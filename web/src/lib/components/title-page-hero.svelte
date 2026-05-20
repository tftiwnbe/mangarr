<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		BellIcon,
		BellSlashIcon,
		BookIcon,
		CaretDownIcon,
		CaretLeftIcon,
		GearIcon,
		PencilLineIcon,
		PlayIcon,
		PlusIcon,
		SpinnerIcon,
		StarIcon
	} from 'phosphor-svelte';

	import { Dropdown, DropdownItem } from '$lib/elements/dropdown';
	import { LazyImage } from '$lib/elements/lazy-image';
	import { _ } from '$lib/i18n';

	type StatusOption = {
		id: string;
		label: string;
	};

	type CollectionOption = {
		id: string;
		name: string;
	};

	type Props = {
		title: string;
		coverSrc: string | null;
		author: string;
		artist: string;
		chapterStatsTotal: number;
		readingProgressCount: number;
		hasReadingProgress: boolean;
		isChapterHydrating: boolean;
		chapterHydrationHeadline: string;
		selectedStatus: StatusOption | null;
		availableStatuses: StatusOption[];
		selectedCollections: CollectionOption[];
		unselectedCollections: CollectionOption[];
		updatesEnabled: boolean;
		updatingDownloadProfile: boolean;
		prefsSaving: boolean;
		selectedRating: number;
		onBack: () => void;
		onOpenReadingStart: () => void;
		onOpenManagement: () => void;
		onOpenEdit: () => void;
		onSetStatus: (statusId: string | null) => void;
		onToggleDownloadUpdates: () => void;
		onToggleCollection: (collectionId: string) => void;
		onSetRating: (rating: number) => void;
		children?: Snippet;
	};

	let {
		title,
		coverSrc,
		author,
		artist,
		chapterStatsTotal,
		readingProgressCount,
		hasReadingProgress,
		isChapterHydrating,
		chapterHydrationHeadline,
		selectedStatus,
		availableStatuses,
		selectedCollections,
		unselectedCollections,
		updatesEnabled,
		updatingDownloadProfile,
		prefsSaving,
		selectedRating,
		onBack,
		onOpenReadingStart,
		onOpenManagement,
		onOpenEdit,
		onSetStatus,
		onToggleDownloadUpdates,
		onToggleCollection,
		onSetRating,
		children
	}: Props = $props();

	let ratingHover = $state(0);

	const readingProgressPercent = $derived(
		Math.round((readingProgressCount / Math.max(chapterStatsTotal, 1)) * 100)
	);
</script>

{#snippet chipRow()}
	<div class="flex flex-wrap items-center gap-1.5 text-xs">
		<Dropdown
			triggerClass="flex items-center gap-1 px-2.5 py-1 transition-colors {selectedStatus
				? 'bg-[var(--void-5)] text-[var(--text)] hover:bg-[var(--void-6)]'
				: 'bg-[var(--void-3)] text-[var(--text-ghost)] hover:bg-[var(--void-4)] hover:text-[var(--text)]'} data-[state=open]:bg-[var(--void-5)] data-[state=open]:text-[var(--text)]"
		>
			{#snippet trigger()}
				<span>{selectedStatus?.label ?? $_('title.status')}</span>
				<CaretDownIcon size={10} />
			{/snippet}
			<DropdownItem onSelect={() => onSetStatus(null)}>{$_('common.clear')}</DropdownItem>
			{#each availableStatuses as status (status.id)}
				<DropdownItem onSelect={() => onSetStatus(status.id)}>{status.label}</DropdownItem>
			{/each}
		</Dropdown>

		<button
			type="button"
			class="flex items-center gap-1 px-2.5 py-1 transition-colors disabled:opacity-50 {updatesEnabled
				? 'bg-[var(--void-5)] text-[var(--text)] hover:bg-[var(--void-6)]'
				: 'bg-[var(--void-3)] text-[var(--text-ghost)] hover:bg-[var(--void-4)] hover:text-[var(--text)]'}"
			onclick={onToggleDownloadUpdates}
			disabled={updatingDownloadProfile}
		>
			{#if updatingDownloadProfile}
				<SpinnerIcon size={12} class="animate-spin" />
			{:else if updatesEnabled}
				<BellIcon size={12} />
			{:else}
				<BellSlashIcon size={12} />
			{/if}
			<span>{updatesEnabled ? $_('title.updatesOn') : $_('title.updatesOff')}</span>
		</button>

		{#each selectedCollections as collection (collection.id)}
			<button
				type="button"
				class="flex items-center gap-1 bg-[var(--void-5)] px-2.5 py-1 text-[var(--text)] transition-colors hover:bg-[var(--void-6)]"
				onclick={() => onToggleCollection(collection.id)}
				aria-label={`Remove from ${collection.name}`}
			>
				<span>{collection.name}</span>
			</button>
		{/each}
		{#if unselectedCollections.length > 0}
			<Dropdown
				triggerClass="flex items-center gap-1 bg-[var(--void-3)] px-2.5 py-1 text-[var(--text-ghost)] transition-colors hover:bg-[var(--void-4)] hover:text-[var(--text)] data-[state=open]:bg-[var(--void-5)] data-[state=open]:text-[var(--text)]"
			>
				{#snippet trigger()}
					<PlusIcon size={12} />
					{#if selectedCollections.length === 0}
						<span>{$_('title.collections')}</span>
					{/if}
				{/snippet}
				{#each unselectedCollections as collection (collection.id)}
					<DropdownItem onSelect={() => onToggleCollection(collection.id)}>
						{collection.name}
					</DropdownItem>
				{/each}
			</Dropdown>
		{/if}
		{#if prefsSaving}
			<SpinnerIcon size={12} class="animate-spin text-[var(--void-6)]" />
		{/if}
	</div>
{/snippet}

<div class="flex flex-col md:grid md:grid-cols-[260px_1fr] md:items-start md:gap-8">
	<div class="relative -mx-4 -mt-5 md:sticky md:top-8 md:mx-0 md:mt-0">
		<div
			class="aspect-[3/4] max-h-[70vh] w-full overflow-hidden bg-[var(--void-2)] md:aspect-[2/3] md:max-h-none"
		>
			{#if coverSrc}
				<LazyImage
					src={coverSrc}
					alt={title}
					class="h-full w-full"
					imgClass="object-cover object-top"
					loading="eager"
				/>
			{:else}
				<div class="flex h-full w-full items-center justify-center bg-[var(--void-3)]">
					<BookIcon size={28} class="text-[var(--void-6)]" />
				</div>
			{/if}
		</div>
		<div
			class="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 md:hidden"
			style="background: linear-gradient(to top, var(--void-0) 0%, var(--void-0) 8%, transparent 100%);"
		></div>
		<button
			type="button"
			class="absolute top-4 left-4 flex h-8 w-8 items-center justify-center bg-[var(--void-0)]/60 text-[var(--text)] backdrop-blur-sm transition-colors hover:bg-[var(--void-0)]/80 md:hidden"
			onclick={onBack}
		>
			<CaretLeftIcon size={18} />
		</button>

		<div class="mt-4 hidden flex-col gap-3 md:flex">
			<div class="flex items-center gap-2">
				{#if chapterStatsTotal > 0}
					<button
						type="button"
						class="flex h-10 flex-1 items-center justify-center gap-2 bg-[var(--void-5)] text-xs text-[var(--text)] transition-all hover:bg-[var(--void-6)]"
						onclick={onOpenReadingStart}
					>
						<PlayIcon size={14} />
						<span
							>{hasReadingProgress ? $_('title.continueReading') : $_('title.startReading')}</span
						>
					</button>
				{:else if isChapterHydrating}
					<div
						class="flex h-10 flex-1 items-center justify-center gap-2 text-xs text-[var(--text-ghost)]"
					>
						<SpinnerIcon size={14} class="animate-spin" />
						<span>{chapterHydrationHeadline}</span>
					</div>
				{:else}
					<div
						class="flex h-10 flex-1 items-center justify-center text-xs text-[var(--text-ghost)]"
					>
						{$_('title.noChapters')}
					</div>
				{/if}
				<button
					type="button"
					class="flex h-10 w-10 shrink-0 items-center justify-center bg-[var(--void-3)] text-[var(--text-muted)] transition-colors hover:bg-[var(--void-4)] hover:text-[var(--text)]"
					onclick={onOpenManagement}
				>
					<GearIcon size={16} />
				</button>
			</div>
			{#if chapterStatsTotal > 0}
				<div class="flex items-center gap-2">
					<div class="relative h-px min-w-0 flex-1 bg-[var(--void-4)]">
						<div
							class="absolute inset-y-0 left-0 bg-[var(--text-ghost)]"
							style={`width: ${readingProgressPercent}%`}
						></div>
					</div>
					<span class="shrink-0 text-[11px] text-[var(--void-7)] tabular-nums">
						{readingProgressCount}/{chapterStatsTotal}
					</span>
				</div>
			{/if}
		</div>
	</div>

	<div class="flex flex-col">
		<div class="relative -mt-20 flex flex-col gap-2 sm:-mt-24 md:mt-0">
			<div class="flex items-center gap-0.5 md:hidden">
				{#each Array.from({ length: 5 }) as _unused, i (i)}
					{@const value = i + 1}
					{@const active = (ratingHover > 0 ? ratingHover : selectedRating) >= value}
					<button
						type="button"
						class="p-1 transition-colors {active
							? 'text-[var(--text)]'
							: 'text-[var(--void-6)] hover:text-[var(--text-muted)]'}"
						onmouseenter={() => (ratingHover = value)}
						onmouseleave={() => (ratingHover = 0)}
						onclick={() => onSetRating(value)}
						aria-label={`Rate ${value}`}
					>
						<StarIcon size={18} weight={active ? 'fill' : 'regular'} />
					</button>
				{/each}
			</div>

			<div class="flex items-start justify-between gap-4">
				<div class="flex min-w-0 flex-1 items-start gap-2">
					<h1
						class="text-display min-w-0 text-2xl leading-tight text-[var(--text)] sm:text-3xl md:text-2xl"
					>
						{title}
					</h1>
					<button
						type="button"
						class="mt-1 shrink-0 text-[var(--void-6)] transition-colors hover:text-[var(--text-ghost)]"
						onclick={onOpenEdit}
						aria-label={$_('title.editMetadata')}
					>
						<PencilLineIcon size={14} />
					</button>
				</div>
				<div class="hidden shrink-0 items-center gap-0.5 md:flex">
					{#each Array.from({ length: 5 }) as _unused, i (i)}
						{@const value = i + 1}
						{@const active = (ratingHover > 0 ? ratingHover : selectedRating) >= value}
						<button
							type="button"
							class="p-0.5 transition-colors {active
								? 'text-[var(--text)]'
								: 'text-[var(--void-6)] hover:text-[var(--text-muted)]'}"
							onmouseenter={() => (ratingHover = value)}
							onmouseleave={() => (ratingHover = 0)}
							onclick={() => onSetRating(value)}
							aria-label={`Rate ${value}`}
						>
							<StarIcon size={16} weight={active ? 'fill' : 'regular'} />
						</button>
					{/each}
				</div>
			</div>

			{#if author || artist}
				<p class="text-sm text-[var(--text-ghost)]">
					{#if author}{author}{/if}
					{#if artist && artist !== author}
						{#if author}
							·
						{/if}
						{artist}
					{/if}
				</p>
			{/if}

			<div class="mt-2 hidden md:block">
				{@render chipRow()}
			</div>
		</div>

		<div class="mt-6 flex flex-col gap-4 md:hidden">
			<div class="flex items-center gap-3">
				{#if chapterStatsTotal > 0}
					<button
						type="button"
						class="flex h-12 flex-1 items-center justify-center gap-2 bg-[var(--void-5)] text-sm text-[var(--text)] transition-all hover:bg-[var(--void-6)]"
						onclick={onOpenReadingStart}
					>
						<PlayIcon size={16} />
						<span
							>{hasReadingProgress ? $_('title.continueReading') : $_('title.startReading')}</span
						>
					</button>
				{:else if isChapterHydrating}
					<div
						class="flex h-12 flex-1 items-center justify-center gap-2 text-sm text-[var(--text-ghost)]"
					>
						<SpinnerIcon size={16} class="animate-spin" />
						<span>{chapterHydrationHeadline}</span>
					</div>
				{:else}
					<div
						class="flex h-12 flex-1 items-center justify-center text-sm text-[var(--text-ghost)]"
					>
						{$_('title.noChapters')}
					</div>
				{/if}
				<button
					type="button"
					class="flex h-12 w-12 shrink-0 items-center justify-center bg-[var(--void-3)] text-[var(--text-muted)] transition-colors hover:bg-[var(--void-4)] hover:text-[var(--text)]"
					onclick={onOpenManagement}
				>
					<GearIcon size={18} />
				</button>
			</div>
			{#if chapterStatsTotal > 0}
				<div class="flex items-center gap-3">
					<div class="relative h-px min-w-0 flex-1 bg-[var(--void-4)]">
						<div
							class="absolute inset-y-0 left-0 bg-[var(--text-ghost)]"
							style={`width: ${readingProgressPercent}%`}
						></div>
					</div>
					<span class="shrink-0 text-xs text-[var(--void-7)] tabular-nums">
						{readingProgressCount}/{chapterStatsTotal}
					</span>
				</div>
			{/if}
			{@render chipRow()}
		</div>

		{@render children?.()}
	</div>
</div>
