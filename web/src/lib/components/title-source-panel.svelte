<script lang="ts">
	import { Button } from '$lib/elements/button';

	let {
		sourceName,
		sourceLang,
		sourceHealthLabel,
		sourceHealthDetail,
		offlineLabel,
		offlineDetail,
		headingLabel,
		prepareOfflineLabel,
		refreshSourceLabel,
		browserOnline,
		sourceStatusRefreshing = false,
		offlinePreparing = false,
		onRefreshSource,
		onPrepareOffline
	} = $props<{
		sourceName: string;
		sourceLang: string;
		sourceHealthLabel: string;
		sourceHealthDetail: string;
		offlineLabel: string;
		offlineDetail: string;
		headingLabel: string;
		prepareOfflineLabel: string;
		refreshSourceLabel: string;
		browserOnline: boolean;
		sourceStatusRefreshing?: boolean;
		offlinePreparing?: boolean;
		onRefreshSource: () => void | Promise<void>;
		onPrepareOffline: () => void | Promise<void>;
	}>();
</script>

<div class="mt-3 flex flex-wrap items-center justify-between gap-3 bg-[var(--void-2)] px-3 py-2">
	<div class="min-w-0">
		<p class="text-[10px] tracking-widest text-[var(--void-6)] uppercase">{headingLabel}</p>
		<p class="truncate text-sm text-[var(--text)]">{sourceName} [{sourceLang}]</p>
		<p class="mt-1 text-[11px] text-[var(--text-ghost)]">
			<span class="text-[var(--text-muted)]">{sourceHealthLabel}</span>
			<span> · {sourceHealthDetail}</span>
		</p>
		<p class="mt-1 text-[11px] text-[var(--text-ghost)]">
			<span class="text-[var(--text-muted)]">{offlineLabel}</span>
			<span> · {offlineDetail}</span>
		</p>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<Button
			variant="ghost"
			size="sm"
			onclick={() => void onPrepareOffline()}
			disabled={offlinePreparing || !browserOnline}
			loading={offlinePreparing}
		>
			{prepareOfflineLabel}
		</Button>
		<Button
			variant="ghost"
			size="sm"
			onclick={() => void onRefreshSource()}
			disabled={sourceStatusRefreshing}
			loading={sourceStatusRefreshing}
		>
			{refreshSourceLabel}
		</Button>
	</div>
</div>
