<script lang="ts">
	import { CheckIcon, SpinnerIcon, StarIcon, XIcon } from 'phosphor-svelte';

	import { _ } from '$lib/i18n';

	type Props = {
		startedAt: number;
		busy?: boolean;
		headingLabel?: string;
		headingDetail?: string | null;
		saveLabel?: string;
		dismissLabel?: string;
		secondaryAction?: { label: string; onClick: () => void } | null;
		onSave: (rating: number | null, notes: string | null) => void;
		onDismiss?: () => void;
		variant?: 'inline' | 'reader';
	};

	let {
		startedAt,
		busy = false,
		headingLabel,
		headingDetail = null,
		saveLabel,
		dismissLabel,
		secondaryAction = null,
		onSave,
		onDismiss,
		variant = 'inline'
	}: Props = $props();

	let rating = $state(0);
	let notes = $state('');

	const DAY_MS = 24 * 60 * 60 * 1000;
	const dayCount = $derived(Math.max(0, Math.round((Date.now() - startedAt) / DAY_MS)));
	const durationLabel = $derived(
		dayCount === 0
			? $_('reads.sameDay')
			: dayCount === 1
				? $_('reads.dayOne')
				: $_('reads.dayCount', { values: { days: dayCount } })
	);

	function commit() {
		onSave(rating > 0 ? rating : null, notes.trim() ? notes.trim() : null);
	}
</script>

<div
	class="border-l-2 border-[var(--cosmic)] bg-[var(--void-2)] px-4 py-3 {variant === 'reader'
		? 'shadow-[0_0_24px_-8px_var(--cosmic-glow)]'
		: 'shadow-[0_0_24px_-12px_var(--cosmic-glow)]'}"
>
	<div class="flex items-start justify-between gap-3">
		<div class="flex min-w-0 flex-col gap-0.5">
			<div class="flex items-center gap-2 font-mono text-[10px] tracking-[0.22em] uppercase">
				<span
					class="inline-block h-1.5 w-1.5 bg-[var(--cosmic)] shadow-[0_0_6px_var(--cosmic-glow)]"
				></span>
				<span class="text-[var(--text-soft)]">
					{headingLabel ?? $_('reads.finishPromptHeading')}
				</span>
				<span class="text-[var(--text-ghost)]">·</span>
				<span class="text-[var(--text-ghost)] normal-case tabular-nums">{durationLabel}</span>
			</div>
			{#if headingDetail}
				<span class="truncate text-sm text-[var(--text)] italic">{headingDetail}</span>
			{/if}
		</div>
		{#if onDismiss}
			<button
				type="button"
				class="shrink-0 cursor-pointer p-1 text-[var(--void-7)] transition-colors hover:text-[var(--text-muted)]"
				aria-label={dismissLabel ?? $_('common.cancel')}
				disabled={busy}
				onclick={onDismiss}
			>
				<XIcon size={14} />
			</button>
		{/if}
	</div>

	<div class="mt-3 flex items-center gap-2">
		<span class="font-mono text-[10px] tracking-[0.18em] text-[var(--text-ghost)] uppercase">
			{$_('reads.ratingLabel')}
		</span>
		<div class="flex items-center gap-0.5">
			{#each [1, 2, 3, 4, 5] as level (level)}
				{@const filled = rating >= level}
				<button
					type="button"
					class="cursor-pointer p-0.5 transition-opacity {filled
						? 'opacity-100'
						: 'opacity-30 hover:opacity-70'}"
					onclick={() => {
						rating = rating === level ? 0 : level;
					}}
					aria-label={String(level)}
				>
					<StarIcon
						size={14}
						weight={filled ? 'fill' : 'regular'}
						class={filled ? 'text-[var(--cosmic)]' : 'text-[var(--void-7)]'}
					/>
				</button>
			{/each}
		</div>
	</div>

	<textarea
		bind:value={notes}
		rows="2"
		placeholder={$_('reads.notesPlaceholder')}
		class="mt-2 w-full resize-y border border-[var(--void-4)] bg-[var(--void-1)] px-2 py-1.5 text-xs text-[var(--text-soft)] outline-none focus:border-[var(--cosmic)]"
	></textarea>

	<div class="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
		{#if secondaryAction}
			<button
				type="button"
				class="cursor-pointer px-2 py-1 text-center font-mono text-[10px] tracking-[0.18em] text-[var(--text-ghost)] uppercase transition-colors hover:text-[var(--text-muted)] disabled:opacity-50"
				disabled={busy}
				onclick={secondaryAction.onClick}
			>
				{secondaryAction.label}
			</button>
		{/if}
		<button
			type="button"
			class="flex w-full cursor-pointer items-center justify-center gap-1.5 border border-[var(--cosmic)]/40 bg-[var(--cosmic)]/10 px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-[var(--text)] uppercase transition-colors hover:bg-[var(--cosmic)]/20 disabled:opacity-50 sm:w-auto sm:py-1"
			disabled={busy}
			onclick={commit}
		>
			{#if busy}
				<SpinnerIcon size={12} class="animate-spin" />
			{:else}
				<CheckIcon size={12} />
			{/if}
			<span>{saveLabel ?? $_('reads.finishAndSave')}</span>
		</button>
	</div>
</div>
