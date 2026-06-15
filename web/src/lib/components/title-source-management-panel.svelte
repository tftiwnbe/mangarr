<script lang="ts">
	import { MagnifyingGlassIcon, SparkleIcon, SpinnerIcon } from 'phosphor-svelte';

	import { Alert } from '$lib/elements/alert';
	import { Button } from '$lib/elements/button';
	import { PanelSection } from '$lib/elements/panel-section';
	import { SlidePanel } from '$lib/elements/slide-panel';
	import { _ } from '$lib/i18n';

	type SourceItem = {
		id: string;
		name: string;
		lang: string;
	};

	type ExploreItem = {
		canonicalKey?: string;
		sourceId: string;
		sourcePkg: string;
		sourceLang: string;
		sourceName?: string;
		titleUrl: string;
		title: string;
	};

	type TitleVariant = {
		id: string;
		sourceId: string;
		sourcePkg: string;
		sourceLang: string;
		sourceName?: string | null;
		title: string;
		isEnabled?: boolean;
		isStale?: boolean;
		progress: {
			readChapters: number;
			totalChapters: number;
		};
	};

	type TitleData = {
		variants: TitleVariant[];
	};

	type Props = {
		open: boolean;
		title: TitleData;
		hasStaleVariants: boolean;
		preferredVariantId: string | null;
		preferredVariantSavingId: string | null;
		removingVariantId: string | null;
		linkingVariantKey: string | null;
		normalizingSources: boolean;
		sourceStatusRefreshing: boolean;
		sourceMatchesLoading: boolean;
		sourceMatchesAttempted: boolean;
		sourceMatches: ExploreItem[];
		sourceManagementError: string | null;
		enabledMatchSources: SourceItem[];
		sourceDisplayName: (sourceId: string, sourcePkg: string, sourceName?: string | null) => string;
		onclose: () => void;
		onRefreshSource: () => void;
		onNormalizeSources: () => void;
		onChoosePreferredVariant: (variantId: string) => void;
		onRemoveSourceVariant: (variantId: string) => void;
		onLoadSourceMatches: (options?: {
			manual?: boolean;
			query?: string;
			sourceId?: string;
		}) => void;
		onLinkSourceVariant: (item: ExploreItem) => void;
	};

	let {
		open,
		title,
		hasStaleVariants,
		preferredVariantId,
		preferredVariantSavingId,
		removingVariantId,
		linkingVariantKey,
		normalizingSources,
		sourceStatusRefreshing,
		sourceMatchesLoading,
		sourceMatchesAttempted,
		sourceMatches,
		sourceManagementError,
		enabledMatchSources,
		sourceDisplayName,
		onclose,
		onRefreshSource,
		onNormalizeSources,
		onChoosePreferredVariant,
		onRemoveSourceVariant,
		onLoadSourceMatches,
		onLinkSourceVariant
	}: Props = $props();

	let manualSearchOpen = $state(false);
	let manualSearchQuery = $state('');
	let manualSearchSourceId = $state('');

	const sourceMatchesVisible = $derived(
		sourceMatchesLoading || sourceMatches.length > 0 || sourceMatchesAttempted
	);

	$effect(() => {
		if (enabledMatchSources.length === 0) {
			manualSearchSourceId = '';
			return;
		}
		if (enabledMatchSources.some((source) => source.id === manualSearchSourceId)) {
			return;
		}
		manualSearchSourceId = enabledMatchSources[0]?.id ?? '';
	});

	$effect(() => {
		if (!open) {
			manualSearchOpen = false;
			manualSearchQuery = '';
		}
	});

	function loadSuggestedMatches() {
		onLoadSourceMatches();
	}

	function loadManualMatches() {
		onLoadSourceMatches({
			manual: true,
			query: manualSearchQuery,
			sourceId: manualSearchSourceId
		});
	}
</script>

