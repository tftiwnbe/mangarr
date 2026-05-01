<script lang="ts">
	import { BookOpenIcon, PlusIcon, SpinnerIcon, StarIcon, TrashIcon, XIcon } from 'phosphor-svelte';

	import { Button } from '$lib/elements/button';
	import { ConfirmDialog } from '$lib/elements/confirm-dialog';
	import { _ } from '$lib/i18n';
	import ReadFinishPanel from './read-finish-panel.svelte';

	type ReadSession = {
		id: string;
		startedAt: number;
		finishedAt: number | null;
		rating: number | null;
		notes: string | null;
	};

	type Props = {
		sessions: ReadSession[];
		loading: boolean;
		busySessionId: string | null;
		startingSession: boolean;
		onStartSession: (startedAt: number) => void;
		onFinishSession: (
			sessionId: string,
			finishedAt: number,
			rating: number | null,
			notes: string | null
		) => void;
		onUpdateSession: (
			sessionId: string,
			patch: {
				startedAt?: number;
				finishedAt?: number | null;
				rating?: number | null;
				notes?: string | null;
			}
		) => void;
		onDeleteSession: (sessionId: string) => void;
	};

	let {
		sessions,
		loading,
		busySessionId,
		startingSession,
		onStartSession,
		onFinishSession,
		onUpdateSession,
		onDeleteSession
	}: Props = $props();

	const DAY_MS = 24 * 60 * 60 * 1000;

	const activeSession = $derived(sessions.find((session) => session.finishedAt === null) ?? null);
	const completedSessions = $derived(sessions.filter((session) => session.finishedAt !== null));
	const completedCount = $derived(completedSessions.length);
	const lastFinishedAt = $derived(
		completedSessions.length > 0
			? Math.max(
					...completedSessions
						.map((session) => session.finishedAt ?? 0)
						.filter((value) => value > 0)
				)
			: null
	);

	let expandedId = $state<string | null>(null);
	let draftStartedAt = $state('');
	let draftFinishedAt = $state('');
	let draftRating = $state(0);
	let draftNotes = $state('');
	let pendingDeleteId = $state<string | null>(null);
	let finishingActive = $state(false);

	function toDateInputValue(ms: number | null): string {
		if (!ms) return '';
		const date = new Date(ms);
		const offset = date.getTimezoneOffset();
		const local = new Date(ms - offset * 60_000);
		return local.toISOString().slice(0, 10);
	}

	function fromDateInputValue(value: string, fallback: number): number {
		if (!value) return fallback;
		const parts = value.split('-');
		if (parts.length !== 3) return fallback;
		const [year, month, day] = parts.map((part) => Number(part));
		if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return fallback;
		const date = new Date(year, month - 1, day, 12, 0, 0);
		return date.getTime();
	}

	function formatDate(ms: number | null): string {
		if (!ms) return '—';
		return new Date(ms).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function formatDuration(start: number, end: number | null): string {
		const finish = end ?? Date.now();
		const days = Math.max(0, Math.round((finish - start) / DAY_MS));
		if (days === 0) return $_('reads.sameDay');
		if (days === 1) return $_('reads.dayOne');
		return $_('reads.dayCount', { values: { days } });
	}

	function relativeAgo(ms: number | null): string {
		if (!ms) return '';
		const diff = Date.now() - ms;
		if (diff < 0) return formatDate(ms);
		const days = Math.floor(diff / DAY_MS);
		if (days < 1) return $_('reads.todayLabel');
		if (days < 7) return $_('reads.daysAgo', { values: { days } });
		if (days < 30) return $_('reads.weeksAgo', { values: { weeks: Math.floor(days / 7) } });
		if (days < 365) return $_('reads.monthsAgo', { values: { months: Math.floor(days / 30) } });
		return $_('reads.yearsAgo', { values: { years: Math.floor(days / 365) } });
	}

	function beginExpand(session: ReadSession) {
		if (expandedId === session.id) {
			expandedId = null;
			return;
		}
		expandedId = session.id;
		draftStartedAt = toDateInputValue(session.startedAt);
		draftFinishedAt = toDateInputValue(session.finishedAt);
		draftRating = session.rating ?? 0;
		draftNotes = session.notes ?? '';
	}

	function commitExpandedEdit() {
		if (!expandedId) return;
		const session = sessions.find((row) => row.id === expandedId);
		if (!session) return;
		const startedAt = fromDateInputValue(draftStartedAt, session.startedAt);
		const finishedAt = draftFinishedAt
			? fromDateInputValue(draftFinishedAt, session.finishedAt ?? Date.now())
			: session.finishedAt;
		const rating = draftRating > 0 ? draftRating : null;
		const notes = draftNotes.trim() ? draftNotes.trim() : null;
		onUpdateSession(session.id, {
			startedAt,
			finishedAt,
			rating,
			notes
		});
		expandedId = null;
	}

	function ratingFor(session: ReadSession): number {
		if (expandedId === session.id) return draftRating;
		return session.rating ?? 0;
	}
</script>

{#snippet starsRow(session: ReadSession, interactive: boolean)}
	<div class="flex items-center gap-0.5">
		{#each [1, 2, 3, 4, 5] as level (level)}
			{@const filled = ratingFor(session) >= level}
			{#if interactive}
				<button
					type="button"
					class="cursor-pointer p-0.5 transition-opacity {filled
						? 'opacity-100'
						: 'opacity-30 hover:opacity-70'}"
					onclick={() => {
						draftRating = draftRating === level ? 0 : level;
					}}
					aria-label={String(level)}
				>
					<StarIcon
						size={12}
						weight={filled ? 'fill' : 'regular'}
						class={filled ? 'text-[var(--cosmic)]' : 'text-[var(--void-7)]'}
					/>
				</button>
			{:else}
				<StarIcon
					size={12}
					weight={filled ? 'fill' : 'regular'}
					class={filled ? 'text-[var(--cosmic)]' : 'text-[var(--void-5)]'}
				/>
			{/if}
		{/each}
	</div>
{/snippet}

{#if loading}
	<div
		class="flex items-center justify-center gap-2 py-10 font-mono text-[10px] tracking-[0.16em] text-[var(--text-ghost)] uppercase"
	>
		<SpinnerIcon size={14} class="animate-spin" />
		<span>{$_('common.loading')}</span>
	</div>
{:else}
	<div class="flex flex-col gap-6">
		<div class="flex items-baseline justify-between gap-4 border-b border-[var(--void-3)] pb-3">
			<div class="flex items-baseline gap-3">
				<span class="text-3xl font-light text-[var(--text)] tabular-nums">
					{String(completedCount).padStart(2, '0')}
				</span>
				<span class="font-mono text-[10px] tracking-[0.22em] text-[var(--text-ghost)] uppercase">
					{completedCount === 1 ? $_('reads.completedSingular') : $_('reads.completedPlural')}
				</span>
			</div>
			{#if lastFinishedAt}
				<div
					class="hidden font-mono text-[10px] tracking-[0.14em] text-[var(--text-ghost)] uppercase sm:block"
				>
					{$_('reads.lastLabel')}
					{relativeAgo(lastFinishedAt)}
				</div>
			{/if}
		</div>

		{#if activeSession && finishingActive}
			<ReadFinishPanel
				startedAt={activeSession.startedAt}
				busy={busySessionId === activeSession.id}
				onSave={(rating, notes) => {
					onFinishSession(activeSession.id, Date.now(), rating, notes);
					finishingActive = false;
				}}
				onDismiss={() => (finishingActive = false)}
			/>
		{:else if activeSession}
			<div
				class="border-l-2 border-[var(--cosmic)] bg-[var(--void-2)] px-4 py-3 shadow-[0_0_24px_-12px_var(--cosmic-glow)]"
			>
				<div class="flex items-center justify-between gap-3">
					<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] tracking-[0.22em] uppercase">
						<span
							class="inline-block h-1.5 w-1.5 shrink-0 animate-pulse bg-[var(--cosmic)] shadow-[0_0_6px_var(--cosmic-glow)]"
						></span>
						<span class="text-[var(--text-soft)]">{$_('reads.activeBadge')}</span>
						<span class="text-[var(--text-ghost)]">·</span>
						<span class="text-[var(--text-ghost)] normal-case tabular-nums">
							{formatDuration(activeSession.startedAt, null)}
						</span>
					</div>
					<div class="flex shrink-0 items-center gap-1.5">
						<button
							type="button"
							class="cursor-pointer border border-[var(--cosmic)]/40 px-2.5 py-1 font-mono text-[10px] tracking-[0.18em] text-[var(--text)] uppercase transition-colors hover:bg-[var(--cosmic)]/10 disabled:opacity-50"
							disabled={busySessionId === activeSession.id}
							onclick={() => (finishingActive = true)}
						>
							{$_('reads.finishAction')}
						</button>
						<button
							type="button"
							class="cursor-pointer p-1 text-[var(--void-7)] transition-colors hover:text-[var(--text-muted)]"
							aria-label={$_('reads.cancelActiveAction')}
							disabled={busySessionId === activeSession.id}
							onclick={() => (pendingDeleteId = activeSession.id)}
						>
							<XIcon size={14} />
						</button>
					</div>
				</div>
				<div class="mt-1.5 flex items-baseline gap-2 text-xs text-[var(--text-ghost)]">
					<span>{$_('reads.startedOn')}</span>
					<span class="text-[var(--text-soft)] tabular-nums"
						>{formatDate(activeSession.startedAt)}</span
					>
					<span class="text-[var(--void-6)]">·</span>
					<span class="text-[var(--void-7)]">{relativeAgo(activeSession.startedAt)}</span>
				</div>
			</div>
		{:else}
			<button
				type="button"
				class="group flex cursor-pointer items-center justify-center gap-2 border border-dashed border-[var(--void-4)] py-3 font-mono text-[10px] tracking-[0.22em] text-[var(--text-ghost)] uppercase transition-colors hover:border-[var(--cosmic)] hover:text-[var(--text)] disabled:opacity-50"
				disabled={startingSession}
				onclick={() => onStartSession(Date.now())}
			>
				{#if startingSession}
					<SpinnerIcon size={12} class="animate-spin" />
				{:else}
					<PlusIcon size={12} class="transition-colors group-hover:text-[var(--cosmic)]" />
				{/if}
				<span>{$_('reads.beginAction')}</span>
			</button>
		{/if}

		{#if completedSessions.length === 0 && !activeSession}
			<div class="flex flex-col items-center gap-2 py-12 text-center">
				<BookOpenIcon size={20} class="text-[var(--void-6)]" />
				<p class="font-mono text-[10px] tracking-[0.18em] text-[var(--text-ghost)] uppercase">
					{$_('reads.emptyTitle')}
				</p>
				<p class="text-xs text-[var(--text-ghost)]">{$_('reads.emptyHint')}</p>
			</div>
		{:else if completedSessions.length > 0}
			<ul class="flex flex-col">
				{#each completedSessions as session, index (session.id)}
					{@const expanded = expandedId === session.id}
					<li class="border-b border-[var(--void-3)]/60">
						<button
							type="button"
							class="grid w-full cursor-pointer grid-cols-[1.5rem_1fr_auto] items-center gap-2 px-1 py-2.5 text-left transition-colors hover:bg-[var(--void-2)] sm:grid-cols-[1.75rem_1fr_auto_auto] sm:gap-3"
							onclick={() => beginExpand(session)}
						>
							<span class="font-mono text-[10px] text-[var(--void-6)] tabular-nums">
								{String(completedSessions.length - index).padStart(2, '0')}
							</span>
							<div class="flex min-w-0 flex-col gap-1">
								<span class="truncate text-xs text-[var(--text-soft)] tabular-nums">
									{formatDate(session.startedAt)}
									<span class="px-1.5 text-[var(--void-6)]">→</span>
									{formatDate(session.finishedAt)}
								</span>
								<div class="flex items-center gap-2 sm:hidden">
									<span
										class="font-mono text-[10px] tracking-[0.12em] text-[var(--text-ghost)] uppercase tabular-nums"
									>
										{formatDuration(session.startedAt, session.finishedAt)}
									</span>
									<span class="text-[var(--void-6)]">·</span>
									{@render starsRow(session, false)}
								</div>
								{#if session.notes && !expanded}
									<span class="truncate text-[11px] text-[var(--text-ghost)]" title={session.notes}>
										{session.notes}
									</span>
								{/if}
							</div>
							<span
								class="hidden font-mono text-[10px] tracking-[0.12em] text-[var(--text-ghost)] uppercase tabular-nums sm:inline"
							>
								{formatDuration(session.startedAt, session.finishedAt)}
							</span>
							<div class="hidden sm:block">
								{@render starsRow(session, false)}
							</div>
						</button>

						{#if expanded}
							<div class="grid gap-3 border-t border-[var(--void-3)] bg-[var(--void-1)] px-3 py-3">
								<div class="flex flex-wrap items-center gap-3">
									<label
										class="flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] text-[var(--text-ghost)] uppercase"
									>
										<span>{$_('reads.startedOn')}</span>
										<input
											type="date"
											bind:value={draftStartedAt}
											class="border border-[var(--void-4)] bg-[var(--void-2)] px-2 py-1 font-mono text-xs text-[var(--text)] normal-case tabular-nums outline-none focus:border-[var(--cosmic)]"
										/>
									</label>
									<label
										class="flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] text-[var(--text-ghost)] uppercase"
									>
										<span>{$_('reads.finishedOn')}</span>
										<input
											type="date"
											bind:value={draftFinishedAt}
											class="border border-[var(--void-4)] bg-[var(--void-2)] px-2 py-1 font-mono text-xs text-[var(--text)] normal-case tabular-nums outline-none focus:border-[var(--cosmic)]"
										/>
									</label>
									<div class="flex items-center gap-2">
										<span
											class="font-mono text-[10px] tracking-[0.18em] text-[var(--text-ghost)] uppercase"
										>
											{$_('reads.ratingLabel')}
										</span>
										{@render starsRow(session, true)}
									</div>
								</div>
								<textarea
									bind:value={draftNotes}
									rows="2"
									placeholder={$_('reads.notesPlaceholder')}
									class="resize-y border border-[var(--void-4)] bg-[var(--void-2)] px-2 py-1.5 text-xs text-[var(--text-soft)] outline-none focus:border-[var(--cosmic)]"
								></textarea>
								<div class="flex items-center justify-between gap-2">
									<button
										type="button"
										class="flex cursor-pointer items-center gap-1.5 px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-[var(--void-7)] uppercase transition-colors hover:text-[var(--danger,#e07a7a)] disabled:opacity-50"
										disabled={busySessionId === session.id}
										onclick={() => (pendingDeleteId = session.id)}
									>
										<TrashIcon size={12} />
										<span>{$_('common.delete')}</span>
									</button>
									<div class="flex items-center gap-1.5">
										<Button variant="ghost" size="sm" onclick={() => (expandedId = null)}>
											{$_('common.cancel')}
										</Button>
										<Button
											variant="solid"
											size="sm"
											loading={busySessionId === session.id}
											onclick={commitExpandedEdit}
										>
											{$_('common.save')}
										</Button>
									</div>
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

<ConfirmDialog
	open={pendingDeleteId !== null}
	title={$_('reads.deleteConfirmTitle')}
	description={$_('reads.deleteConfirmDescription')}
	confirmLabel={$_('common.delete')}
	cancelLabel={$_('common.cancel')}
	variant="danger"
	onConfirm={() => {
		if (pendingDeleteId) {
			onDeleteSession(pendingDeleteId);
		}
		pendingDeleteId = null;
		expandedId = null;
	}}
	onCancel={() => (pendingDeleteId = null)}
/>