<SlidePanel {open} title={$_('title.info')} {onclose}>
	<PanelSection label={$_('title.sourceMaintenance')}>
		<p class="text-xs leading-relaxed text-[var(--text-ghost)]">
			{$_('title.sourceMaintenanceDescription')}
		</p>
		<Button
			variant="outline"
			size="sm"
			onclick={onRefreshSource}
			disabled={sourceStatusRefreshing}
			loading={sourceStatusRefreshing}
		>
			{$_('title.refreshSource')}
		</Button>
	</PanelSection>

	<PanelSection label={$_('title.sources')} divider={false}>
		{#snippet actions()}
			<div class="flex items-center gap-1.5">
				{#if hasStaleVariants}
					<Button
						variant="ghost"
						size="sm"
						onclick={onNormalizeSources}
						disabled={normalizingSources}
						loading={normalizingSources}
					>
						{$_('title.repairSources')}
					</Button>
				{/if}
			</div>
		{/snippet}
		<p class="text-xs leading-relaxed text-[var(--text-ghost)]">
			{$_('title.findMatchesDescription')}
		</p>

		<div class="flex flex-col gap-2">
			{#each title.variants as variant (variant.id)}
				{@const isPreferred = preferredVariantId === variant.id}
				<div
					class="border bg-[var(--void-2)] px-3 py-3 transition-colors {isPreferred
						? 'border-[var(--cosmic-halo)]'
						: 'border-[var(--void-3)] hover:border-[var(--void-5)]'}"
				>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-1.5">
								<span class="truncate text-sm font-medium text-[var(--text)]">
									{sourceDisplayName(variant.sourceId, variant.sourcePkg, variant.sourceName)}
								</span>
								<span
									class="border border-[var(--void-4)] px-1.5 py-px font-mono text-[9px] tracking-[0.18em] text-[var(--text-ghost)] uppercase"
								>
									{variant.sourceLang}
								</span>
								{#if isPreferred}
									<span
										class="border border-[var(--success)]/40 bg-[var(--success-soft)] px-1.5 py-px font-mono text-[9px] tracking-[0.18em] text-[var(--success)] uppercase"
									>
										{$_('title.readingNow')}
									</span>
								{/if}
								{#if variant.isStale}
									<span
										class="border border-[var(--error)]/40 bg-[var(--error-soft)] px-1.5 py-px font-mono text-[9px] tracking-[0.18em] text-[var(--error)] uppercase"
									>
										{$_('title.staleSource')}
									</span>
								{:else if variant.isEnabled === false}
									<span
										class="border border-[var(--void-4)] px-1.5 py-px font-mono text-[9px] tracking-[0.18em] text-[var(--text-ghost)] uppercase"
									>
										{$_('downloads.disabled')}
									</span>
								{/if}
							</div>
							<div class="mt-1 truncate text-xs text-[var(--text-ghost)]">{variant.title}</div>
						</div>
					</div>
					<div class="mt-3 flex flex-wrap gap-2">
						<Button
							variant={isPreferred ? 'ghost' : 'outline'}
							size="sm"
							onclick={() => onChoosePreferredVariant(variant.id)}
							disabled={preferredVariantSavingId === variant.id || isPreferred}
							loading={preferredVariantSavingId === variant.id}
						>
							{isPreferred ? $_('title.readingNow') : $_('title.readFromSource')}
						</Button>
						{#if title.variants.length > 1}
							<Button
								variant="ghost"
								size="sm"
								onclick={() => onRemoveSourceVariant(variant.id)}
								disabled={removingVariantId === variant.id}
								loading={removingVariantId === variant.id}
							>
								{$_('title.removeSource')}
							</Button>
						{/if}
					</div>
				</div>
			{/each}
		</div>

		<div class="flex items-center gap-2 border border-dashed border-[var(--void-3)] px-3 py-2">
			<Button
				variant="ghost"
				size="sm"
				class="flex-1 whitespace-nowrap"
				onclick={loadSuggestedMatches}
				disabled={sourceMatchesLoading || enabledMatchSources.length === 0}
				loading={sourceMatchesLoading}
			>
				{$_('title.findOtherSources')}
			</Button>
			<button
				type="button"
				class="font-mono text-[10px] tracking-[0.16em] text-[var(--text-ghost)] uppercase transition-colors hover:text-[var(--text)]"
				onclick={() => (manualSearchOpen = !manualSearchOpen)}
			>
				{manualSearchOpen ? $_('common.less') : $_('title.searchManually')}
			</button>
		</div>

		{#if manualSearchOpen}
			<div class="flex flex-col gap-2 border border-[var(--void-3)] bg-[var(--void-2)] p-3">
				<input
					type="text"
					class="min-w-0 border-b border-[var(--void-4)] bg-transparent py-1.5 text-sm text-[var(--text)] transition-colors outline-none placeholder:text-[var(--text-ghost)] focus:border-[var(--cosmic)]"
					placeholder={title.variants[0]?.title ?? ''}
					bind:value={manualSearchQuery}
				/>
				<select
					class="border-b border-[var(--void-4)] bg-transparent py-1.5 text-sm text-[var(--text)] transition-colors outline-none focus:border-[var(--cosmic)]"
					bind:value={manualSearchSourceId}
				>
					<option value="">{$_('title.allEnabledSources')}</option>
					{#each enabledMatchSources as source (source.id)}
						<option value={source.id}>{source.name} [{source.lang}]</option>
					{/each}
				</select>
				<Button
					variant="solid"
					size="sm"
					onclick={loadManualMatches}
					disabled={sourceMatchesLoading || enabledMatchSources.length === 0}
					loading={sourceMatchesLoading}
				>
					{$_('common.search')}
				</Button>
			</div>
		{/if}

		{#if sourceMatchesVisible}
			<div class="flex flex-col gap-3 border-t border-[var(--void-3)] pt-4">
				<div
					class="flex flex-col gap-2 border border-[var(--void-3)] bg-[linear-gradient(135deg,var(--void-2),color-mix(in_srgb,var(--void-2)_72%,var(--cosmic-soft)))] px-3 py-3 sm:flex-row sm:items-start sm:justify-between"
				>
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<span
								class="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--cosmic-halo)] bg-[var(--cosmic-soft)] text-[var(--cosmic)]"
							>
								<SparkleIcon size={12} weight="fill" />
							</span>
							<span class="text-sm text-[var(--text)]">{$_('title.suggestedMatches')}</span>
						</div>
						<p class="mt-1 pl-8 text-[11px] leading-relaxed text-[var(--text-ghost)]">
							{$_('title.enabledSourcesOnly')}
						</p>
					</div>
					<span
						class="ml-8 inline-flex w-fit items-center gap-1 border border-[var(--void-4)] px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-[var(--text-dim)] uppercase sm:ml-0"
					>
						<MagnifyingGlassIcon size={10} />
						{$_('title.quickPass')}
					</span>
				</div>

				{#if sourceMatchesLoading}
					<div class="flex items-center gap-2 border border-[var(--void-3)] bg-[var(--void-2)] px-3 py-3 text-xs text-[var(--text-ghost)]">
						<SpinnerIcon size={12} class="animate-spin" />
						<span>{$_('common.loading')}</span>
					</div>
				{:else if sourceMatches.length > 0}
					<div class="flex flex-col gap-2">
						{#each sourceMatches as result (`${result.sourceId}::${result.titleUrl}`)}
							<div
								class="flex items-start justify-between gap-3 border border-[var(--void-3)] bg-[var(--void-2)] px-3 py-2 text-sm transition-colors hover:border-[var(--void-5)]"
							>
								<div class="min-w-0">
									<div class="truncate text-[var(--text)]">{result.title}</div>
									<div class="mt-1 flex items-center gap-1.5">
										<span class="text-xs text-[var(--text-ghost)]">
											{sourceDisplayName(result.sourceId, result.sourcePkg)}
										</span>
										<span
											class="border border-[var(--void-4)] px-1 font-mono text-[9px] tracking-[0.16em] text-[var(--text-ghost)] uppercase"
										>
											{result.sourceLang}
										</span>
									</div>
								</div>
								<Button
									variant="ghost"
									size="sm"
									onclick={() => onLinkSourceVariant(result)}
									disabled={linkingVariantKey === `${result.sourceId}::${result.titleUrl}`}
									loading={linkingVariantKey === `${result.sourceId}::${result.titleUrl}`}
								>
									{$_('title.addSource')}
								</Button>
							</div>
						{/each}
					</div>
				{:else if sourceMatchesAttempted}
					<div class="border border-dashed border-[var(--void-4)] bg-[var(--void-2)] px-4 py-5">
						<div class="flex items-start gap-3">
							<span
								class="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--void-4)] bg-[var(--void-1)] text-[var(--text-dim)]"
							>
								<MagnifyingGlassIcon size={14} />
							</span>
							<div>
								<p class="text-sm text-[var(--text)]">{$_('title.noSourceMatches')}</p>
								<p class="mt-1 text-[11px] leading-relaxed text-[var(--text-ghost)]">
									{$_('title.manualSearchHint')}
								</p>
							</div>
						</div>
					</div>
				{/if}
			</div>
		{/if}

		{#if sourceManagementError}
			<Alert variant="error">{sourceManagementError}</Alert>
		{/if}
	</PanelSection>
</SlidePanel>
